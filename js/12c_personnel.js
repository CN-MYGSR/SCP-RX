'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  12c 设施存活人员
   收容失效时滞留在设施里的三类人：

   · D 级人员（Class-D）   —— 归属混沌分裂者，**没有武器**，只想逃出去。
       放他们跑到入口大堂 = 把设施情报带出去 → **混沌分裂者提前突入**。
       想拦住就只能开枪。
   · 研究员（Scientist）   —— 玩家阵营。护送到入口大堂撤离 →
       **对异常伤害 ×2（可叠加）**，并且本人**转职为队友**留在门口。
   · 设施保安（Guard）     —— 玩家阵营。护送到入口大堂撤离 →
       **对异常 + 对敌对伤害都 ×2（可叠加）**。

   另外 SCP-3114 会伪装成这些人（以及 CI / 蛇之手 / Nu-7），见 buildDisguiseModel()。
   ===================================================================== */

const PERSONNEL_LIST = [];

const PERSONNEL_DEFS = {
  classd: { id: 'classd', name: 'D 级人员', side: 'ci', hp: 60, speed: 3.2, cloth: 0xd4761f, skin: 0xb08a70, escape: true },
  scientist: { id: 'scientist', name: '研究员', side: 'mtf', hp: 65, speed: 3.0, cloth: 0xe2e4e0, skin: 0xc8a888, escape: false },
  guard: { id: 'guard', name: '设施保安', side: 'mtf', hp: 110, speed: 3.6, cloth: 0x35404e, skin: 0xc8a888, escape: false },
};

const PERSONNEL_SPAWNS = [
  { kind: 'classd', room: 'EZ-OFFICE' },
  { kind: 'classd', room: 'EZ-COFFEE' },
  { kind: 'classd', room: 'EZ-GLASS' },
  { kind: 'classd', room: 'LCZ-AMMO' },
  { kind: 'scientist', room: 'LCZ-LAB' },
  { kind: 'scientist', room: 'EZ-OFFICE' },
  { kind: 'guard', room: 'EZ-SEC' },
  { kind: 'guard', room: 'HCZ-ARMORY' },
];

const ESCAPE_R = 6.5;   // 入口大堂的"撤离判定"半径
/* 保安 / 研究员等了这么久还没人来护送，就自己往出口走 ——
   否则玩家不来（或者来不了）时，他们会永远卡在设施里出不去。 */
const SELF_EVAC_AT = 240;

function escapeZonePos() {
  const rm = FAC.roomAt['EZ-LOBBY'];
  return rm ? { x: rm.cx, z: rm.cz } : { x: FAC.extract.x, z: FAC.extract.z };
}

/* ---------------------------------------------------------------------
   模型
   --------------------------------------------------------------------- */
function buildPersonnelModel(kind) {
  const d = PERSONNEL_DEFS[kind];
  const rig = humanoidRig({
    skin: d.skin, cloth: d.cloth,
    armW: 0.14, legW: 0.18, torsoW: 0.5, torsoH: 0.72, headR: 0.17,
  });
  const clothMat = new THREE.MeshStandardMaterial({ color: d.cloth, roughness: 0.94 });
  rig.armLM.material = clothMat; rig.armRM.material = clothMat;
  const skinMat = new THREE.MeshStandardMaterial({ color: d.skin, roughness: 0.85 });
  for (const arm of [rig.armL, rig.armR]) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.13), skinMat);
    hand.position.set(0, -0.60, 0);
    arm.add(hand);
  }
  if (kind === 'classd') {
    // 橙色囚服 + 胸前编号牌
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1),
      new THREE.MeshBasicMaterial({ map: TEX.signPlate('D', 'CLASS-D', true), side: THREE.DoubleSide }));
    tag.position.set(0, 0.48, -0.18); tag.rotation.y = PI;
    rig.hips.add(tag);
  } else if (kind === 'scientist') {
    // 白大褂 + 挂脖证件
    const coat = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.32), new THREE.MeshStandardMaterial({ color: 0xf2f4f0, roughness: 0.92 }));
    coat.position.set(0, 0.26, 0); rig.hips.add(coat);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0x2a4a8a, roughness: 0.7 }));
    badge.position.set(0.16, 0.46, -0.17); rig.hips.add(badge);
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.3, metalness: 0.4 }));
    glasses.position.set(0, 0.12, -0.16); rig.neck.add(glasses);
  } else {
    // 保安：防弹背心 + 头盔 + 肩灯
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.36), new THREE.MeshStandardMaterial({ color: 0x1c242c, roughness: 0.85 }));
    vest.position.set(0, 0.42, 0); rig.hips.add(vest);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8, 0, TAU, 0, PI * 0.6), new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.7 }));
    helm.position.set(0, 0.16, 0); rig.neck.add(helm);
    for (const sx of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a5a8a, roughness: 0.8 }));
      pad.position.set(sx * 0.28, 0.66, 0); rig.hips.add(pad);
    }
  }
  return rig;
}

/* 3114 的伪装模型分发：人员 / CI / 蛇之手 / Nu-7 都能伪装 */
const DISGUISE_KINDS = ['classd', 'scientist', 'guard', 'ci', 'hand', 'mtf'];
function buildDisguiseModel(kind) {
  if (kind === 'ci' || kind === 'hand') return buildFactionModel(kind);
  if (kind === 'mtf') return buildAllyModel(0);
  return buildPersonnelModel(kind);
}
function disguiseLabel(kind) {
  if (kind === 'ci') return '混沌分裂者';
  if (kind === 'hand') return '蛇之手';
  if (kind === 'mtf') return 'MTF Nu-7';
  return PERSONNEL_DEFS[kind].name;
}

/* ---------------------------------------------------------------------
   生成
   --------------------------------------------------------------------- */
function spawnPersonnel() {
  if (GAME.mission === 'contain096') return;
  for (const sp of PERSONNEL_SPAWNS) {
    const rm = FAC.roomAt[sp.room];
    if (!rm) continue;
    const d = PERSONNEL_DEFS[sp.kind];
    let x = rm.cx + rand(-rm.w * 0.25, rm.w * 0.25);
    let z = rm.cz + rand(-rm.d * 0.25, rm.d * 0.25);
    if (!openAtWorld(x, z, 0)) { x = rm.cx; z = rm.cz; }
    const rig = buildPersonnelModel(sp.kind);
    rig.group.position.set(x, 0, z);
    scene.add(rig.group);
    PERSONNEL_LIST.push({
      kind: sp.kind, def: d, name: d.name, rig, group: rig.group,
      pos: V3(x, 0, z), yaw: rand(0, TAU), homeX: x, homeZ: z,
      hp: d.hp, maxHp: d.hp, alive: true, escaped: false,
      radius: 0.34, height: 1.75,
      state: 'idle', moving: false, walkT: 0, hitFlash: 0, atkCd: 0,
      pathT: 0, path: makePathBuf(), pathIdx: 0,
      threat: null, threatD: 99, threatT: 0,
      wanderT: rand(0.5, 3), wanderX: x, wanderZ: z,
      damage(amt, attacker, o) {
        if (!this.alive || this.escaped) return;
        this.hp -= amt;
        this.hitFlash = 0.16;
        if (this.hp <= 0) {
          this.alive = false;
          this.group.rotation.x = HPI * 0.88;
          this.group.position.y = 0.35;
          if (this.kind === 'classd') {
            killfeed('D 级人员已被击毙', 'good');
            toast('D 级人员已被拦下 · 设施情报没有外泄', 2600, 'good');
          } else {
            killfeed(this.name + ' 阵亡', 'bad');
            toast('⚠ ' + this.name + ' 阵亡 —— 护送失败', 2600, 'bad');
            addTrauma(0.2);
          }
        }
      },
      die() { },
    });
  }
}

/* ---------------------------------------------------------------------
   撤离结算
   --------------------------------------------------------------------- */
/* byEscort：true = 玩家护送过来的（给伤害加成）；false = 自己走进来的（不给加成）。
   两条路都能离开设施 —— 区别只在"护送有没有回报"，这样护送仍然值得做。 */
function personnelEscape(p, byEscort) {
  if (p.escaped) return;
  p.escaped = true;
  p.state = 'escaped';
  if (p.group.parent) p.group.parent.remove(p.group);
  if (p.kind === 'classd') {
    GAME.classdEscaped++;
    const reduce = 70;
    const before = FACTION_SCHEDULE.ciAt;
    FACTION_SCHEDULE.ciAt = Math.max(45, FACTION_SCHEDULE.ciAt - reduce);
    if (FACTION_SCHEDULE.handAt > FACTION_SCHEDULE.ciAt + 60) FACTION_SCHEDULE.handAt = FACTION_SCHEDULE.ciAt + 60;
    const real = before - FACTION_SCHEDULE.ciAt;
    AudioSys.beep(false);
    flashScreen(0.3, '#8a2a22');
    if (FACTION_STATE.ciSpawned) {
      broadcast('◤ D 级人员逃出设施 · 混沌分裂者已经知道你们在哪了');
      toast('⚠ D 级人员逃脱 · 混沌分裂者已突入', 4200, 'bad');
    } else {
      broadcast('◤ D 级人员逃出设施 · 混沌分裂者将提前 ' + real + ' 秒突入');
      toast('⚠ D 级人员逃脱 · 混沌分裂者部署提前 ' + real + ' 秒', 4600, 'bad');
    }
  } else if (p.kind === 'scientist') {
    if (!byEscort) {                       // 自己走掉的：不结算护送加成
      AudioSys.beep(false);
      broadcast('◤ 一名研究员自行撤离了设施');
      killfeed('研究员自行撤离', '');
      return;
    }
    GAME.rescued.scientist++;
    GAME.bonusAnomaly *= 2;
    AudioSys.killConfirm();
    flashScreen(0.25, '#4ad8a0');
    broadcast('◤ 研究员已安全撤离 · 对异常伤害 ×' + GAME.bonusAnomaly);
    subtitle('研究员已撤离', '他转为队友留在门口 · 对异常伤害 ×' + GAME.bonusAnomaly, 4400);
    toast('研究员已撤离 · 对异常伤害 ×' + GAME.bonusAnomaly, 4400, 'good');
    // 转职为队友，驻守入口
    spawnAllyAt(p.pos.x, p.pos.z, p.name + '·护送组', 'Nu-7-辅');
    killfeed('研究员转为队友', 'good');
  } else if (p.kind === 'guard') {
    if (!byEscort) {                       // 自己走掉的：不结算护送加成
      AudioSys.beep(false);
      broadcast('◤ 一名设施保安自行撤离了设施');
      killfeed('设施保安自行撤离', '');
      return;
    }
    GAME.rescued.guard++;
    GAME.bonusAnomaly *= 2;
    GAME.bonusHostile *= 2;
    AudioSys.killConfirm();
    flashScreen(0.25, '#4ad8a0');
    broadcast('◤ 设施保安已安全撤离 · 对异常与敌对伤害 ×' + GAME.bonusAnomaly);
    subtitle('保安已撤离', '对异常伤害 ×' + GAME.bonusAnomaly + ' · 对敌对伤害 ×' + GAME.bonusHostile, 4400);
    toast('保安已撤离 · 异常 ×' + GAME.bonusAnomaly + ' · 敌对 ×' + GAME.bonusHostile, 4400, 'good');
    killfeed('设施保安已撤离', 'good');
  }
}

/* ---------------------------------------------------------------------
   主更新
   --------------------------------------------------------------------- */
function updatePersonnel(dt) {
  if (GAME.mission === 'contain096' || !PERSONNEL_LIST.length) return;
  const ez = escapeZonePos();
  // 保安是否对玩家开火 —— 每帧算一次，不要放进循环里
  const guardsHostile = guardsHostileToPlayer();

  for (const p of PERSONNEL_LIST) {
    if (!p.alive) {
      if (p.group.parent) p.group.position.y = dampF(p.group.position.y, -0.6, 1.2, dt);
      continue;
    }
    if (p.escaped) continue;
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    p.atkCd = Math.max(0, (p.atkCd || 0) - dt);
    const d = p.def;

    // ---- 站点守备（保安）对敌对玩家开火 ----
    // 其余人员（科学家 / D 级）没有武器，只会跑。
    if (guardsHostile && p.kind === 'guard' && p.atkCd <= 0) {
      const dd = Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
      if (dd < 26 && hasLOS(p.pos.x, p.pos.y + 1.5, p.pos.z, player.pos.x, player.pos.y + 1.3, player.pos.z)) {
        p.atkCd = rand(0.36, 0.72);
        player.damage(rand(8, 14), p, { limb: Math.random() < 0.4 ? 'torso' : 'limb' });
        spawnTracer(V3(p.pos.x, p.pos.y + 1.45, p.pos.z),
          V3(player.pos.x + rand(-0.3, 0.3), player.pos.y + 1.3, player.pos.z + rand(-0.3, 0.3)));
        AudioSys.gunshot('pistol', Math.hypot(p.pos.x - camera.position.x, p.pos.z - camera.position.z));
        p.yaw = Math.atan2(-(player.pos.x - p.pos.x), -(player.pos.z - p.pos.z));
      }
    }

    // ---- 威胁检测（0.3 秒一次，别每帧遍历）----
    p.threatT -= dt;
    if (p.threatT <= 0) {
      p.threatT = 0.3;
      let th = null, td = 10;
      for (const s of SCP_LIST) {
        if (!s.alive) continue;
        const dd = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
        if (dd < td) { td = dd; th = s; }
      }
      for (const a of FACTION_LIST) {
        if (!a.alive) continue;
        const dd = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
        if (dd < td) { td = dd; th = a; }
      }
      p.threat = th; p.threatD = td;
    }

    // ---- 招募：友方人员靠近玩家就跟着走（与站点为敌的玩家不在招募范围内）----
    if (d.side === 'mtf' && p.state === 'idle' && player.alive && !playerHostileToSite()) {
      const pd = Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
      if (pd < 3.8) {
        p.state = 'follow';
        AudioSys.pickup();
        killfeed(p.name + ' 加入护送', 'good');
        toast(p.name + ' 已加入护送 · 带他到入口大堂撤离', 3400, 'good');
      }
    }

    // ---- 决定移动目标 ----
    let tx, tz, speed = d.speed;
    const fleeing = p.threat && p.threatD < 9;
    if (fleeing) {
      const dx = p.pos.x - p.threat.pos.x, dz = p.pos.z - p.threat.pos.z;
      const dd = Math.max(0.001, Math.hypot(dx, dz));
      tx = p.pos.x + dx / dd * 6; tz = p.pos.z + dz / dd * 6;
      speed = d.speed * 1.4;
      p.state = 'flee';
    } else if (p.state === 'follow') {
      p.state = 'follow';
      const dx = player.pos.x - p.pos.x, dz = player.pos.z - p.pos.z;
      const dd = Math.max(0.001, Math.hypot(dx, dz));
      if (dd > 3.4) { tx = player.pos.x - dx / dd * 2.0; tz = player.pos.z - dz / dd * 2.0; }
      else { tx = p.pos.x; tz = p.pos.z; speed = 0; }
    } else if (d.escape) {
      // D 级：一门心思往出口跑
      p.state = 'escape';
      tx = ez.x; tz = ez.z;
    } else if (GAME.elapsed > SELF_EVAC_AT) {
      // 保安 / 研究员：等够久了还没人来护送，就自己往出口走（走得慢一些）
      p.state = 'evacuate';
      tx = ez.x; tz = ez.z;
      speed = d.speed * 0.6;
      if (!GAME.selfEvacTold) {
        GAME.selfEvacTold = true;
        broadcast('◤ 设施人员开始自行撤离 · 没人护送的会自己往大堂走');
        toast('设施人员开始自行撤离 —— 想拿护送加成得抓紧', 5000, 'warn');
      }
    } else {
      // 待机：在初始位置附近来回踱步
      p.state = 'idle';
      p.wanderT -= dt;
      const wd = Math.hypot(p.wanderX - p.pos.x, p.wanderZ - p.pos.z);
      if (p.wanderT <= 0 || wd < 0.8) {
        p.wanderT = rand(2.5, 5.5);
        const a = rand(0, TAU), r = rand(1.2, 4.5);
        p.wanderX = p.homeX + Math.cos(a) * r;
        p.wanderZ = p.homeZ + Math.sin(a) * r;
      }
      tx = p.wanderX; tz = p.wanderZ;
      speed = d.speed * 0.45;
    }

    // ---- 到达撤离点？----
    if ((p.state === 'follow' || p.state === 'evacuate' || d.escape)
      && Math.hypot(ez.x - p.pos.x, ez.z - p.pos.z) < ESCAPE_R) {
      personnelEscape(p, p.state === 'follow');   // 只有"跟着玩家来的"才结算护送加成
      continue;
    }

    // ---- 移动 ----
    const mdx = tx - p.pos.x, mdz = tz - p.pos.z;
    const md = Math.hypot(mdx, mdz);
    if (speed > 0 && md > 0.6) {
      p.pathT -= dt;
      if (p.pathT <= 0 || p.path.n === 0 || p.pathIdx >= p.path.n) {
        p.pathT = 0.8;
        navPath(p.pos.x, p.pos.z, tx, tz, p.path);
        p.pathIdx = 0;
      }
      let vx = mdx / md, vz = mdz / md;
      const P = p.path;
      if (P.n > 0) {
        while (p.pathIdx < P.n - 1 && Math.hypot(P.pts[p.pathIdx].x - p.pos.x, P.pts[p.pathIdx].z - p.pos.z) < 0.7) p.pathIdx++;
        const wp = P.pts[p.pathIdx];
        const wx = wp.x - p.pos.x, wz = wp.z - p.pos.z;
        const wd2 = Math.hypot(wx, wz);
        if (wd2 > 0.05) { vx = wx / wd2; vz = wz / wd2; }
      }
      p.pos.x += vx * speed * dt;
      p.pos.z += vz * speed * dt;
      collideMove(p.pos, p.radius, p.height, 0.5);
      p.pos.y = floorAt(p.pos.x, p.pos.z, p.pos.y + 0.3);
      p.yaw = angLerp(p.yaw, Math.atan2(-vx, -vz), clamp(dt * 7, 0, 1));
      p.walkT += speed * dt;
      p.moving = true;
    } else p.moving = false;

    // ---- 模型姿态：平民没有武器，双臂自然下垂 ----
    p.group.position.set(p.pos.x, p.pos.y, p.pos.z);
    p.group.rotation.y = p.yaw;
    const sw = p.moving ? Math.sin(p.walkT * 2.7) * 0.6 : 0;
    p.rig.legL.rotation.x = sw; p.rig.legR.rotation.x = -sw;
    p.rig.armR.rotation.set(sw * 0.7, 0, -0.08);
    p.rig.armL.rotation.set(-sw * 0.7, 0, 0.08);
    if (p.hitFlash > 0) {
      const k = 1 - (p.hitFlash / 0.16) * 0.08;
      p.group.scale.set(1 / k, k, 1 / k);
    } else if (p.group.scale.y !== 1) p.group.scale.set(1, 1, 1);
  }
}

/* 还活着 / 已撤离的人数（HUD 用） */
function personnelAlive(kind) {
  let n = 0;
  for (const p of PERSONNEL_LIST) if (p.alive && !p.escaped && (!kind || p.kind === kind)) n++;
  return n;
}

/* 场上还剩多少"有战斗力的基金会人员"（MTF 队友 + 设施保安）
   —— 混沌分裂者玩家的目标计数。科学家是无武装平民，不算在内。 */
function foundationLeft() {
  let n = 0;
  if (typeof ALLY_LIST !== 'undefined') for (const a of ALLY_LIST) if (a.alive) n++;
  for (const p of PERSONNEL_LIST) if (p.alive && !p.escaped && p.kind === 'guard') n++;
  return n;
}

/* ⚠️ 玩家是否与「站点 / 基金会」为敌 —— 这是**唯一**的判定来源。
   它同时决定两件必须对称的事：
     · 设施保安打不打你（guardsHostileToPlayer）
     · 你能不能把保安 / 科学家当成可攻击目标（raycastSCPs 的人员那一支）
   收敛成一处，是因为这个坑已经踩过三次了：
     ① 射线只遍历 SCP_LIST → 玩家打不到混沌分裂者
     ② 射线只放 side==='ci' → 混沌分裂者打不到科学家
     ③ 5K 里 Nu-22 全员敌对，但射线没跟着改 → 打不到科学家和保安
   ④ 新增"蛇之手"可玩身份时，只要这里漏一笔，又是同样的不对称。 */
function playerHostileToSite() {
  const r = (typeof roleView === 'function') ? roleView()
    : (typeof currentRole === 'function' ? currentRole() : null);
  if (!r) return false;
  if (r.side === 'ci' || r.side === 'hand' || r.side === 'scp') return true;
  if (GAME.mission === 'fivek' && r.id === 'mtf') return true;   // Nu-22 → 站点抵抗"净化"
  return false;
}

/* 设施保安该不该对玩家开火。
   规则必须跟"玩家能不能打他们"完全对称，所以直接复用同一个判定。 */
function guardsHostileToPlayer() {
  if (!player.alive || player.isAI || player.isSCP) return false;
  return playerHostileToSite();
}

bootMark('personnel');
