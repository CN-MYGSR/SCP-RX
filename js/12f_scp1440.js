'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  12f SCP-1440「不知来处的老人」
   只在「5K 行动」出现。

   设定要点（照 SCP-5000 / SCP-1440 原文）：
   · Keter 级。它本身没有敌意，也不会抵抗任何试图收容它的人。
   · 但任何与人类有关的东西长期暴露在它附近，都会开始崩塌 ——
     直到那个"人类要素"被毁灭或死亡为止。
   · 5K 情景里，基金会把它当**武器**：由 Nu-22「火箭侠」在人群之间运送。
     Nu-22 成员**不受它影响**，这就是运输可行的原因。

   游戏里：
   · 它免疫一切伤害（子弹直接穿过去），只会慢慢在站点里游荡。
   · 14 米内的人类持续受到侵蚀 —— 站点的人靠太近就会被它清掉。
   · 你（Nu-22）不受影响。待在它 15 米内，滞留计时才会推进；
     离开后计时会以半速回退。满 5 分钟即净化完成。
   ===================================================================== */

const S1440 = {
  active: false,
  ent: null,
  holdT: 0,
  holdNeed: 300,
  wanderT: 0, wx: 0, wz: 0,
  curseKills: 0,
  lastMile: -1,
  follow: false,
  executed: false,
  holding: false,
};
const S1440_HOLD_R = 15;      // 玩家在这个半径内，计时才推进
const S1440_CURSE_R = 14;     // 异常影响半径
const S1440_CURSE_DPS = 9;    // 每秒侵蚀（只对人类）

/* ---------------------------------------------------------------------
   模型：驼背的老人 + 布袋 + 破斗篷
   --------------------------------------------------------------------- */
function build1440Model() {
  const rig = humanoidRig({
    skin: 0xc4ae94, cloth: 0x4a4438,
    armW: 0.125, legW: 0.155, torsoW: 0.46, torsoH: 0.66, headR: 0.165,
    hunched: 0.42,
  });
  const g = rig.group;
  const robe = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.98 });
  rig.armLM.material = robe; rig.armRM.material = robe;
  // 破斗篷下摆
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.40, 0.72, 9), robe);
  skirt.position.set(0, 0.18, 0); rig.hips.add(skirt);
  // 灰白长发与胡子
  const hairMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 1.0 });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.185, 10, 8, 0, TAU, 0, PI * 0.72), hairMat);
  hair.position.set(0, 0.14, 0.01); hair.scale.set(1.02, 1.15, 1.02); rig.neck.add(hair);
  const beard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.13), hairMat);
  beard.position.set(0, -0.05, -0.1); rig.neck.add(beard);
  // 布袋（挂在左肩）
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 7), new THREE.MeshStandardMaterial({ color: 0x8a7c62, roughness: 1.0 }));
  bag.position.set(-0.3, 0.28, 0.1); bag.scale.set(0.8, 1.05, 0.8); rig.hips.add(bag);
  // 手杖
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 1.15, 6), new THREE.MeshStandardMaterial({ color: 0x6a5a42, roughness: 0.95 }));
  stick.position.set(0.24, -0.15, -0.06); rig.hips.add(stick);
  return rig;
}

/* ---------------------------------------------------------------------
   生成 / 清理
   --------------------------------------------------------------------- */
function spawn1440() {
  if (GAME.mission !== 'fivek') return null;
  const rm = FAC.roomAt['EZ-LOBBY'] || null;
  const bx = rm ? rm.cx : FAC.spawn.x, bz = rm ? rm.cz : FAC.spawn.z;
  let x = bx - 3, z = bz - 3;
  if (!openAtWorld(x, z, 0)) { x = bx; z = bz; }
  const rig = build1440Model();
  rig.group.position.set(x, 0, z);
  scene.add(rig.group);
  S1440.active = true;
  S1440.ent = {
    pos: V3(x, 0, z), yaw: rand(0, TAU), radius: 0.34, height: 1.72,
    rig, group: rig.group, walkT: 0, moving: false,
  };
  S1440.holdT = 0;
  S1440.curseKills = 0;
  S1440.lastMile = -1;
  S1440.wanderT = 2;
  S1440.follow = false;
  S1440.executed = false;
  return S1440.ent;
}

/* 反叛之狐的处决程序：6 秒引导，把 1440 从这场"净化"里摘出去。
   子弹对它没有意义 —— 这是唯一能让它停下的方式。 */
function execute1440() {
  if (!S1440.active || S1440.executed || !S1440.ent) return;
  S1440.executed = true;
  const g = S1440.ent.group;
  AudioSys.scpRoar('1440', 0);
  AudioSys.killConfirm();
  flashScreen(0.6, '#e8c06a');
  addTrauma(0.5);
  broadcast('◤ SCP-1440 已被处决 · 净化程序中断');
  subtitle('处决完成', '它终于不用再走下去了', 5200);
  toast('SCP-1440 已被处决', 4200, 'good');
  killfeed('SCP-1440 已被反叛之狐处决', 'good');
  S1440.active = false;
  setTimeout(() => { if (g.parent) g.parent.remove(g); }, 2600);
}

/* 5K 里各身份的胜利条件
   · 反叛之狐：处决 1440 + 清除全部 Nu-22
   · 蛇之手（由异常重生而来）：清空设施里的基金会人员 —— 5K 没有撤离点 */
function checkRebelWin() {
  if (GAME.over || GAME.mission !== 'fivek') return;
  if (typeof roleView !== 'function') return;
  const id = roleView().id;
  if (id === 'hand') {
    if (typeof foundationLeft === 'function' && foundationLeft() <= 0) {
      endGame(true, '设施内的基金会人员已清除');
    }
    return;
  }
  if (id !== 'rebel') return;
  const ex = S1440.executed;
  const nu = (typeof nu22Alive === 'function') ? nu22Alive() : 0;
  if (ex && nu <= 0) endGame(true, '净化程序已中断');
}

/* 靠近长按 F：让它跟着你走 / 让它停下。
   没有这个的话 1440 只会自己乱逛，玩家根本没法把它"留"在某个位置。 */
function set1440Follow(on) {
  if (!S1440.active || !S1440.ent) return;
  S1440.follow = !!on;
  if (on) {
    AudioSys.pickup();
    broadcast('◤ SCP-1440 开始跟着你走');
    toast('它会跟着你 —— 再按一次 [F] 让它停下', 3600, 'good');
  } else {
    AudioSys.uiBack();
    broadcast('◤ SCP-1440 停下了');
    toast('SCP-1440 不再跟随', 2400);
  }
}
function stop1440() {
  if (S1440.ent && S1440.ent.group.parent) S1440.ent.group.parent.remove(S1440.ent.group);
  S1440.active = false; S1440.ent = null; S1440.holdT = 0; S1440.follow = false;
}

/* ---------------------------------------------------------------------
   主更新
   --------------------------------------------------------------------- */
function update1440(dt) {
  if (!S1440.active || !S1440.ent) return;
  const e = S1440.ent;
  const pd = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);

  // ---- 游荡：漫无目的地走，但会本能地躲开玩家（它不想害人）----
  e.wanderT -= dt;
  const wd = Math.hypot(e.wx - e.pos.x, e.wz - e.pos.z);
  if (e.wanderT <= 0 || wd < 1.5) {
    e.wanderT = rand(5, 11);
    const rm = FAC.rooms[(Math.random() * FAC.rooms.length) | 0];
    if (rm) { e.wx = rm.cx + rand(-rm.w * 0.22, rm.w * 0.22); e.wz = rm.cz + rand(-rm.d * 0.22, rm.d * 0.22); }
  }
  let tx = e.wx, tz = e.wz, speed = 1.15;
  if (S1440.follow) {
    // 跟随模式：走到玩家身后 2.4 米左右站住（优先于"躲开玩家"）
    const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
    const dd = Math.max(0.001, Math.hypot(dx, dz));
    if (dd > 3.0) { tx = player.pos.x - dx / dd * 2.4; tz = player.pos.z - dz / dd * 2.4; speed = 2.3; }
    else { tx = e.pos.x; tz = e.pos.z; speed = 0; }
  } else if (pd < 4.5) {                // 没跟随时，玩家贴太近它会往反方向挪开
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    const dd = Math.max(0.001, Math.hypot(dx, dz));
    tx = e.pos.x + dx / dd * 4; tz = e.pos.z + dz / dd * 4; speed = 1.5;
  }
  const mdx = tx - e.pos.x, mdz = tz - e.pos.z;
  const md = Math.hypot(mdx, mdz);
  if (md > 0.8) {
    e.pos.x += mdx / md * speed * dt;
    e.pos.z += mdz / md * speed * dt;
    collideMove(e.pos, e.radius, e.height, 0.5);
    e.pos.y = floorAt(e.pos.x, e.pos.z, e.pos.y + 0.3);
    e.yaw = angLerp(e.yaw, Math.atan2(-mdx / md, -mdz / md), clamp(dt * 4, 0, 1));
    e.walkT += speed * dt;
    e.moving = true;
  } else e.moving = false;
  e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
  e.group.rotation.y = e.yaw;
  const sw = e.moving ? Math.sin(e.walkT * 2.2) * 0.42 : 0;
  e.rig.legL.rotation.x = sw; e.rig.legR.rotation.x = -sw;
  e.rig.armL.rotation.set(-sw * 0.4, 0, 0.12);
  e.rig.armR.rotation.set(sw * 0.4, 0, -0.12);

  // ---- 异常侵蚀：14 米内的人类持续掉血（Nu-22 免疫）----
  const R2 = S1440_CURSE_R * S1440_CURSE_R;
  const curse = (h) => {
    if (!h || !h.alive) return;
    const dx = h.pos.x - e.pos.x, dz = h.pos.z - e.pos.z;
    if (dx * dx + dz * dz > R2) return;
    const wasAlive = h.alive;
    h.damage(S1440_CURSE_DPS * dt, null, { limb: 'torso', cause: 'SCP-1440 的异常影响' });
    if (wasAlive && !h.alive) S1440.curseKills++;
  };
  if (typeof PERSONNEL_LIST !== 'undefined') for (const p of PERSONNEL_LIST) if (!p.escaped) curse(p);
  if (typeof FACTION_LIST !== 'undefined') for (const f of FACTION_LIST) curse(f);
  if (typeof ALLY_LIST !== 'undefined') {
    // Nu-22 队员也免疫 —— 这是他们能执行运输任务的原因
  }

  // ---- 滞留计时 ----
  // ⚠️ 不只玩家算 —— **Nu-22 队员也算**。
  //    玩家抽到反叛之狐时，驱动净化的是 AI 的 Nu-22 小队；
  //    只认玩家的话，那个身份下净化永远推不动（目标直接死锁）。
  let holding = pd < S1440_HOLD_R;
  if (!holding && typeof ALLY_LIST !== 'undefined') {
    for (const a of ALLY_LIST) {
      if (!a.alive) continue;
      if (Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) < S1440_HOLD_R) { holding = true; break; }
    }
  }
  S1440.holding = holding;
  if (holding) S1440.holdT = Math.min(S1440.holdNeed, S1440.holdT + dt);
  else S1440.holdT = Math.max(0, S1440.holdT - dt * 0.5);

  const min = Math.floor(S1440.holdT / 60);
  if (min !== S1440.lastMile) {
    S1440.lastMile = min;
    if (min === 1) broadcast('◤ SCP-1440 正在侵蚀站点 · 已滞留 1 分钟');
    else if (min === 2) broadcast('◤ SCP-1440 的异常影响扩散 · 已滞留 2 分钟');
    else if (min === 3) broadcast('◤ 站点结构开始崩塌 · 已滞留 3 分钟');
    else if (min === 4) broadcast('◤ 还有最后 1 分钟 · 别让它离开站点');
  }
  if (S1440.holdT >= S1440.holdNeed && !GAME.over) {
    endGame(true, '净化完成');
  }
}

bootMark('scp1440');
