'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  12b 敌对势力
   · 混沌分裂者（Chaos Insurgency, CI）
       玩家（Nu-7）入场 5 分钟后从重收电梯厅突入，全员与玩家/队友敌对。
   · 蛇之手（Serpent's Hand, SH）
       CI 入场 1 分钟后跟进。他们不打阵地战，目标是"解放异常" ——
       跑到已收容异常的收容间，把**威胁等级最低**的先放出来，再逐个往上放。
       杀掉他们才能止住这波放逐。

   只在「落锤行动」启用：收容行动没有"已收容异常"这个概念。
   ===================================================================== */

const FACTION_LIST = [];
const FACTION_KILLS = { ci: 0, hand: 0 };

const FACTION_DEFS = {
  ci: {
    id: 'ci', name: '混沌分裂者', short: 'CI',
    cloth: 0x2a1c18, skin: 0xb08a70, accent: 0x9a2f22, trim: 0x14181c,
    hp: 150, speed: 3.9, dmgMin: 14, dmgMax: 21, cdMin: 0.18, cdMax: 0.36,
    range: 30, gun: 'hk416', music: 'audio/ci-entry.mp3',
  },
  hand: {
    id: 'hand', name: '蛇之手', short: 'SH',
    cloth: 0x252c1e, skin: 0xc09a80, accent: 0x3c5633, trim: 0x161a13,
    hp: 90, speed: 3.4, dmgMin: 8, dmgMax: 13, cdMin: 0.40, cdMax: 0.80,
    range: 22, gun: 'mp5', music: 'audio/serpents-hand-entry.mp3',
  },
};

/* SCP 威胁等级：蛇之手按这个**从低到高**逐个放逐 */
const SCP_THREAT = { '173': 1, '966': 2, '049': 3, '939': 4, '096': 5, '106': 6, '3114': 7, '076': 8, '682': 9 };

/* 部署时间（秒，从玩家入场算起） */
const FACTION_SCHEDULE = { ciAt: 300, handAt: 360 };

const FACTION_STATE = {
  ciSpawned: false, handSpawned: false, ciCount: 5, handCount: 3, released: 0,
  ciReinforceT: 0, handReinforceT: 0, ciWaves: 0, handWaves: 0,
  seq: { ci: 5, hand: 3 },
};

/* 首次部署之后，每 30 秒补一波人。
   上限存在的意义是"任务还能收得了尾"：场上没到上限才补，
   所以把他们清空之后最多等 30 秒就会有人来 —— 那 30 秒就是你的窗口。 */
const FACTION_REINFORCE = {
  ci: { every: 30, max: 7, batch: 2 },
  hand: { every: 30, max: 5, batch: 1 },
};

/* ---------------------------------------------------------------------
   模型：复用 humanoidRig，靠配色和装备区分阵营
   --------------------------------------------------------------------- */
function buildFactionModel(kind) {
  const d = FACTION_DEFS[kind];
  const rig = humanoidRig({
    skin: d.skin, cloth: d.cloth,
    armW: 0.15, legW: 0.19, torsoW: 0.54, torsoH: 0.74, headR: 0.17,
  });
  const sleeve = new THREE.MeshStandardMaterial({ color: d.cloth, roughness: 0.92 });
  const glove = new THREE.MeshStandardMaterial({ color: d.trim, roughness: 0.85 });
  rig.armLM.material = sleeve; rig.armRM.material = sleeve;
  for (const arm of [rig.armL, rig.armR]) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.15, 0.14), glove);
    hand.position.set(0, -0.60, 0);
    arm.add(hand);
  }
  // 战术背心
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.36), new THREE.MeshStandardMaterial({ color: d.trim, roughness: 0.85 }));
  vest.position.set(0, 0.44, 0); rig.hips.add(vest);
  // 阵营色肩章
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.22), new THREE.MeshStandardMaterial({ color: d.accent, roughness: 0.8 }));
    pad.position.set(sx * 0.3, 0.68, 0); rig.hips.add(pad);
  }
  // 胸前阵营标记
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.11),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate(d.short, kind === 'ci' ? 'CHAOS INSURGENCY' : "SERPENT'S HAND", true), side: THREE.DoubleSide }));
  badge.position.set(0, 0.5, -0.2); badge.rotation.y = PI;
  rig.hips.add(badge);

  if (kind === 'ci') {
    // 混沌分裂者：全套战术装具 + 红色面罩
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.195, 10, 8, 0, TAU, 0, PI * 0.62), new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.7 }));
    helm.position.set(0, 0.16, 0); rig.neck.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.06), new THREE.MeshStandardMaterial({ color: 0x5a1410, roughness: 0.25, metalness: 0.5, emissive: 0x3a0a06 }));
    visor.position.set(0, 0.13, -0.16); rig.neck.add(visor);
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a241c, roughness: 0.9 }));
      p.position.set(-0.15 + i * 0.15, 0.38, -0.2); rig.hips.add(p);
    }
  } else {
    // 蛇之手：兜帽长袍，没有头盔和面罩，挎一个书袋
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8, 0, TAU, 0, PI * 0.66), new THREE.MeshStandardMaterial({ color: d.cloth, roughness: 0.96 }));
    hood.position.set(0, 0.14, 0); hood.scale.set(1, 1.15, 1.08); rig.neck.add(hood);
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.3, 10), new THREE.MeshStandardMaterial({ color: d.cloth, roughness: 0.96 }));
    cowl.position.set(0, -0.06, 0); rig.neck.add(cowl);
    const robe = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.4), new THREE.MeshStandardMaterial({ color: d.accent, roughness: 0.95 }));
    robe.position.set(0, 0.08, 0); rig.hips.add(robe);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.14), new THREE.MeshStandardMaterial({ color: 0x4a3f30, roughness: 0.95 }));
    bag.position.set(0.3, 0.24, 0.14); rig.hips.add(bag);
  }

  // 武器
  const gun = buildGunModel(d.gun, { optic: 'iron', muzzle: 'none_muzzle', grip: 'none_grip', mag: 'std', laser: 'none_laser', stock: 'std' }, { worldScale: true }).group;
  gun.position.set(0, 0.44, -0.24);
  gun.rotation.y = 0.05;
  rig.hips.add(gun);
  rig.gun = gun;
  return rig;
}

/* ---------------------------------------------------------------------
   生成
   --------------------------------------------------------------------- */
function factionSpawnSpot(kind, i) {
  // 混沌分裂者从重收电梯厅突入；蛇之手晚一分钟从轻收容区实验室方向潜入
  const roomId = kind === 'ci' ? 'HCZ-LIFT' : 'LCZ-LAB';
  const rm = FAC.roomAt[roomId];
  const bx = rm ? rm.cx : (kind === 'ci' ? -50 : 24);
  const bz = rm ? rm.cz : (kind === 'ci' ? -25 : 15);
  const a = (i / 4) * TAU + (kind === 'ci' ? 0 : 1.1);
  return { x: bx + Math.cos(a) * 2.6, z: bz + Math.sin(a) * 2.6 };
}

function spawnFaction(kind, count, reinforce) {
  const d = FACTION_DEFS[kind];
  const names = kind === 'ci'
    ? ['CI-α', 'CI-β', 'CI-γ', 'CI-δ', 'CI-ε']
    : ['SH-1', 'SH-2', 'SH-3'];
  for (let i = 0; i < count; i++) {
    // 增援用递增编号，不会和首波重名
    let nm;
    if (reinforce) {
      FACTION_STATE.seq[kind]++;
      nm = (kind === 'ci' ? 'CI-' : 'SH-') + FACTION_STATE.seq[kind];
    } else {
      nm = names[i] || (d.short + '-' + (i + 1));
    }
    const sp = factionSpawnSpot(kind, reinforce ? FACTION_STATE.seq[kind] : i);
    const rig = buildFactionModel(kind);
    rig.group.position.set(sp.x, 0, sp.z);
    scene.add(rig.group);
    const a = {
      kind, def: d, name: nm,
      rig, group: rig.group,
      pos: V3(sp.x, 0, sp.z), vel: V3(), yaw: rand(0, TAU),
      hp: d.hp, maxHp: d.hp, alive: true,
      radius: 0.36, height: 1.8,
      target: null, atkCd: rand(0.3, 1.2), pathT: 0, path: makePathBuf(), pathIdx: 0,
      retargetT: 0, walkT: 0, hitFlash: 0, moving: false,
      // 蛇之手专用：当前要去放逐哪个异常 / 放逐进度
      releaseTarget: null, releaseT: 0,
      damage(amt, attacker, o) {
        if (!this.alive) return;
        this.hp -= amt;
        this.hitFlash = 0.16;
        if (attacker && attacker.pos && attacker !== player) this.target = attacker;
        if (this.hp <= 0) {
          this.alive = false;
          this.group.rotation.x = HPI * 0.88;
          this.group.position.y = 0.35;
          FACTION_KILLS[this.kind]++;
          killfeed(this.name + '（' + this.def.name + '）已击毙', this.kind === 'ci' ? 'good' : 'good');
          addTrauma(0.12);
          // 蛇之手成员倒地 → 掉一份"异常放逐记录"，提示玩家他们在干什么
          if (this.kind === 'hand') toast('蛇之手成员已击毙 · 放逐进度可能暂停', 2600, 'good');
        }
      },
      die() { },
    };
    FACTION_LIST.push(a);
  }
}

/* ---------------------------------------------------------------------
   蛇之手：挑选下一个要放逐的异常（威胁最低的已收容者）
   --------------------------------------------------------------------- */
function nextReleaseTarget() {
  let best = null, bt = 99;
  for (const s of SCP_LIST) {
    if (s.alive) continue;                 // 还活着的不用放
    if (!GAME.contained[s.key]) continue;  // 只放"已收容"的
    const t = SCP_THREAT[s.key] || 5;
    if (t < bt) { bt = t; best = s; }
  }
  return best;
}

/* 把一只已收容的异常重新放出来 */
function releaseSCP(s, byWho) {
  if (!s || s.alive) return false;
  s.alive = true;
  s.hp = s.maxHp;
  s.enraged = false; s.rageT = 0; s.enrageT = 0;
  s.hooded = false; s.observed = false;
  s.revived = false; s.deadT = 0; s.stunT = 0; s.grabT = 0; s.grabbing = null;
  s.state = 'idle'; s.stateT = 0; s.target = null;
  s.active = true; s.awake = true; s.wakeTime = 0;
  s.pos.set(s.spawnX, 0, s.spawnZ);
  s.model.group.rotation.set(0, 0, 0);
  s.model.group.position.set(s.pos.x, 0, s.pos.z);
  s.model.group.scale.set(1, 1, 1);
  if (s.model.hood) s.model.hood.visible = false;
  if (s.model.scrambleQuad) s.model.scrambleQuad.visible = false;
  if (!s.model.group.parent) scene.add(s.model.group);
  delete GAME.contained[s.key];
  FACTION_STATE.released++;
  AudioSys.scpRoar(s.key, Math.hypot(s.pos.x - player.pos.x, s.pos.z - player.pos.z));
  flashScreen(0.28, '#7a2a3a');
  return true;
}

/* ---------------------------------------------------------------------
   部署时间线
   --------------------------------------------------------------------- */
function checkFactionSchedule() {
  if (GAME.mission === 'contain096') return;
  if (!FACTION_STATE.ciSpawned && GAME.elapsed >= FACTION_SCHEDULE.ciAt) {
    FACTION_STATE.ciSpawned = true;
    spawnFaction('ci', FACTION_STATE.ciCount);
    AudioSys.playMusic(FACTION_DEFS.ci.music, 0.5, false);
    broadcast('⚠ 侦测到未知武装单位 · 重收电梯厅 · 识别为【混沌分裂者】', 7000);
    subtitle('混沌分裂者突入', '他们不是来收容的 —— 见到 MTF 就开火', 5200);
    toast('⚠ 混沌分裂者已突入设施 · 全员敌对', 6000, 'bad');
    flashScreen(0.4, '#8a2a22');
    AudioSys.alarm();
    GAME.alarmLevel = 2;
  }
  if (!FACTION_STATE.handSpawned && GAME.elapsed >= FACTION_SCHEDULE.handAt) {
    FACTION_STATE.handSpawned = true;
    spawnFaction('hand', FACTION_STATE.handCount);
    AudioSys.playMusic(FACTION_DEFS.hand.music, 0.5, false);
    broadcast('⚠ 第二波入侵者 · 识别为【蛇之手】· 目标：解放已收容异常', 7000);
    subtitle('蛇之手跟进', '他们会把已收容的异常逐个放出来 —— 先放弱的，再放强的', 5600);
    toast('⚠ 蛇之手开始放逐异常 · 击杀他们才能止住', 6400, 'bad');
    flashScreen(0.4, '#3a6a32');
    GAME.alarmLevel = 2;
  }
}

/* 增援：首次部署之后每 30 秒补一波（场上没到上限才补） */
function checkFactionReinforce(dt) {
  if (GAME.mission === 'contain096') return;
  // ⚠️ 5K 行动不补人：这个行动的核心是"守住 1440 六十秒"，
  //    不断补人会把一个有时间上限的目标变成无解的消耗战。
  if (GAME.mission === 'fivek') return;
  for (const kind of ['ci', 'hand']) {
    const dep = kind === 'ci' ? FACTION_STATE.ciSpawned : FACTION_STATE.handSpawned;
    if (!dep) continue;
    const cfg = FACTION_REINFORCE[kind];
    const key = kind === 'ci' ? 'ciReinforceT' : 'handReinforceT';
    if (FACTION_STATE[key] <= 0) FACTION_STATE[key] = cfg.every;   // 首次部署后开始计时
    FACTION_STATE[key] -= dt;
    if (FACTION_STATE[key] > 0) continue;
    FACTION_STATE[key] = cfg.every;
    const alive = factionAlive(kind);
    if (alive >= cfg.max) continue;
    const n = Math.min(cfg.batch, cfg.max - alive);
    spawnFaction(kind, n, true);
    if (kind === 'ci') FACTION_STATE.ciWaves++; else FACTION_STATE.handWaves++;
    const d = FACTION_DEFS[kind];
    AudioSys.door(true);
    broadcast('◤ ' + d.name + ' 增援抵达 · ' + n + ' 人进入设施（场上 ' + (alive + n) + ' 人）');
    toast('⚠ ' + d.name + ' 补充了 ' + n + ' 人', 3400, 'bad');
  }
}

/* ---------------------------------------------------------------------
   主更新
   --------------------------------------------------------------------- */
function updateFactions(dt) {
  if (GAME.mission === 'contain096') return;
  checkFactionSchedule();
  checkFactionReinforce(dt);
  if (!FACTION_LIST.length) return;

  for (const a of FACTION_LIST) {
    if (!a.alive) {
      if (a.group.parent) a.group.position.y = dampF(a.group.position.y, -0.6, 1.2, dt);
      continue;
    }
    const d = a.def;
    a.atkCd = Math.max(0, a.atkCd - dt);
    if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt);

    // ---- 选目标：玩家或队友，取最近的且有视线的 ----
    // ⚠️ 玩家自己就是 CI / 蛇之手时（重生换来的身份），同阵营的 NPC 不该打他 ——
    //    否则"重生为蛇之手"会变成"被自己的同伙围殴"。
    a.retargetT -= dt;
    let best = a.target;
    if (a.retargetT <= 0 || !best || !best.alive) {
      a.retargetT = 0.26 + Math.random() * 0.12;
      best = null;
      let bd = d.range + 6;
      const mySide = (typeof roleView === 'function' && roleView()) ? roleView().side : null;
      if (player.alive && mySide !== a.kind) {
        const dd = Math.hypot(player.pos.x - a.pos.x, player.pos.z - a.pos.z);
        if (dd < bd && hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, player.pos.x, player.pos.y + 1.4, player.pos.z)) { bd = dd; best = player; }
      }
      for (const al of ALLY_LIST) {
        if (!al.alive) continue;
        const dd = Math.hypot(al.pos.x - a.pos.x, al.pos.z - a.pos.z);
        if (dd < bd && hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, al.pos.x, al.pos.y + 1.4, al.pos.z)) { bd = dd; best = al; }
      }
      a.target = best;
    }
    const bd = best ? Math.hypot(best.pos.x - a.pos.x, best.pos.z - a.pos.z) : 999;

    // ---- 决定走位目标 ----
    let tx, tz, speed = d.speed;
    if (a.kind === 'hand') {
      // 蛇之手：优先跑去放逐异常；被玩家贴近时先还击
      const combat = best && bd < 14;
      if (!a.releaseTarget || a.releaseTarget.alive) a.releaseTarget = nextReleaseTarget();
      if (a.releaseTarget) {
        const rt = a.releaseTarget;
        tx = rt.spawnX; tz = rt.spawnZ;
        const rd = Math.hypot(rt.spawnX - a.pos.x, rt.spawnZ - a.pos.z);
        if (rd < 3.2) {
          // 到位：开始放逐（3 秒）
          a.releaseT += dt;
          speed = 0;
          if (a.releaseT === dt) {
            broadcast('◤ 蛇之手正在放逐 ' + rt.name + ' · 阻止他们');
            subtitle('蛇之手正在放逐异常', rt.name + ' —— 快去阻止', 3200);
          }
          if (a.releaseT >= 3.0) {
            a.releaseT = 0;
            const nm = rt.name;
            if (releaseSCP(rt, a)) {
              killfeed('⚠ ' + nm + ' 被蛇之手放逐 · 收容失效', 'bad');
              broadcast('◤ 收容失效 · ' + nm + ' 已被蛇之手放出');
              toast('⚠ ' + nm + ' 已重新突破收容', 4600, 'bad');
            }
            a.releaseTarget = nextReleaseTarget();
          }
        } else a.releaseT = 0;
      } else {
        // 没有可放的异常了 → 转为骚扰玩家
        tx = best ? best.pos.x : player.pos.x; tz = best ? best.pos.z : player.pos.z;
      }
      if (combat && bd < 6) { // 被逼到脸上就先拉开
        const dx = a.pos.x - best.pos.x, dz = a.pos.z - best.pos.z;
        const dd = Math.max(0.001, Math.hypot(dx, dz));
        tx = a.pos.x + dx / dd * 2.4; tz = a.pos.z + dz / dd * 2.4;
      }
    } else {
      // 混沌分裂者：主动接敌，保持 6~14m
      if (best) {
        const dx = a.pos.x - best.pos.x, dz = a.pos.z - best.pos.z;
        const dd = Math.max(0.001, Math.hypot(dx, dz));
        if (dd < 6) { tx = a.pos.x + dx / dd * 2.6; tz = a.pos.z + dz / dd * 2.6; }
        else if (dd > 14) { tx = best.pos.x; tz = best.pos.z; }
        else { tx = a.pos.x; tz = a.pos.z; speed = 0; }
      } else {
        // 找不到人：朝玩家最后已知方向推进
        tx = player.pos.x; tz = player.pos.z;
      }
    }

    // ---- 移动（导航 + 碰撞）----
    const mdx = tx - a.pos.x, mdz = tz - a.pos.z;
    const md = Math.hypot(mdx, mdz);
    if (speed > 0 && md > 0.7) {
      a.pathT -= dt;
      if (a.pathT <= 0 || a.path.n === 0 || a.pathIdx >= a.path.n) {
        a.pathT = 0.75;
        navPath(a.pos.x, a.pos.z, tx, tz, a.path);
        a.pathIdx = 0;
      }
      let vx = mdx / md, vz = mdz / md;
      const P = a.path;
      if (P.n > 0) {
        while (a.pathIdx < P.n - 1 && Math.hypot(P.pts[a.pathIdx].x - a.pos.x, P.pts[a.pathIdx].z - a.pos.z) < 0.7) a.pathIdx++;
        const wp = P.pts[a.pathIdx];
        const wx = wp.x - a.pos.x, wz = wp.z - a.pos.z;
        const wd = Math.hypot(wx, wz);
        if (wd > 0.05) { vx = wx / wd; vz = wz / wd; }
      }
      a.pos.x += vx * speed * dt;
      a.pos.z += vz * speed * dt;
      collideMove(a.pos, a.radius, a.height, 0.5);
      a.pos.y = floorAt(a.pos.x, a.pos.z, a.pos.y + 0.3);
      a.yaw = angLerp(a.yaw, Math.atan2(-vx, -vz), clamp(dt * 7, 0, 1));
      a.walkT += speed * dt;
      a.moving = true;
    } else a.moving = false;

    // ---- 开火 ----
    if (best && bd < d.range && a.atkCd <= 0 && hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, best.pos.x, best.pos.y + 1.3, best.pos.z)) {
      a.atkCd = rand(d.cdMin, d.cdMax);
      const dmg = rand(d.dmgMin, d.dmgMax);
      const ey = best.pos.y + (best === player ? 1.35 : 1.3);
      const ex = best.pos.x + rand(-0.3, 0.3), ez = best.pos.z + rand(-0.3, 0.3);
      best.damage(dmg, a, { limb: Math.random() < 0.3 ? 'torso' : 'limb' });
      const from = V3(a.pos.x, a.pos.y + 1.45, a.pos.z);
      spawnTracer(from, V3(ex, ey, ez));
      AudioSys.gunshot('rifle', Math.hypot(from.x - camera.position.x, from.z - camera.position.z));
      a.yaw = Math.atan2(-(best.pos.x - a.pos.x), -(best.pos.z - a.pos.z));
    }

    // ---- 模型姿态 ----
    a.group.position.set(a.pos.x, a.pos.y, a.pos.z);
    a.group.rotation.y = a.yaw;
    const sw = a.moving ? Math.sin(a.walkT * 2.7) * 0.55 : 0;
    a.rig.legL.rotation.x = sw; a.rig.legR.rotation.x = -sw;
    a.rig.armR.rotation.set(1.20 + sw * 0.12, 0, -0.30);
    a.rig.armL.rotation.set(1.20 - sw * 0.12, 0, 0.30);
    if (best) {
      const dy = Math.atan2(-(best.pos.x - a.pos.x), -(best.pos.z - a.pos.z)) - a.yaw;
      a.rig.hips.rotation.y = clamp(dy, -0.9, 0.9);
      a.rig.armR.rotation.set(1.44, 0, -0.26);
      a.rig.armL.rotation.set(1.36, 0, 0.40);
    } else a.rig.hips.rotation.y = dampF(a.rig.hips.rotation.y, 0, 6, dt);
    if (a.hitFlash > 0) {
      const k = 1 - (a.hitFlash / 0.16) * 0.08;
      a.group.scale.set(1 / k, k, 1 / k);
    } else if (a.group.scale.y !== 1) a.group.scale.set(1, 1, 1);
    // 蛇之手放逐时手会抬起
    if (a.kind === 'hand' && a.releaseT > 0) {
      a.rig.armR.rotation.set(2.2, 0, -0.5);
      a.rig.armL.rotation.set(2.2, 0, 0.5);
    }
    if (a.hp < a.maxHp * 0.35 && Math.random() < dt * 1.2) {
      spawnBloodBurst(V3(a.pos.x, a.pos.y + 1.2, a.pos.z), 'blood', 2);
    }
  }
}

/* 当前存活的两支势力人数（HUD 用） */
function factionAlive(kind) {
  let n = 0;
  for (const a of FACTION_LIST) if (a.alive && a.kind === kind) n++;
  return n;
}
function factionsDeployed() { return FACTION_STATE.ciSpawned || FACTION_STATE.handSpawned; }

bootMark('factions');
