'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  12 MTF 队友（Nu-7 "落锤" 火力组）
   3 名队员跟随玩家推进，自主交战，可被击倒。
   ===================================================================== */

const ALLY_LIST = [];

const ALLY_NAMES = ['Cpl. Reyes', 'Sgt. Kovac', 'Spc. Adeyemi'];
const ALLY_CALLSIGNS = ['Nu-7-2', 'Nu-7-3', 'Nu-7-4'];

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
  const spots = [
    { dx: 2.2, dz: 1.4 }, { dx: -1.8, dz: 2.2 }, { dx: 0.6, dz: 3.4 },
  ];
  for (let i = 0; i < 3; i++) {
    const s = spots[i];
    const rig = buildAllyModel(i);
    const x = FAC.spawn.x + s.dx, z = FAC.spawn.z + s.dz;
    rig.group.position.set(x, 0, z);
    scene.add(rig.group);
    ALLY_LIST.push({
      name: ALLY_NAMES[i], callsign: ALLY_CALLSIGNS[i], rig, group: rig.group,
      pos: V3(x, 0, z), vel: V3(), yaw: rand(0, TAU),
      hp: 140, maxHp: 140, alive: true,
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
    });
  }
}

function updateAllies(dt) {
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
    if (best && bd < 28 && a.atkCd <= 0) {
      const ey = best.pos.y + best.height * (Math.random() < 0.16 ? 0.92 : 0.55);
      const ex = best.pos.x + rand(-0.35, 0.35), ez = best.pos.z + rand(-0.35, 0.35);
      if (hasLOS(a.pos.x, a.pos.y + 1.5, a.pos.z, ex, ey, ez)) {
        a.atkCd = 0.17 + Math.random() * 0.16;
        a.flashT = 0.05;
        const dmg = 12 + Math.random() * 7;
        // SCP-049-2 小怪没有 def 字段，必须走它自己的 damage()，
        // 否则 damageSCP 会读 s.def.immuneWhenMoving 直接抛异常
        if (best.isMinion) best.damage(dmg, a, {});
        else damageSCP(best, dmg, { head: false, from: a });
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
