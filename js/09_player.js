'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  09 玩家控制 / 输入 / 射击
   ===================================================================== */

const PLAYER_RADIUS = 0.36;
const EYE_STAND = 1.62, EYE_CROUCH = 1.06;
// 射击用临时向量（每次开火都可能用到，不要在热路径里 new）
const _pFwd = V3(), _pRight = V3(), _pUp = V3(), _pDir = V3();

/* 当前角色实际生效的配装。
   MTF 用玩家在配装界面自己选的；其他角色用固定配装，或者干脆空手。 */
function effectiveLoadout() {
  const r = (typeof currentRole === 'function') ? currentRole() : null;
  if (!r || r.loadout === 'custom') return LOADOUT;
  return {
    preset: r.id,
    primary: r.primary,
    secondary: r.secondary,
    mods: { primary: {}, secondary: {} },
    armor: r.armor | 0,
    gear: r.gear || 'none',
  };
}

const player = {
  isPlayer: true, name: '你', callsign: 'Nu-7',
  pos: V3(0, 0, 0), vel: V3(),
  yaw: 0, pitch: 0,
  hp: 100, maxHp: 100,
  armor: 0, armorHp: 0, armorMax: 0,
  alive: false, deployed: false,
  // SCP-079：本体是设施里的机器，没有可被击中的身体
  isAI: false,
  // 附身收容物：本体就是 SCP_LIST 里那只实体，玩家对象只是视角载体
  isSCP: false,
  // 半自动武器的"上一帧是否按住开火"
  fireHeld: false,
  onGround: true, crouch: false, sprinting: false, ads: false,
  stamina: 1, eyeH: EYE_STAND, eyeHCur: EYE_STAND,
  mouseDX: 0, mouseDY: 0,
  slots: [], curSlot: 0,
  fireT: 0, bloom: 0, lastDmgT: -99,
  // 状态
  sleep: 100,           // 被 SCP-966 剥夺的睡眠
  grabbedBy: null, grabT: 0,
  bleeding: 0,
  nvgOn: false,
  // 交互
  interact: null, interactHold: 0,
  // 统计
  kills: 0, shots: 0, hits: 0, headshots: 0, dmgDealt: 0, dmgTaken: 0,
  // 相机
  recoilPitch: 0, recoilYaw: 0, landDip: 0, trauma: 0,
  footT: 0,

  init() {
    const LO = effectiveLoadout();
    this.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
    this.yaw = FAC.spawn.yaw; this.pitch = 0;
    this.hp = this.maxHp = 115;
    const ar = ARMOR_DEFS[clamp(LO.armor | 0, 0, 3)];
    this.armor = ar.id;
    this.armorMax = ar.hp; this.armorHp = ar.hp;
    // 武器槽（研究员 / D 级人员是空手，槽位会是空的）
    this.slots = [];
    const mk = (id, mods, isSecondary) => {
      if (!id) return null;
      const st = computeWeaponStats(id, mods);
      return {
        id, mods, stats: st, isSecondary: !!isSecondary,
        mag: st.mag, reserve: st.reserve, reloading: false,
      };
    };
    const pw = mk(LO.primary, LO.mods.primary);
    const sw = mk(LO.secondary, LO.mods.secondary, true);
    if (pw) this.slots.push(pw);
    if (sw) this.slots.push(sw);
    this.curSlot = 0;
    this.stamina = 1; this.sleep = 100;
    this.grabbedBy = null; this.grabT = 0;
    this.trauma = 0; this.recoilPitch = 0; this.recoilYaw = 0;
    this.alive = true; this.deployed = true;
    this.interact = null; this.interactHold = 0;
    this.kills = 0; this.shots = 0; this.hits = 0; this.headshots = 0;
    this.dmgDealt = 0; this.dmgTaken = 0;
    this.bleeding = 0;
    if (this.slots.length) VM.equip(this.slots[0].id, this.slots[0].mods);
    else VM.unequip();
    const arMul = ARMOR_DEFS[this.armor].mobility;
    this.mobilityMul = arMul;
  },

  cur() { return this.slots[this.curSlot]; },

  // ---------------- 移动 ----------------
  move(dt, keys) {
    if (!this.alive) return;
    const w = this.cur();
    const wMul = (w && w.stats ? w.stats.mobility : 1) * (this.mobilityMul || 1);
    const wantCrouch = keys.crouch;
    this.crouch = wantCrouch;
    const targetEye = wantCrouch ? EYE_CROUCH : EYE_STAND;
    this.eyeHCur = dampF(this.eyeHCur, targetEye, 12, dt);
    this.eyeH = this.eyeHCur;

    // 输入方向
    let fx = 0, fz = 0;
    if (keys.fwd) fz += 1;
    if (keys.back) fz -= 1;
    if (keys.left) fx -= 1;
    if (keys.right) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    // 冲刺
    const canSprint = keys.sprint && keys.fwd && !keys.crouch && this.stamina > 0.05 && !this.ads;
    this.sprinting = canSprint;

    let speed = wantCrouch ? 2.0 : (this.sprinting ? 6.5 : 4.35);
    speed *= wMul;
    if (this.ads) speed *= 0.55;
    if (this.sleep < 40) speed *= 0.82;
    if (this.grabbedBy) speed *= 0.0;

    // 世界方向（相机约定：yaw=0 时朝向 -Z，forward = (-sin, -cos)）
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = fx * cy - fz * sy;
    const wz = -fx * sy - fz * cy;

    const accel = this.onGround ? 34 : 9;
    const tgtVX = wx * speed, tgtVZ = wz * speed;
    this.vel.x = dampF(this.vel.x, tgtVX, accel * 0.28, dt);
    this.vel.z = dampF(this.vel.z, tgtVZ, accel * 0.28, dt);
    if (Math.abs(this.vel.x) < 0.02) this.vel.x = 0;
    if (Math.abs(this.vel.z) < 0.02) this.vel.z = 0;

    // 重力 / 跳跃
    this.vel.y -= 22 * dt;
    if (keys.jump && this.onGround && !this.crouch) {
      this.vel.y = 6.3; this.onGround = false;
      AudioSys.beep(false);
    }

    // 位移
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideMove(this.pos, PLAYER_RADIUS, 1.75, 0.56);
    this.pos.y += this.vel.y * dt;

    const gh = floorAt(this.pos.x, this.pos.z, this.pos.y + 0.3);
    if (this.pos.y <= gh + 0.001) {
      if (!this.onGround && this.vel.y < -5) {
        this.landDip = clamp(-this.vel.y * 0.012, 0, 0.16);
        addTrauma(clamp(-this.vel.y * 0.02, 0, 0.25));
        AudioSys.beep(false);
      }
      this.pos.y = gh; this.vel.y = 0; this.onGround = true;
    } else this.onGround = false;

    // 耐力
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.135);
    else this.stamina = Math.min(1, this.stamina + dt * (this.onGround ? 0.20 : 0.08));

    // 脚步声
    if (this.onGround && len > 0) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.8) {
        this.footT -= dt * (sp / 3.4);
        if (this.footT <= 0) {
          this.footT = wantCrouch ? 1.05 : (this.sprinting ? 0.42 : 0.62);
          noiseEvent(this.pos.x, this.pos.z, this.crouch ? 0.28 : (this.sprinting ? 1.0 : 0.6), 'foot');
          AudioSys.beep(false);
        }
      }
    } else this.footT = 0;

    this.landDip = dampF(this.landDip, 0, 9, dt);
  },

  // ---------------- 射击 ----------------
  tryFire(dt) {
    const w = this.cur();
    // 半自动要"重新按一次"才发射 —— 先算按键边沿，且必须在所有 early return 之前更新
    const held = !!keys.fire;
    const pressed = held && !this.fireHeld;
    this.fireHeld = held;
    if (!w || !this.alive) return;
    if (w.reloading) return;
    if (this.fireT > 0) { this.fireT -= dt; return; }
    const semi = w.stats.mode === 'semi';
    if (held && (!semi || pressed)) {
      if (w.mag <= 0) { this.startReload(); return; }
      this.fireOnce();
      const rpm = w.stats.rpm;
      this.fireT = 60 / rpm;
      if (w.stats.mode === 'pump' || w.stats.mode === 'bolt') this.fireT += 0.55;
    }
  },

  fireOnce() {
    const w = this.cur();
    if (!w) return;                 // 空手角色没有可开火的东西
    const s = w.stats;
    w.mag--;
    this.shots++;
    GAME.shots++;
    // 音效
    if (s.stealth >= 1) AudioSys.suppressed();
    else AudioSys.gunshot(s.snd);
    noiseEvent(this.pos.x, this.pos.z, s.stealth >= 1 ? 0.30 : 1.0, 'shot');

    // 散布
    const moveMul = 1 + clamp(Math.hypot(this.vel.x, this.vel.z) / 5.5, 0, 1) * (s.spreadMove / 4);
    const base = lerp(s.spreadHip, s.spreadAds, VM.adsBlend);
    const spread = base * moveMul * (1 + this.bloom * 0.6) * (this.crouch ? 0.75 : 1) * 0.011;

    const pellets = s.pellets || 1;
    const camPos = camera.position;
    _pFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _pRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _pUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

    let anyHit = false, headHit = false;
    for (let i = 0; i < pellets; i++) {
      const sp = pellets > 1 ? spread * 3.2 : spread;
      _pDir.copy(_pFwd).addScaledVector(_pRight, rand(-sp, sp)).addScaledVector(_pUp, rand(-sp, sp)).normalize();
      const res = fireRay(camPos, _pDir, s);
      if (res && res.scpHit) { anyHit = true; if (res.head) headHit = true; }
    }
    if (anyHit) { this.hits++; GAME.hits++; if (headHit) { this.headshots++; GAME.headshots++; } AudioSys.hitmark(headHit); }
    VM.fire(s);
    // 后坐
    const bipodBonus = (s.hasBipod && this.crouch) ? 0.65 : 1;
    this.recoilPitch += s.recoil * 0.0075 * bipodBonus;
    this.recoilYaw += rand(-1, 1) * s.recSide * 0.006 * bipodBonus;
    this.bloom = Math.min(1.6, this.bloom + 0.16);
    addTrauma(s.kick * 1.4);
    // 泵动/栓动上膛音
    if (s.mode === 'pump' || s.mode === 'bolt') VM.boltT = 0.35;
  },

  startReload() {
    const w = this.cur();
    if (!w || w.reloading) return;
    if (w.mag >= w.stats.mag) return;
    if (w.reserve <= 0) { toast('弹药耗尽', 1400, 'warn'); AudioSys.dryFire(); return; }
    w.reloading = true;
    const empty = w.mag <= 0;
    const dur = empty ? (w.stats.reloadEmpty || w.stats.reload + 0.6) : w.stats.reload;
    VM.startReload(dur);
    VM.onMagOut = () => AudioSys.reload('magout');
    VM.onMagIn = () => AudioSys.reload('magin');
    VM.onBolt = () => AudioSys.bolt();
    VM.onReloadDone = () => {
      const need = w.stats.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take;
      w.reloading = false;
      VM.cancelReload();
    };
  },

  switchSlot(i) {
    if (i === this.curSlot || i < 0 || i >= this.slots.length) return;
    if (this.cur() && this.cur().reloading) { this.cur().reloading = false; VM.cancelReload(); }
    this.curSlot = i;
    this.fireT = 0.25;
    VM.equip(this.slots[i].id, this.slots[i].mods);
    AudioSys.reload('magin');
  },

  // ---------------- 受伤 ----------------
  damage(amt, attacker, opts) {
    if (!this.alive || GAME.over) return;
    if (DEBUG.god) return;
    if (GAME.staging && GAME.staging.active) return;   // 待命期间还没进场，打不到
    if (this.isAI) return;          // SCP-079 没有身体，打不到
    if (this.isSCP) return;         // 附身收容物：伤害走 SCP 实体自己的 damage()
    if (GAME.spawnProtectT > 0) return;   // 重新部署的无敌时间
    const o = opts || {};
    const limb = o.limb || 'torso';
    let final = amt;
    // 护甲只挡躯干
    if (limb === 'torso' && this.armorHp > 0) {
      const ar = ARMOR_DEFS[this.armor];
      const absorbed = final * ar.resist;
      final -= absorbed;
      this.armorHp = Math.max(0, this.armorHp - absorbed * 1.4);
    }
    if (limb === 'head') final *= 1.0;
    if (limb === 'leg') final *= 0.8;
    this.hp -= final;
    this.dmgTaken += final;
    GAME.dmgTaken += final;
    this.lastDmgT = nowT;
    dmgFlash = Math.min(1, dmgFlash + clamp(final / 40, 0.18, 0.9));
    addTrauma(clamp(final / 90, 0.06, 0.5));
    if (final > 4) AudioSys.hurt();
    if (attacker && attacker.pos) {
      const a = Math.atan2(attacker.pos.x - this.pos.x, attacker.pos.z - this.pos.z);
      addDirHit(a);
    }
    if (this.hp <= 0) { this.hp = 0; this.die(attacker, o); }
  },

  die(attacker, o) {
    this.alive = false;
    this.sprinting = false; this.ads = false;
    this.grabbedBy = null;
    document.exitPointerLock && document.exitPointerLock();
    onPlayerDeath(attacker, o);
  },

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); },
  addArmor(n) { this.armorHp = Math.min(this.armorMax, this.armorHp + n); },

  // ---------------- 交互扫描 ----------------
  scanInteract() {
    if (!this.alive) { this.interact = null; return; }
    let best = null, bestD = 1e9;
    const consider = (obj, range) => {
      const d = Math.hypot(obj.x - this.pos.x, obj.z - this.pos.z);
      if (d < range && d < bestD) { bestD = d; best = obj; }
    };
    // ---- 设施地图（落锤行动）----
    for (const b of FAC.breakers) if (!b.done) consider(b, b.range);
    if (FAC.terminal && !FAC.terminal.done) consider(FAC.terminal, FAC.terminal.range);
    if (FAC.nuke && !FAC.nuke.done) consider(FAC.nuke, FAC.nuke.range);
    if (FAC.coffee && !FAC.coffee.done) consider(FAC.coffee, FAC.coffee.range);
    // ---- 给 SCP-096 戴收容头套（两个行动通用：它打不死，只能这样收容）----
    if (typeof SCP_LIST !== 'undefined') {
      const s = SCP_LIST.find(v => v.key === '096');
      if (s && s.alive && !s.hooded) {
        consider({ hood096: true, x: s.pos.x, z: s.pos.z, range: 3.2, holdNeed: 4.0 }, 3.2);
      }
    }
    // ---- 收容档案照片：两个行动都有，不受地图类型限制 ----
    for (const p of PHOTOS) if (!p.done) consider(p, p.range);
    // ---- SCP-1440（5K 行动）：按住 F 让它跟随 / 停下 ----
    // ⚠️ 反叛之狐不给"跟随"选项 —— 它要的是处决，两个交互叠在同一个位置会互相抢。
    const isRebel = GAME.mission === 'fivek' && typeof roleView === 'function' && roleView().id === 'rebel';
    if (typeof S1440 !== 'undefined' && S1440.active && S1440.ent && !isRebel) {
      const e = S1440.ent;
      if (S1440.follow) consider({ s1440Release: true, x: e.pos.x, z: e.pos.z, range: 3.8, holdNeed: 0.8 }, 3.8);
      else consider({ s1440Follow: true, x: e.pos.x, z: e.pos.z, range: 3.8, holdNeed: 1.2 }, 3.8);
    }
    // ---- 反叛之狐：处决 SCP-1440（仅 5K）----
    if (isRebel && typeof S1440 !== 'undefined' && S1440.active && S1440.ent && !S1440.executed) {
      const e = S1440.ent;
      consider({ exec1440: true, x: e.pos.x, z: e.pos.z, range: 3.6, holdNeed: 6.0 }, 3.6);
    }
    // 撤离点（两者通用，需要目标链完成）
    if (FAC.extract && extractReady()) consider(FAC.extract, FAC.extract.range);
    this.interact = best;
  },
};

/* =====================================================================
   输入
   ===================================================================== */
const keys = {
  fwd: false, back: false, left: false, right: false,
  sprint: false, crouch: false, jump: false, fire: false, ads: false,
  o79Speaker: false,      // SCP-079 按住 T 用扬声器
};
let pointerLocked = false;

function setupInput() {
  const dom = renderer.domElement;

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.code;
    switch (k) {
      case 'KeyW': keys.fwd = true; break;
      case 'KeyS': keys.back = true; break;
      case 'KeyA': keys.left = true; break;
      case 'KeyD': keys.right = true; break;
      case 'ShiftLeft': case 'ShiftRight': keys.sprint = true; break;
      case 'ControlLeft': case 'KeyC': keys.crouch = true; break;
      case 'Space': keys.jump = true; e.preventDefault(); break;
      case 'KeyR': if (AI079.active) { o79LockToggle(); break; } if (player.alive) player.startReload(); break;
      case 'Digit1': if (AI079.active) break; if (player.alive) player.switchSlot(0); break;
      case 'Digit2': if (AI079.active) break; if (player.alive) player.switchSlot(1); break;
      case 'KeyN': if (AI079.active) { o79Blackout(); break; } if (player.alive) { NVG.toggle(); } break;
      case 'KeyG': if (AI079.active) { o79TeslaFire(); break; } if (player.alive) VM.toggleLight(); break;
      case 'KeyF': if (AI079.active) o79DoorToggle(); /* 人类：按住由 update 处理 */ break;
      // ---- SCP-079 专用 ----
      case 'KeyQ': if (AI079.active) o79Switch(-1); break;
      case 'KeyE': if (AI079.active) o79Switch(1); break;
      case 'KeyT': if (AI079.active) keys.o79Speaker = true; break;
      case 'KeyM': if (GAME.phase === 'playing') toggleBigMap(); break;
      case 'Tab': e.preventDefault(); if (GAME.phase === 'playing') toggleObjPanel(); break;
      case 'Escape': if (GAME.phase === 'playing') togglePause(); break;
      case 'KeyH': if (player.alive) useMedkit(); break;
      case 'KeyP': if (GAME.phase === 'playing') toggleObjPanel(); break;
    }
    if (k === 'KeyF') keys.interact = true;
  });
  addEventListener('keyup', (e) => {
    const k = e.code;
    switch (k) {
      case 'KeyW': keys.fwd = false; break;
      case 'KeyS': keys.back = false; break;
      case 'KeyA': keys.left = false; break;
      case 'KeyD': keys.right = false; break;
      case 'ShiftLeft': case 'ShiftRight': keys.sprint = false; break;
      case 'ControlLeft': case 'KeyC': keys.crouch = false; break;
      case 'Space': keys.jump = false; break;
      case 'KeyF': keys.interact = false; break;
      case 'KeyT': keys.o79Speaker = false; break;
    }
  });

  dom.addEventListener('mousedown', (e) => {
    if (GAME.phase !== 'playing') return;
    if (!pointerLocked) { requestLock(); return; }
    if (e.button === 0) keys.fire = true;
    if (e.button === 2) {
      if (SETTINGS.adsToggle) player.ads = !player.ads; else keys.ads = true;
    }
    if (e.button === 1) { /* 中键：切换手电 */ VM.toggleLight(); e.preventDefault(); }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) keys.fire = false;
    if (e.button === 2 && !SETTINGS.adsToggle) keys.ads = false;
  });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  addEventListener('mousemove', (e) => {
    if (!pointerLocked || !player.alive) return;
    const s = 0.0022 * SETTINGS.sens;
    const mx = e.movementX || 0, my = e.movementY || 0;
    player.yaw -= mx * s;
    player.pitch -= my * s * (SETTINGS.invertY ? -1 : 1);
    player.pitch = clamp(player.pitch, -1.5, 1.5);
    player.mouseDX += mx;
    player.mouseDY += my;
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === dom;
    if (!pointerLocked && GAME.phase === 'playing' && player.alive && !GAME.over && !DEBUG.noPause) {
      keys.fire = false; keys.ads = false; keys.fwd = keys.back = keys.left = keys.right = false;
      player.sprinting = false; player.ads = false;
      showPauseOverlay(true);
    }
  });

  addEventListener('blur', () => {
    keys.fwd = keys.back = keys.left = keys.right = false;
    keys.fire = false; keys.ads = false; keys.sprint = false;
    player.sprinting = false; player.ads = false;
  });
}

function requestLock() {
  try {
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => { });
  } catch (e) { }
}
function exitLock() { document.exitPointerLock && document.exitPointerLock(); }

/* =====================================================================
   每帧更新玩家
   ===================================================================== */
function updatePlayer(dt) {
  // 反叛之狐的待命阶段：还没突入设施，不能动也不能开枪
  if (GAME.staging && GAME.staging.active) {
    player.ads = false;
    player.trauma = dampF(player.trauma, 0, 2.6, dt);
    return;
  }
  // SCP-079 / 附身收容物：不走路不开枪，视角由各自的模块驱动
  if (player.isAI || player.isSCP) {
    if (player.isAI && typeof update079View === 'function') update079View();
    player.ads = false;
    player.trauma = dampF(player.trauma, 0, 2.6, dt);
    return;
  }
  if (!player.alive) {
    // 死亡后相机缓慢下坠
    player.eyeH = dampF(player.eyeH, 0.45, 3.5, dt);
    return;
  }
  player.move(dt, keys);
  player.ads = SETTINGS.adsToggle ? player.ads : keys.ads;
  player.tryFire(dt);

  // 呼吸 / 疲劳
  if (player.sleep < 100) player.sleep = Math.min(100, player.sleep + dt * 0.9);
  if (player.sleep < 25) {
    player.hp -= dt * 1.6;
    if (Math.random() < dt * 0.6) AudioSys.hallucinate();
    if (player.hp <= 0) player.die(null, { limb: 'torso', cause: '睡眠剥夺' });
  }
  // 出血
  if (player.bleeding > 0) {
    player.bleeding -= dt;
    player.hp -= dt * 3.2;
    if (player.hp <= 0) player.die(null, { limb: 'torso', cause: '失血过多' });
  }

  player.bloom = dampF(player.bloom, 0, 3.4, dt);
  player.recoilPitch = dampF(player.recoilPitch, 0, 9, dt);
  player.recoilYaw = dampF(player.recoilYaw, 0, 9, dt);
  player.trauma = dampF(player.trauma, 0, 2.6, dt);

  // 交互
  player.scanInteract();
  if (player.interact && keys.interact) {
    player.interactHold += dt;
    if (player.interactHold >= player.interact.holdNeed) {
      completeInteract(player.interact);
      player.interactHold = 0;
    }
  } else {
    player.interactHold = dampF(player.interactHold, 0, 8, dt);
  }

  // 自动拾取
  for (const p of PICKUPS) {
    if (p.taken) continue;
    const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    if (d < 1.5) collectPickup(p);
  }

  VM.update(dt, player);
}

function completeInteract(obj) {
  // 收容行动：给 SCP-096 戴头套 / 划掉照片
  if (obj.hood096) { hoodSCP096(); return; }
  if (obj.isPhoto) { destroyPhoto(obj); return; }
  if (obj.s1440Follow) { set1440Follow(true); return; }
  if (obj.s1440Release) { set1440Follow(false); return; }
  if (obj.exec1440) { execute1440(); return; }
  // 净化行动：关闭感染源（复用 breakers 的交互位，但走自己的结算）
  if (obj.isInfectionSource) { onInfectionSourceDone(obj); return; }
  if (obj.key && obj.key.startsWith('breaker_')) {
    obj.done = true;
    obj.lever.rotation.x = -1.1;
    obj.lever.position.y = 1.02;
    obj.led.material.color.setHex(0x39ff8a);
    AudioSys.beep(true);
    onBreakerDone(obj);
  } else if (obj === FAC.terminal) {
    obj.done = true;
    AudioSys.beep(true);
    onProtocolDone();
  } else if (obj === FAC.extract) {
    AudioSys.beep(true);
    onExtractionDone();
  } else if (obj === FAC.nuke) {
    obj.done = true;
    onNukeEMP();
  } else if (obj === FAC.coffee) {
    obj.done = true;
    player.heal(15);
    player.stamina = 1;
    player.sleep = Math.min(100, player.sleep + 25);
    AudioSys.pickup();
    toast('一杯热咖啡 · +15 HP · 体力与精神恢复', 2400, 'good');
  }
}

function collectPickup(p) {
  const d = p.def;
  // 补给武器只给"没枪的阵营"（Class-D / 科学家 / 保安）捡
  if (d.kind === 'weapon' && !canPickWeapons()) {
    if (!p._warned || nowT - p._warned > 6) {
      p._warned = nowT;
      toast('这件武器你用不上（只有 Class-D / 科学家 / 保安 能捡）', 2400, 'warn');
    }
    return;
  }
  p.taken = true;
  scene.remove(p.group);
  if (d.kind === 'ammo') {
    for (const w of player.slots) {
      if (d.for.indexOf(w.id) >= 0) {
        const add = Math.round(w.stats.reserve * d.amount * 0.6);
        w.reserve = Math.min(w.stats.reserve * 2, w.reserve + add);
      }
    }
    toast('拾取 ' + d.name, 1500, 'good');
  } else if (d.kind === 'heal') {
    player.heal(d.amount);
    player.bleeding = 0;
    toast('使用 ' + d.name + ' (+' + d.amount + ' HP)', 1500, 'good');
  } else if (d.kind === 'armor') {
    player.addArmor(d.amount);
    toast('修复护甲 +' + d.amount, 1500, 'good');
  } else if (d.kind === 'battery') {
    NVG.addBattery(d.amount);
    toast('装置电池 +' + d.amount + '%', 1500, 'good');
  } else if (d.kind === 'weapon') {
    equipPickedWeapon(d.wpn);
  }
  AudioSys.pickup();
}

/* 捡起地上的武器：按「主武器在前、副武器在后」重排槽位后替换对应的那把。
   原来的枪直接被换掉，弹药按新枪满配给 —— 地上捡的东西不继承旧弹匣。 */
function equipPickedWeapon(wpnId) {
  const def = WPN_DEFS[wpnId];
  if (!def) return;
  const st = computeWeaponStats(wpnId, {});
  const w = {
    id: wpnId, mods: {}, stats: st, isSecondary: !!def.pistol,
    mag: st.mag, reserve: st.reserve, reloading: false,
  };
  const list = player.slots.slice().sort((a, b) => (a.isSecondary ? 1 : 0) - (b.isSecondary ? 1 : 0));
  if (def.pistol) {
    const i = list.findIndex(x => x.isSecondary);
    if (i >= 0) list[i] = w; else list.push(w);
  } else {
    const i = list.findIndex(x => !x.isSecondary);
    if (i >= 0) list[i] = w; else list.unshift(w);
  }
  player.slots = list;
  player.curSlot = Math.max(0, list.indexOf(w));
  VM.equip(w.id, w.mods);
  killfeed('拾取 ' + def.name + ' · ' + def.cls, 'good');
  toast('拾取 ' + def.full + '（' + def.mag + ' 发）', 2600, 'good');
}

function useMedkit() {
  if (!player.alive) return;
  player.heal(35);
  player.bleeding = 0;
  player.sleep = Math.min(100, player.sleep + 30);
  toast('急救包 · 恢复 35 HP', 1600, 'good');
  AudioSys.pickup();
}

bootMark('player');
