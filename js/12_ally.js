'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  12 MTF 队友（Nu-7 "落锤" 火力组）
   3 名队员跟随玩家推进，自主交战，可被击倒。
   ===================================================================== */

const ALLY_LIST = [];

const ALLY_NAMES = ['Cpl. Reyes', 'Sgt. Kovac', 'Spc. Adeyemi'];
const ALLY_CALLSIGNS = ['Nu-7-2', 'Nu-7-3', 'Nu-7-4'];

/* MTF 火力组不是一开始就在设施里的 —— 开局 1 分钟后才进场 */
const MTF_DEPLOY_AT = 60;

/* 首次部署之后每 30 秒补一批人（场上没到上限才补）。
   上限 5 是为了让"清场后撤离"这件事还做得到 —— 清空之后你有 30 秒窗口。 */
const MTF_REINFORCE = { every: 30, max: 5, batch: 1 };

/* ---------------------------------------------------------------------
   5K 行动里 Nu-22「火箭侠」作为【敌人】出现时（玩家抽到反叛之狐）的火力削弱。
   ⚠️ 只在敌对时生效 —— 玩家自己抽到 Nu-22 编制位时，AI 队友保持原有战力，
      否则就成了"削弱玩家阵营"，和之前"加强人类阵营"的调整自相矛盾。

   为什么要削：三名队员同时锁定玩家（40m 内无条件转火）时，
   原参数是 17.5 伤害 / 0.25 秒 / 人 ≈ 184 DPS，
   而 65% 的射击走 limb 分支（玩家 damage() 只对 torso/head/leg 做减免，limb 等于无视护甲），
   结果反叛之狐落地约 0.5 秒就蒸发，处决引导（6 秒不能动）根本推不动。

   三重削弱（单削数值不够 —— 三人一起打，伤害砍半照样瞬秒）：
     ① 单发伤害 ×0.55      17.5 → 9.6
     ② 个人射击间隔 ×1.6    0.25 → 0.40 秒
     ③ 小队整体节流        三人不再齐射，全队合计最快 1/0.34 秒一发（交替掩护）
   合计 ≈ 25 DPS（原 184）→ 玩家 100 HP 从"约 0.5 秒"变成"约 4 秒"可周旋。
   --------------------------------------------------------------------- */
const NU22_ENEMY_FIRE = {
  dmgMul: 0.55,      // 14~21 → 7.7~11.6
  cdMul: 1.60,       // 0.17~0.33 → 0.27~0.53 秒
  spread: 0.62,      // 弹着散布 0.35 → 0.62（更容易被掩体/门框挡掉）
  volleyGap: 0.34,   // 小队级开火节流：两次开火之间至少隔这么久（全体共享）
};

function checkMtfReinforce(dt) {
  if (GAME.mission === 'contain096') return;
  // ⚠️ 5K 行动不补人：反叛之狐的目标之一是"清除全部 Nu-22"，
  //    无限补人会让这个目标永远达不成（和 096 打不死、势力无限刷是同一类死局）。
  if (GAME.mission === 'fivek') return;
  if (!GAME.mtfDeployed) return;
  if (GAME.mtfReinforceT <= 0) GAME.mtfReinforceT = MTF_REINFORCE.every;
  GAME.mtfReinforceT -= dt;
  if (GAME.mtfReinforceT > 0) return;
  GAME.mtfReinforceT = MTF_REINFORCE.every;
  let alive = 0;
  for (const a of ALLY_LIST) if (a.alive) alive++;
  if (alive >= MTF_REINFORCE.max) return;
  const n = Math.min(MTF_REINFORCE.batch, MTF_REINFORCE.max - alive);
  for (let i = 0; i < n; i++) spawnAllyReinforcement();
  AudioSys.door(true);
  broadcast('◤ Nu-7 增援抵达 · ' + n + ' 名队员进入设施（场上 ' + (alive + n) + ' 人）');
  toast('Nu-7 补充了 ' + n + ' 名队员', 3400, 'good');
}

/* 增援落位：优先在玩家周围 8~14m 的空地上，找不到就退回入口 */
function spawnAllyReinforcement() {
  let x = FAC.spawn.x, z = FAC.spawn.z;
  if (player.alive) {
    for (let k = 0; k < 6; k++) {
      const a = rand(0, TAU), r = rand(8, 14);
      const tx = player.pos.x + Math.cos(a) * r, tz = player.pos.z + Math.sin(a) * r;
      if (openAtWorld(tx, tz, 0)) { x = tx; z = tz; break; }
    }
  }
  GAME.allySeq = (GAME.allySeq || 4) + 1;
  return spawnAllyAt(x, z, 'Nu-7-' + GAME.allySeq, 'Nu-7-' + GAME.allySeq);
}

function buildAllyModel(idx) {
  const rig = humanoidRig({
    skin: 0xc8a888, cloth: 0x2b3340,
    armW: 0.15, legW: 0.19, torsoW: 0.54, torsoH: 0.74, headR: 0.17,
  });
  const g = rig.group;
  // 袖子：手臂用布料色，别让队员光着膀子
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2f3a49, roughness: 0.92 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.85 });
  rig.armLM.material = sleeve; rig.armRM.material = sleeve;
  for (const arm of [rig.armL, rig.armR]) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.15, 0.14), glove);
    hand.position.set(0, -0.60, 0);
    arm.add(hand);
  }
  // 战术背心
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.36), new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.85 }));
  vest.position.set(0, 0.44, 0); rig.hips.add(vest);
  // 弹匣袋
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.9 }));
    p.position.set(-0.15 + i * 0.15, 0.38, -0.2); rig.hips.add(p);
  }
  // 头盔
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.195, 10, 8, 0, TAU, 0, PI * 0.62), new THREE.MeshStandardMaterial({ color: 0x232a34, roughness: 0.7 }));
  helm.position.set(0, 0.16, 0); rig.neck.add(helm);
  // 面罩
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.06), new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.3, metalness: 0.4 }));
  visor.position.set(0, 0.13, -0.16); rig.neck.add(visor);
  // 肩章（Nu-7 蓝）
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.22), new THREE.MeshStandardMaterial({ color: 0x2f4f8a, roughness: 0.8 }));
    pad.position.set(sx * 0.3, 0.68, 0); rig.hips.add(pad);
  }
  // 步枪（世界模型，保持真实尺寸）—— 位置让双手正好落在护木/握把附近
  const gun = buildGunModel('hk416', { optic: 'reddot', muzzle: 'comp', grip: 'vertical', mag: 'std', laser: 'none_laser', stock: 'std' }, { worldScale: true }).group;
  gun.position.set(0, 0.44, -0.24);
  gun.rotation.y = 0.05;
  rig.hips.add(gun);
  rig.gun = gun;
  return rig;
}

function spawnAllies() {
  const fivek = GAME.mission === 'fivek';
  const names = fivek ? ['Nu-22-2', 'Nu-22-3', 'Nu-22-4'] : ALLY_NAMES;
  const spots = [
    { dx: 2.2, dz: 1.4 }, { dx: -1.8, dz: 2.2 }, { dx: 0.6, dz: 3.4 },
  ];
  for (let i = 0; i < 3; i++) {
    const s = spots[i];
    spawnAllyAt(FAC.spawn.x + s.dx, FAC.spawn.z + s.dz, names[i],
      fivek ? names[i] : ALLY_CALLSIGNS[i]);
  }
}

/* 在指定位置加入一名队友（护送撤离的研究员会走这条路"转职"） */
function spawnAllyAt(x, z, name, callsign) {
  const idx = ALLY_LIST.length % 3;
  const rig = buildAllyModel(idx);
  rig.group.position.set(x, 0, z);
  scene.add(rig.group);
  const a = {
    name: name || ('Nu-7-' + (ALLY_LIST.length + 2)),
    callsign: callsign || ('Nu-7-' + (ALLY_LIST.length + 2)),
    rig, group: rig.group,
    pos: V3(x, 0, z), vel: V3(), yaw: rand(0, TAU),
    hp: 170, maxHp: 170, alive: true,
    radius: 0.36, height: 1.8,
    state: 'follow', target: null, atkCd: 0, pathT: 0, path: makePathBuf(), pathIdx: 0,
    retargetT: 0,
    walkT: 0, muzzleT: 0, flashT: 0, hitFlash: 0, lastPos: V3(x, 0, z),
    damage(amt, attacker, o) {
      if (!this.alive) return;
      this.hp -= amt;
      this.hitFlash = 0.16;
      if (attacker && attacker.pos) this.target = attacker;
      if (this.hp <= 0) {
        this.alive = false;
        this.group.rotation.x = HPI * 0.88;
        this.group.position.y = 0.35;
        killfeed(this.name + ' 阵亡', 'bad');
        addTrauma(0.2);
      }
    },
    die() { },
  };
  ALLY_LIST.push(a);
  return a;
}

/* 玩家与「特遣队队友」的关系。敌对时：他们打你、你也能打他们。
   ⚠️ 和 playerHostileToSite() 一样，这是"队友敌意"的**唯一来源** ——
   队友 AI 与射线判定都读它，否则又会出现"他们打得到我、我打不到他们"的不对称。 */
function alliesHostileToPlayer() {
  if (player.isAI || player.isSCP) return false;
  const r = (typeof roleView === 'function') ? roleView() : currentRole();
  if (!r) return false;
  if (r.side === 'ci' || r.side === 'hand') return true;           // 混沌分裂者 / 蛇之手 vs 基金会
  if (GAME.mission === 'fivek' && r.id === 'rebel') return true;   // 反叛之狐 vs Nu-22
  return false;
}

/* 还活着几名特遣队员（反叛之狐的"清除 Nu-22"目标计数） */
function nu22Alive() {
  let n = 0;
  for (const a of ALLY_LIST) if (a.alive) n++;
  return n;
}

/* MTF 的部署时间线：开局 1 分钟后才进场（设施里先只有你自己） */
function checkMtfDeploy() {
  if (GAME.mission === 'contain096') return;
  if (GAME.mtfDeployed) return;
  if (GAME.elapsed < MTF_DEPLOY_AT) return;
  GAME.mtfDeployed = true;
  spawnAllies();
  AudioSys.door(true);
  broadcast('◤ Nu-7 火力组已进入设施 · 三名队员正在向你的位置靠拢');
  subtitle('Nu-7 已部署', '队友进场了 —— 他们会跟着你、自主交战、把倒地的你拖起来', 4600);
}

function updateAllies(dt) {
  checkMtfDeploy();
  checkMtfReinforce(dt);
  const hostile = alliesHostileToPlayer();
  // Nu-22 与玩家敌对时（玩家是反叛之狐）才降火力，见 NU22_ENEMY_FIRE 注释
  const nu22Nerf = (GAME.mission === 'fivek' && hostile) ? NU22_ENEMY_FIRE : null;
  // 小队级开火节流：全队共享一个倒计时，一次只有一个人能开火（交替掩护）。
  // ⚠️ 必须在队友循环【外】递减 —— 放进循环里会被减 3 次。
  if (nu22Nerf) GAME.nu22Volley = Math.max(0, (GAME.nu22Volley || 0) - dt);
  else GAME.nu22Volley = 0;
  // 5K：玩家不是 Nu-22 时（反叛之狐等），AI 的 Nu-22 小队**自己执行净化** ——
  // 他们会主动去 1440 身边守着。否则玩家抽到反叛之狐时，净化程序永远推不动。
  const fivekEscort = GAME.mission === 'fivek'
    && typeof S1440 !== 'undefined' && S1440.active && S1440.ent
    && !(typeof roleView === 'function' && roleView().id === 'mtf');
  for (const a of ALLY_LIST) {
    if (!a.alive) {
      if (a.group.parent) a.group.position.y = dampF(a.group.position.y, -0.6, 1.2, dt);
      continue;
    }
    a.atkCd = Math.max(0, a.atkCd - dt);
    a.flashT = Math.max(0, a.flashT - dt);
    if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt);
    // 选目标：最近的、有视线的 SCP（含 049-2）
    // ⚠️ 每帧对每名队友做 9~15 次射线检测太贵（3 人 = 约 40 次/帧）。
    //    改成 0.22 秒重评一次，中间沿用上次结果；交战中的目标每帧复查视线。
    a.retargetT -= dt;
    let best = a.target;
    if (a.retargetT <= 0 || !best || !best.alive) {
      a.retargetT = 0.22 + Math.random() * 0.1;
      best = null;
      let bd = 30;
      for (const s of SCP_LIST) {
        if (!s.alive) continue;
        const d = Math.hypot(s.pos.x - a.pos.x, s.pos.z - a.pos.z);
        if (d < bd && hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, s.pos.x, s.pos.y + s.height * 0.6, s.pos.z)) { bd = d; best = s; }
      }
      for (const m of MINIONS) {
        if (!m.alive) continue;
        const d = Math.hypot(m.pos.x - a.pos.x, m.pos.z - a.pos.z);
        if (d < bd && hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, m.pos.x, m.pos.y + 1.2, m.pos.z)) { bd = d; best = m; }
      }
      a.target = best;
    }
    // ⚠️ 这段必须放在 SCP 扫描【之后】：玩家是混沌分裂者时，
    //    玩家要无条件压过 SCP 成为第一目标，否则队友会被路过的异常勾走。
    if (hostile && player.alive) {
      const pd = Math.hypot(player.pos.x - a.pos.x, player.pos.z - a.pos.z);
      if (pd < 40) {
        if (best !== player && !a.hostileTold) {
          a.hostileTold = true;
          // 识别到敌对人员后给一段抬枪/确认的反应时间 ——
          // 否则三名队员会在同一帧集体转火，玩家连转身的机会都没有。
          a.atkCd = Math.max(a.atkCd, nu22Nerf ? 0.7 : 0.3);
          killfeed(a.callsign + ' 识别出敌对人员', 'bad');
          toast('⚠ MTF 把你当成了混沌分裂者 —— 他们会开火', 3600, 'bad');
        }
        a.target = player; best = player;
      }
    }
    const bd = best ? Math.hypot(best.pos.x - a.pos.x, best.pos.z - a.pos.z) : 999;

    // 站位：跟随玩家，但保持 5~9 米，遇敌则停下射击
    let tx, tz, speed = 3.9;
    if (best && bd < 26) {
      // 交战：稍微保持距离
      const dx = a.pos.x - best.pos.x, dz = a.pos.z - best.pos.z;
      const dd = Math.max(0.001, Math.hypot(dx, dz));
      if (dd < 7) { tx = a.pos.x + dx / dd * 2.4; tz = a.pos.z + dz / dd * 2.4; }
      else { tx = a.pos.x; tz = a.pos.z; }
      speed = 2.6;
    } else if (fivekEscort) {
      // 自己去 1440 身边守着（保持在 5 米内）
      const e40 = S1440.ent;
      const dx = e40.pos.x - a.pos.x, dz = e40.pos.z - a.pos.z;
      const dd = Math.max(0.001, Math.hypot(dx, dz));
      if (dd > 5.5) { tx = e40.pos.x - dx / dd * 4; tz = e40.pos.z - dz / dd * 4; }
      else { tx = a.pos.x; tz = a.pos.z; speed = 0; }
    } else {
      const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
      const dd = Math.max(0.001, Math.hypot(dx, dz));
      if (dd > 8.5) {
        tx = player.pos.x - dx / dd * 5; tz = player.pos.z - dz / dd * 5;
      } else if (dd < 2.6) {
        tx = a.pos.x - dx / dd * 2; tz = a.pos.z - dz / dd * 2;
      } else {
        // 处于"站位带"（2.6~8.5m）：正常情况下原地待命；
        // 但如果看不见玩家（多半是被气密门或墙隔开了），必须继续往玩家方向靠 ——
        // 否则玩家穿过门之后，队友会永远停在门外面等着。
        if (!hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, player.pos.x, player.pos.y + 1.5, player.pos.z)) {
          tx = player.pos.x - dx / dd * 3.0; tz = player.pos.z - dz / dd * 3.0;
        } else { tx = a.pos.x; tz = a.pos.z; }
      }
    }

    const mdx = tx - a.pos.x, mdz = tz - a.pos.z;
    const md = Math.hypot(mdx, mdz);
    if (md > 0.7) {
      a.pathT -= dt;
      if (a.pathT <= 0 || a.path.n === 0 || a.pathIdx >= a.path.n) {
        a.pathT = 0.7;
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

    // 开火
    // ⚠️ nu22Nerf 时全队共享开火节奏（volleyGap）—— 三人交替掩护而不是齐射。
    //    这是削掉"落地瞬秒"的关键：只降伤害/射速的话，三人一起打照样致命。
    const canFire = !nu22Nerf || GAME.nu22Volley <= 0;
    if (best && bd < 28 && a.atkCd <= 0 && canFire) {
      // Nu-22 作为敌人时弹着更散 / 间隔更长 / 伤害更低（见 NU22_ENEMY_FIRE）
      const spread = nu22Nerf ? nu22Nerf.spread : 0.35;
      const ey = best.pos.y + best.height * (Math.random() < 0.16 ? 0.92 : 0.55);
      const ex = best.pos.x + rand(-spread, spread), ez = best.pos.z + rand(-spread, spread);
      if (hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, ex, ey, ez)) {
        if (nu22Nerf) GAME.nu22Volley = nu22Nerf.volleyGap;
        a.atkCd = (0.17 + Math.random() * 0.16) * (nu22Nerf ? nu22Nerf.cdMul : 1);
        a.flashT = 0.05;
        const dmg = (14 + Math.random() * 7) * (nu22Nerf ? nu22Nerf.dmgMul : 1);
        // 目标是玩家（混沌分裂者身份）时走 player.damage
        if (best === player) {
          player.damage(dmg, a, { limb: Math.random() < 0.35 ? 'torso' : 'limb' });
        } else if (best.isMinion) {
          // SCP-049-2 小怪没有 def 字段，必须走它自己的 damage()，
          // 否则 damageSCP 会读 s.def.immuneWhenMoving 直接抛异常
          best.damage(dmg, a, {});
        } else damageSCP(best, dmg, { head: false, from: a });
        const from = V3(a.pos.x, a.pos.y + 1.45, a.pos.z);
        const to = V3(ex, ey, ez);
        spawnTracer(from, to);
        AudioSys.gunshot('rifle', Math.hypot(from.x - camera.position.x, from.z - camera.position.z));
        a.yaw = Math.atan2(-(best.pos.x - a.pos.x), -(best.pos.z - a.pos.z));
      }
    }

    // 模型更新
    a.group.position.set(a.pos.x, a.pos.y, a.pos.z);
    a.group.rotation.y = a.yaw;
    const sw = a.moving ? Math.sin(a.walkT * 2.7) * 0.55 : 0;
    a.rig.legL.rotation.x = sw; a.rig.legR.rotation.x = -sw;
    // ⚠️ rotation.x 取【正】才是手臂朝前。旧代码用负值，双臂是朝后伸的。
    //    巡逻持枪：双臂前伸 + 略微内收，双手正好落在护木/握把附近。
    a.rig.armR.rotation.set(1.20 + sw * 0.12, 0, -0.30);
    a.rig.armL.rotation.set(1.20 - sw * 0.12, 0, 0.30);
    if (best) {
      const dy = Math.atan2(-(best.pos.x - a.pos.x), -(best.pos.z - a.pos.z)) - a.yaw;
      a.rig.hips.rotation.y = clamp(dy, -0.9, 0.9);
      // 交战：枪口抬起指向目标
      a.rig.armR.rotation.set(1.44, 0, -0.26);
      a.rig.armL.rotation.set(1.36, 0, 0.40);
    } else a.rig.hips.rotation.y = dampF(a.rig.hips.rotation.y, 0, 6, dt);
    // 枪口火焰
    if (a.rig.gun) a.rig.gun.visible = true;
    if (a.hitFlash > 0) {
      const k = 1 - (a.hitFlash / 0.16) * 0.08;
      a.group.scale.set(1 / k, k, 1 / k);
    } else if (a.group.scale.y !== 1) a.group.scale.set(1, 1, 1);
    // 血雾
    if (a.hp < a.maxHp * 0.35 && Math.random() < dt * 1.2) {
      spawnBloodBurst(V3(a.pos.x, a.pos.y + 1.2, a.pos.z), 'blood', 2);
    }
  }
}

bootMark('ally');
