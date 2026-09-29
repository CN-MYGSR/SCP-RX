'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  10 SCP 模型与 AI
   9 种 SCP，9 套行为状态机。全部程序化建模 + 程序化动画。
   ===================================================================== */

const SCP_LIST = [];
const NOISE_EVENTS = [];      // 最近的声音事件（SCP-939 靠它定位）

/* ---------------------------------------------------------------------
   声音事件系统
   --------------------------------------------------------------------- */
function noiseEvent(x, z, loud, kind) {
  NOISE_EVENTS.push({ x, z, t: nowT, loud, kind });
  if (NOISE_EVENTS.length > 60) NOISE_EVENTS.shift();
}
// 返回最近 N 秒内最响的一次声音
function loudestNoise(since) {
  let best = null;
  for (let i = NOISE_EVENTS.length - 1; i >= 0; i--) {
    const n = NOISE_EVENTS[i];
    if (nowT - n.t > since) break;
    if (!best || n.loud > best.loud) best = n;
  }
  return best;
}

/* ---------------------------------------------------------------------
   程序化模型
   --------------------------------------------------------------------- */
const SCP_MAT = {};
function scpMat(hex, rough, emissive) {
  const key = hex + '_' + rough + '_' + (emissive || 0);
  if (!SCP_MAT[key]) {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough == null ? 0.85 : rough, metalness: 0.05 });
    if (emissive) m.emissive = new THREE.Color(emissive);
    SCP_MAT[key] = m;
  }
  return SCP_MAT[key];
}
function limb(mat, w, h, d, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function ball(mat, r, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function cone(mat, r, h, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

// 通用人形骨架：返回 {group, parts}
// ⚠️ 腿的枢轴必须放在髋部高度（y = legLen），腿的网格从枢轴往下长。
//    旧代码把枢轴放在 y=0（地面），腿的网格又挂在 -legLen/2，
//    结果整条腿都在地板下面 —— 表现就是"角色没有腿"。
function humanoidRig(opt) {
  const o = Object.assign({
    skin: 0xcccccc, cloth: 0x333333, scale: 1,
    armLen: 0.62, armW: 0.13, legLen: 0.78, legW: 0.16,
    torsoW: 0.5, torsoH: 0.72, torsoD: 0.28, headR: 0.17, hunched: 0,
  }, opt || {});
  const g = new THREE.Group();
  const mSkin = scpMat(o.skin, 0.9);
  const mCloth = scpMat(o.cloth, 0.95);
  const hips = new THREE.Group(); hips.position.y = o.legLen; g.add(hips);
  const torso = limb(mCloth, o.torsoW, o.torsoH, o.torsoD, 0, o.torsoH / 2, 0, hips);
  if (o.hunched) torso.rotation.x = o.hunched;
  const neck = new THREE.Group(); neck.position.set(0, o.torsoH, 0); hips.add(neck);
  const head = ball(mSkin, o.headR, 0, o.headR * 0.9, 0, neck);
  const armL = new THREE.Group(); armL.position.set(-o.torsoW / 2 - 0.03, o.torsoH * 0.88, 0); hips.add(armL);
  const armR = new THREE.Group(); armR.position.set(o.torsoW / 2 + 0.03, o.torsoH * 0.88, 0); hips.add(armR);
  const armLM = limb(mSkin, o.armW, o.armLen, o.armW, 0, -o.armLen / 2, 0, armL);
  const armRM = limb(mSkin, o.armW, o.armLen, o.armW, 0, -o.armLen / 2, 0, armR);
  const legL = new THREE.Group(); legL.position.set(-o.legW * 0.55, o.legLen, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(o.legW * 0.55, o.legLen, 0); g.add(legR);
  const legLM = limb(mCloth, o.legW, o.legLen, o.legW, 0, -o.legLen / 2, 0, legL);
  const legRM = limb(mCloth, o.legW, o.legLen, o.legW, 0, -o.legLen / 2, 0, legR);
  // 靴子（让腿的末端有个着地感）
  for (const [leg, side] of [[legL, -1], [legR, 1]]) {
    const boot = limb(scpMat(0x14171c, 0.85), o.legW * 1.05, 0.16, o.legW * 1.5, 0, -o.legLen + 0.08, -0.05, leg);
  }
  g.scale.setScalar(o.scale);
  return { group: g, hips, torso, neck, head, armL, armR, armLM, armRM, legL, legR, legLM, legRM };
}

function buildSCPModel(key) {
  switch (key) {
    case '173': {
      const m = scpMat(0x9a9689, 0.98);
      const mDark = scpMat(0x6a6558, 0.98);
      const g = new THREE.Group();
      const hips = new THREE.Group(); hips.position.y = 0.86; g.add(hips);
      limb(m, 0.62, 0.92, 0.42, 0, 0.46, 0, hips);
      const neck = new THREE.Group(); neck.position.y = 0.94; hips.add(neck);
      const head = limb(m, 0.36, 0.42, 0.36, 0, 0.21, 0, neck);
      // 面部三道"喷涂"标记
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.CircleGeometry(0.055, 8), new THREE.MeshBasicMaterial({ color: 0x2a2620 }));
        f.position.set(-0.09 + i * 0.09, 0.22, -0.185); g.add(f);
      }
      // 眼睛孔
      const eyeL = new THREE.Mesh(new THREE.CircleGeometry(0.032, 8), new THREE.MeshBasicMaterial({ color: 0x100e0c }));
      eyeL.position.set(-0.075, 0.26, -0.186); g.add(eyeL);
      const eyeR = eyeL.clone(); eyeR.position.x = 0.075; g.add(eyeR);
      const armL = new THREE.Group(); armL.position.set(-0.34, 0.82, 0); hips.add(armL);
      const armR = new THREE.Group(); armR.position.set(0.34, 0.82, 0); hips.add(armR);
      limb(m, 0.17, 0.72, 0.17, 0, -0.36, 0, armL);
      limb(m, 0.17, 0.72, 0.17, 0, -0.36, 0, armR);
      const legL = new THREE.Group(); legL.position.set(-0.16, 0, 0); g.add(legL);
      const legR = new THREE.Group(); legR.position.set(0.16, 0, 0); g.add(legR);
      limb(m, 0.2, 0.86, 0.2, 0, -0.43, 0, legL);
      limb(m, 0.2, 0.86, 0.2, 0, -0.43, 0, legR);
      return { group: g, hips, neck, head, armL, armR, legL, legR, height: 2.0 };
    }
    case '096': {
      const m = scpMat(0xe8ded2, 0.95);
      const g = new THREE.Group();
      const hips = new THREE.Group(); hips.position.y = 1.30; g.add(hips);
      limb(m, 0.52, 1.10, 0.30, 0, 0.55, 0, hips);
      const neck = new THREE.Group(); neck.position.y = 1.12; hips.add(neck);
      const head = ball(m, 0.19, 0, 0.16, 0, neck);
      // 面部皮肤覆盖（没有五官）
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 8), scpMat(0xdcd0c0, 0.95));
      face.position.set(0, 0.16, -0.02); neck.add(face);
      // Project SCRAMBLE 的面部打码贴片（公告板，默认隐藏）
      const scram = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.scrambleFace, transparent: true, depthTest: true, depthWrite: false,
      }));
      scram.scale.set(0.95, 0.95, 1);
      scram.position.set(0, 0.15, -0.05);
      scram.visible = false;
      scram.renderOrder = 5;
      neck.add(scram);
      // 收容头套（默认隐藏；戴上后 SCP-096 永久失去视觉）
      const hoodMat = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.96 });
      const strapMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.8 });
      const hood = new THREE.Group();
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 9), hoodMat);
      bag.position.set(0, 0.17, 0); bag.scale.set(1.0, 1.18, 1.12); hood.add(bag);
      const neckWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.26, 0.22, 12), hoodMat);
      neckWrap.position.set(0, -0.02, 0); hood.add(neckWrap);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.028, 6, 14), strapMat);
      strap.position.set(0, -0.05, 0); strap.rotation.x = HPI; hood.add(strap);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.09), new THREE.MeshBasicMaterial({ map: TEX.signPlate('096', 'SITE-19', true), side: THREE.DoubleSide }));
      tag.position.set(0, 0.20, -0.30); hood.add(tag);
      hood.visible = false;
      neck.add(hood);
      const armL = new THREE.Group(); armL.position.set(-0.30, 1.00, 0); hips.add(armL);
      const armR = new THREE.Group(); armR.position.set(0.30, 1.00, 0); hips.add(armR);
      limb(m, 0.12, 1.25, 0.12, 0, -0.62, 0, armL);      // 极长的手臂
      limb(m, 0.12, 1.25, 0.12, 0, -0.62, 0, armR);
      const legL = new THREE.Group(); legL.position.set(-0.16, 0, 0); g.add(legL);
      const legR = new THREE.Group(); legR.position.set(0.16, 0, 0); g.add(legR);
      limb(m, 0.19, 1.30, 0.19, 0, -0.65, 0, legL);
      limb(m, 0.19, 1.30, 0.19, 0, -0.65, 0, legR);
      return { group: g, hips, neck, head, armL, armR, legL, legR, height: 2.6, scrambleQuad: scram, hood };
    }
    case '049': {
      const mCloth = scpMat(0x1b1b20, 0.95);
      const mMask = scpMat(0xcfc39a, 0.7);
      const g = new THREE.Group();
      // 长袍（锥体）
      const robe = cone(mCloth, 0.46, 1.55, 0, 0.78, 0, g);
      const hips = new THREE.Group(); hips.position.y = 0.70; g.add(hips);
      limb(mCloth, 0.46, 0.80, 0.28, 0, 0.40, 0, hips);
      const neck = new THREE.Group(); neck.position.y = 0.86; hips.add(neck);
      const head = ball(scpMat(0x2a2620, 0.8), 0.15, 0, 0.15, 0, neck);
      // 鸟嘴面具
      const beak = cone(mMask, 0.13, 0.34, 0, 0.12, -0.14, neck);
      beak.rotation.x = -HPI * 0.92;
      // 礼帽
      const hatB = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.03, 12), mCloth);
      hatB.position.set(0, 0.30, 0); neck.add(hatB);
      const hatT = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.20, 0.26, 12), mCloth);
      hatT.position.set(0, 0.44, 0); neck.add(hatT);
      // 眼窝的红光
      for (const sx of [-0.07, 0.07]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4030 }));
        e.position.set(sx, 0.19, -0.11); neck.add(e);
      }
      const armL = new THREE.Group(); armL.position.set(-0.28, 0.74, 0); hips.add(armL);
      const armR = new THREE.Group(); armR.position.set(0.28, 0.74, 0); hips.add(armR);
      limb(mCloth, 0.13, 0.66, 0.13, 0, -0.33, 0, armL);
      limb(mCloth, 0.13, 0.66, 0.13, 0, -0.33, 0, armR);
      return { group: g, hips, neck, head, armL, armR, legL: null, legR: null, height: 2.05 };
    }
    case '076': {
      const r = humanoidRig({ skin: 0x8a7358, cloth: 0x3a2f22, armW: 0.17, legW: 0.2, torsoW: 0.6, torsoH: 0.8, headR: 0.18 });
      // 红色纹身条
      for (let i = 0; i < 3; i++) {
        const s = limb(scpMat(0x8a2020, 0.7, 0x2a0808), 0.62, 0.05, 0.32, 0, 0.25 + i * 0.2, 0, r.hips);
      }
      // 手中的刀刃
      const blade = limb(scpMat(0xb8c0c8, 0.35), 0.16, 0.6, 0.05, 0, 0.3, 0, r.armR);
      blade.rotation.x = -0.2;
      const blade2 = limb(scpMat(0xb8c0c8, 0.35), 0.14, 0.5, 0.045, 0, 0.26, 0, r.armL);
      blade2.rotation.x = -0.2;
      return Object.assign(r, { height: 2.15 });
    }
    case '106': {
      const m = scpMat(0x2b2419, 0.98);
      const r = humanoidRig({ skin: 0x2b2419, cloth: 0x1a160f, armLen: 0.68, armW: 0.11, legLen: 0.72, legW: 0.15, torsoW: 0.46, torsoH: 0.66, headR: 0.16, hunched: 0.22 });
      // 滴落的腐蚀黏液
      for (let i = 0; i < 10; i++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(rand(0.03, 0.07), 6, 5), new THREE.MeshStandardMaterial({ color: 0x0a0806, emissive: 0x160f04, roughness: 1 }));
        d.position.set(rand(-0.35, 0.35), rand(0.1, 1.4), rand(-0.25, 0.25));
        r.group.add(d);
      }
      return Object.assign(r, { height: 1.95 });
    }
    case '682': {
      const m = scpMat(0x3d4a34, 0.92);
      const mBelly = scpMat(0x6a7050, 0.95);
      const g = new THREE.Group();
      const body = limb(m, 1.5, 1.05, 3.4, 0, 1.25, 0, g);
      limb(mBelly, 1.35, 0.4, 3.2, 0, 0.78, 0, g);
      // 头
      const neck = new THREE.Group(); neck.position.set(0, 1.5, -1.6); g.add(neck);
      const head = limb(m, 0.85, 0.7, 1.25, 0, 0.1, -0.5, neck);
      const jaw = limb(mBelly, 0.75, 0.28, 1.05, 0, -0.28, -0.52, neck);
      // 牙
      for (let i = 0; i < 6; i++) {
        cone(scpMat(0xd8d0b8, 0.5), 0.055, 0.16, -0.3 + i * 0.12, -0.14, -1.0, neck);
      }
      // 眼睛
      for (const sx of [-0.22, 0.22]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
        e.position.set(sx, 0.28, -0.92); neck.add(e);
      }
      // 背刺
      for (let i = 0; i < 7; i++) {
        const s = cone(m, 0.11, 0.45, 0, 1.85, -1.3 + i * 0.42, g);
        s.rotation.x = -0.3;
      }
      // 尾巴
      const tail = new THREE.Group(); tail.position.set(0, 1.2, 1.7); g.add(tail);
      limb(m, 0.5, 0.45, 1.2, 0, 0, 0.5, tail);
      limb(m, 0.32, 0.3, 1.0, 0, -0.05, 1.4, tail);
      limb(m, 0.18, 0.18, 0.8, 0, -0.08, 2.1, tail);
      // 四条腿
      const legs = [];
      for (const [lx, lz] of [[-0.62, -0.95], [0.62, -0.95], [-0.62, 1.0], [0.62, 1.0]]) {
        const L = new THREE.Group(); L.position.set(lx, 0.95, lz); g.add(L);
        limb(m, 0.3, 0.95, 0.34, 0, -0.47, 0, L);
        legs.push(L);
      }
      return { group: g, hips: null, neck, head, legL: legs[0], legR: legs[1], legs, height: 3.1, big: true };
    }
    case '939': {
      const m = scpMat(0x7a2b2b, 0.75);
      const mDark = scpMat(0x4a1a1a, 0.85);
      const g = new THREE.Group();
      const body = limb(m, 0.85, 0.85, 1.9, 0, 1.30, 0, g);
      // 背刺
      for (let i = 0; i < 8; i++) {
        const s = cone(mDark, 0.06, 0.30, 0, 1.72, -0.8 + i * 0.23, g);
        s.rotation.x = -0.35;
      }
      // 无眼的头
      const neck = new THREE.Group(); neck.position.set(0, 1.55, -1.0); g.add(neck);
      const head = limb(m, 0.45, 0.4, 0.85, 0, 0, -0.35, neck);
      const snout = limb(m, 0.32, 0.28, 0.45, 0, -0.06, -0.85, neck);
      // 发光的红色尖牙
      for (let i = 0; i < 8; i++) {
        cone(new THREE.MeshBasicMaterial({ color: 0xff2020 }), 0.028, 0.12, -0.12 + i * 0.035, -0.16, -1.02, neck);
      }
      for (const sx of [-0.10, 0.10]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
        e.position.set(sx, -0.10, -0.95); neck.add(e);
      }
      // 长臂（带三指爪）
      const arms = [];
      for (const sx of [-0.48, 0.48]) {
        const A = new THREE.Group(); A.position.set(sx, 1.45, -0.55); g.add(A);
        limb(m, 0.16, 1.0, 0.16, 0, -0.5, 0, A);
        for (let i = -1; i <= 1; i++) {
          const c = limb(mDark, 0.05, 0.34, 0.05, i * 0.09, -1.15, -0.05, A);
          c.rotation.x = -0.4;
        }
        arms.push(A);
      }
      const legs = [];
      for (const sx of [-0.34, 0.34]) {
        const L = new THREE.Group(); L.position.set(sx, 1.0, 0.35); g.add(L);
        limb(m, 0.26, 1.0, 0.28, 0, -0.5, 0, L);
        legs.push(L);
      }
      return { group: g, hips: null, neck, head, armL: arms[0], armR: arms[1], legL: legs[0], legR: legs[1], legs, height: 2.2 };
    }
    case '966': {
      const m = scpMat(0x6b6f73, 0.9);
      const r = humanoidRig({ skin: 0x6b6f73, cloth: 0x6b6f73, armLen: 0.68, armW: 0.09, legLen: 0.72, legW: 0.12, torsoW: 0.38, torsoH: 0.6, headR: 0.14, hunched: 0.12 });
      // 针状牙
      for (let i = 0; i < 8; i++) {
        cone(scpMat(0xd8d8d0, 0.4), 0.014, 0.09, -0.07 + i * 0.02, -0.05, -0.15, r.neck);
      }
      // 长爪
      for (const arm of [r.armL, r.armR]) {
        for (let i = -1; i <= 1; i++) {
          const c = limb(scpMat(0x8a8f93, 0.5), 0.028, 0.28, 0.028, i * 0.05, -0.82, -0.03, arm);
          c.rotation.x = -0.3;
        }
      }
      // 默认隐藏（只在夜视下显形）
      r.group.visible = true;
      return Object.assign(r, { height: 1.6 });
    }
    case '3114': {
      const bone = scpMat(0xded6c2, 0.85);
      const g = new THREE.Group();
      const hips = new THREE.Group(); hips.position.y = 0.82; g.add(hips);
      // 胸腔（肋骨）
      limb(bone, 0.06, 0.5, 0.06, 0, 0.5, 0, hips);
      for (let i = 0; i < 5; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.16 - i * 0.008, 0.022, 5, 10, PI), bone);
        rib.position.set(0, 0.72 - i * 0.075, 0);
        rib.rotation.y = HPI; rib.rotation.z = PI;
        hips.add(rib);
      }
      limb(bone, 0.28, 0.12, 0.16, 0, 0.34, 0, hips);
      // 头骨
      const neck = new THREE.Group(); neck.position.y = 0.95; hips.add(neck);
      const skull = ball(bone, 0.15, 0, 0.10, 0, neck);
      limb(bone, 0.18, 0.12, 0.2, 0, 0.02, -0.03, neck);
      // 眼窝
      for (const sx of [-0.055, 0.055]) {
        const e = new THREE.Mesh(new THREE.CircleGeometry(0.032, 8), new THREE.MeshBasicMaterial({ color: 0x0a0a08 }));
        e.position.set(sx, 0.12, -0.145); neck.add(e);
      }
      // 颌
      limb(bone, 0.14, 0.05, 0.16, 0, 0.0, -0.06, neck);
      // 四肢（细骨）
      const mkLimb = (x, y, len, parent) => {
        const G = new THREE.Group(); G.position.set(x, y, 0); parent.add(G);
        limb(bone, 0.055, len, 0.055, 0, -len / 2, 0, G);
        limb(bone, 0.045, len * 0.9, 0.045, 0, -len * 1.35, 0, G);
        return G;
      };
      const armL = mkLimb(-0.2, 0.9, 0.36, hips);
      const armR = mkLimb(0.2, 0.9, 0.36, hips);
      const legL = mkLimb(-0.1, 0.0, 0.42, g);
      const legR = mkLimb(0.1, 0.0, 0.42, g);
      // 骨盆
      limb(bone, 0.26, 0.14, 0.18, 0, 0.0, 0, hips);
      return { group: g, hips, neck, head: skull, armL, armR, legL, legR, height: 1.6 };
    }
  }
  // 兜底
  const r = humanoidRig({});
  return Object.assign(r, { height: 2.0 });
}

/* ---------------------------------------------------------------------
   SCP 实体
   --------------------------------------------------------------------- */
function spawnSCP(key, x, z, opts) {
  const def = SCP_DEFS[key];
  if (!def) return null;
  const model = buildSCPModel(key);
  const g = model.group;
  g.position.set(x, 0, z);
  scene.add(g);

  // 命中体：躯干圆柱 + 头部球
  const s = {
    key, def, name: def.name,
    pos: V3(x, 0, z), vel: V3(), yaw: rand(0, TAU),
    hp: def.hp, maxHp: def.hp, alive: true,
    radius: def.radius, height: def.height,
    state: 'idle', target: null,
    atkCd: 0, stateT: 0, pathT: 0, path: makePathBuf(), pathIdx: 0,
    model, group: g,
    walkT: Math.random() * 10, lastPos: V3(x, 0, z),
    // 个体状态
    observed: false, rageT: 0, enraged: false, revived: false, revives: 0,
    stunT: 0, grabT: 0, grabbing: null, phaseT: rand(2, 7), roarT: rand(3, 9), acidT: rand(3, 8),
    reviveT: rand(2, 5), mimicT: 0, disguised: (key === '3114'),
    deadT: 0, hitFlash: 0, headWorldY: def.height * 0.9,
    // Project SCRAMBLE：正在被面部干扰（每帧由 rage() 重算）
    scrambleHold: false, scramTold: false,
    // 收容行动：是否已戴上收容头套（戴上后永久失能）
    hooded: false,
    // 手臂姿态覆盖（攻击/挥砍用，优先于走路摆臂）
    armOverride: 0, armLx: 0, armRx: 0,
    // 攻击/受击
    noise: 0,
    lastSeen: V3(x, 0, z), lastSeenT: -99,
    active: false,
    awake: false,
    // 苏醒时间：入口区立刻、轻收容区 25s 起、重收容区 55s 起（各自带随机抖动）
    wakeTime: (def.spawnZone === 'EZ' ? 0 : def.spawnZone === 'LCZ' ? 24 : 52) + Math.random() * 18,
    spawnX: x, spawnZ: z,
  };
  if (key === '3114') {
    // 伪装：先躺在地上
    g.rotation.z = HPI * 0.94;
    g.position.y = 0.2;
  }
  SCP_LIST.push(s);
  return s;
}

function spawnAllSCPs() {
  for (const key of SCP_ORDER) {
    const roomId = Object.keys(CONTAINMENT_ROOMS).find(k => CONTAINMENT_ROOMS[k] === key);
    const room = FAC.roomAt[roomId];
    if (!room) continue;
    spawnSCP(key, room.cx + rand(-1.5, 1.5), room.cz + rand(-1.5, 1.5));
  }
}

/* ---------------------------------------------------------------------
   命中检测
   --------------------------------------------------------------------- */
function rayCylEntity(o, dir, ex, ez, r, y0, y1, maxD) {
  const ox = o.x - ex, oz = o.z - ez;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-9) return null;
  const b2 = 2 * (ox * dir.x + oz * dir.z);
  const cc = ox * ox + oz * oz - r * r;
  const disc = b2 * b2 - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b2 - Math.sqrt(disc)) / (2 * a);
  if (t < 0.0001 || t > maxD) return null;
  const y = o.y + dir.y * t;
  if (y < y0 || y > y1) return null;
  return t;
}
function raySphere(o, dir, cx, cy, cz, r, maxD) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = 2 * (ox * dir.x + oy * dir.y + oz * dir.z);
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / 2;
  if (t < 0.0001 || t > maxD) return null;
  return t;
}
// 返回最近的 SCP 命中：{scp, dist, head}
function raycastSCPs(o, dir, maxD) {
  let best = null, bestT = maxD;
  for (const s of SCP_LIST) {
    if (!s.alive) continue;
    if (s.def.onlyVisibleWithNVG && !NVG.on) {
      const d = Math.hypot(s.pos.x - o.x, s.pos.z - o.z);
      if (d > s.def.revealRange) continue;
    }
    const r = s.radius;
    const h = s.height;
    // 躯干
    const tb = rayCylEntity(o, dir, s.pos.x, s.pos.z, r, s.pos.y + 0.1, s.pos.y + h * 0.86, bestT);
    // 头
    const hy = s.pos.y + h * 0.92;
    const hb = raySphere(o, dir, s.pos.x, hy, s.pos.z, Math.max(0.22, r * 0.75), bestT);
    if (hb != null && hb < bestT) { bestT = hb; best = { scp: s, dist: hb, head: true }; }
    if (tb != null && tb < bestT) { bestT = tb; best = { scp: s, dist: tb, head: false }; }
  }
  return best;
}

/* ---------------------------------------------------------------------
   受伤 / 死亡
   --------------------------------------------------------------------- */
function damageSCP(s, amt, opts) {
  if (!s || !s.alive) return 0;
  // 兜底：SCP-049-2 小怪没有 def 字段，转交给它自己的 damage()
  if (!s.def) {
    if (typeof s.damage === 'function') { s.damage(amt, opts && opts.from, opts); return amt; }
    return 0;
  }
  const o = opts || {};
  const def = s.def;
  // 免疫判定
  if (def.immuneWhenMoving && !s.observed) {
    if (o.byPlayer && Math.random() < 0.25) floatText(s, '无效', '#9aa0a4');
    return 0;
  }
  if (def.immuneWhenDocile && !s.enraged) {
    if (o.byPlayer && Math.random() < 0.25) floatText(s, '无效', '#9aa0a4');
    return 0;
  }
  let dmg = amt * (GAME.protocol ? 2.0 : 1.0);     // 收容协议：HID 装置上线，伤害翻倍
  if (o.head) dmg *= 1.6;
  s.hp -= dmg;
  s.hitFlash = 0.16;
  s.active = true;
  if (o.byPlayer) { player.dmgDealt += dmg; GAME.dmgDealt += dmg; }
  // 激怒：被打就锁定攻击者
  if (o.from && o.from.pos) { s.target = o.from; s.lastSeen.copy(o.from.pos); s.lastSeenT = nowT; }
  // 溅血
  if (s.hitFlash > 0 && Math.random() < 0.6) {
    const p = V3(s.pos.x + rand(-0.3, 0.3), s.pos.y + rand(0.6, s.height * 0.8), s.pos.z + rand(-0.3, 0.3));
    spawnBloodBurst(p, (s.key === '3114' || s.key === '173') ? 'bone' : 'blood', 6);
  }
  if (s.hp <= 0) { killSCP(s, o); return dmg; }
  return dmg;
}

function killSCP(s, o) {
  if (!s.alive) return;
  // SCP-076-2 复活一次
  if (s.def.reviveOnce && !s.revived) {
    s.revived = true;
    s.hp = 1;
    s.state = 'down';
    s.stateT = 0;
    s.model.group.rotation.x = HPI * 0.9;
    subtitle('SCP-076-2 倒下了……', '但它在石棺中已经死过太多次', 2600);
    AudioSys.scpRoar('076', 0);
    return;
  }
  s.alive = false;
  s.hp = 0;
  s.deadT = nowT;
  s.state = 'dead';
  s.model.group.rotation.x = HPI * 0.88;
  s.model.group.position.y = 0.35;
  // 血泊
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(rand(1.8, 3.0), rand(1.8, 3.0)),
    new THREE.MeshBasicMaterial({ map: TEX.blood, transparent: true, opacity: 0.85, depthWrite: false }));
  pool.rotation.x = -HPI; pool.rotation.z = rand(0, TAU);
  pool.position.set(s.pos.x, 0.014, s.pos.z);
  scene.add(pool);
  GAME.contained[s.key] = true;
  player.kills++;
  GAME.kills++;
  AudioSys.killConfirm();
  AudioSys.scpRoar(s.key, 0);
  onSCPKilled(s);
  broadcast('◤ ' + s.name + ' 已停止活动 · 收容状态确认');
  setTimeout(() => { if (s.group.parent) s.group.parent.remove(s.group); }, 2600);
}

/* ---------------------------------------------------------------------
   主更新
   --------------------------------------------------------------------- */
function updateSCPs(dt) {
  // 声音事件老化
  while (NOISE_EVENTS.length && nowT - NOISE_EVENTS[0].t > 12) NOISE_EVENTS.shift();

  for (const s of SCP_LIST) {
    if (!s.alive) {
      // 死亡后缓慢下沉
      if (s.group.parent) {
        s.group.position.y = dampF(s.group.position.y, -1.4, 1.2, dt);
        if (s.group.position.y < -1.2) s.group.parent.remove(s.group);
      }
      continue;
    }
    s.stateT += dt;
    s.atkCd = Math.max(0, s.atkCd - dt);
    if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt);

    // 076 倒地复活计时
    if (s.state === 'down') {
      s.stateT += 0;
      if (s.stateT > s.def.reviveDelay) {
        s.hp = s.maxHp * 0.5;
        s.state = 'hunt';
        s.model.group.rotation.x = 0;
        s.model.group.position.y = 0;
        subtitle('SCP-076-2 再次站了起来', '', 2200);
        AudioSys.scpRoar('076', 0);
        addTrauma(0.4);
      }
      continue;
    }

    // 选择目标
    pickTarget(s);
    // 苏醒门槛：设施深处的收容物不会一开局就扑向入口区，
    // 但玩家主动靠近（<32m）会立刻惊动它们。
    if (!s.awake) {
      if (GAME.elapsed > s.wakeTime || s.distToTarget < 32) {
        s.awake = true;
        if (BROADCASTS.scp[s.key] && Math.random() < 0.6) broadcast(BROADCASTS.scp[s.key]);
      } else {
        s.state = 'idle';
        s.group.position.set(s.pos.x, s.pos.y, s.pos.z);
        s.group.rotation.y = s.yaw;
        continue;
      }
    }
    // 通用僵直（EMP 脉冲 / 强光）：不动、不攻击、不推进状态机
    if (s.stunT > 0) {
      s.stunT -= dt;
      s.state = 'stunned';
      if (s.model.neck) s.model.neck.rotation.x = 0.42;
      if (Math.random() < dt * 0.6) AudioSys.boneClick(dist3(s, player));
      s.group.position.set(s.pos.x, s.pos.y, s.pos.z);
      s.group.rotation.y = s.yaw;
      continue;
    }
    // 各行为的更新
    const fn = SCP_AI[s.def.behavior];
    if (fn) fn(s, dt);
    // 动画
    animateSCP(s, dt);
    // 位移到模型
    s.group.position.set(s.pos.x, s.pos.y + (s.key === '3114' && s.disguised ? 0.2 : 0), s.pos.z);
    if (!(s.key === '3114' && s.disguised)) s.group.rotation.z = 0;
    s.group.rotation.y = s.yaw;
    // 受击闪白（已改为整体压扁反馈）
  }
  updateMinions(dt);
}

function pickTarget(s) {
  let t = null, bd = 1e9;
  if (player.alive) {
    const d = Math.hypot(player.pos.x - s.pos.x, player.pos.z - s.pos.z);
    t = player; bd = d;
  }
  if (typeof ALLY_LIST !== 'undefined') {
    for (const a of ALLY_LIST) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - s.pos.x, a.pos.z - s.pos.z);
      if (d < bd) { bd = d; t = a; }
    }
  }
  s.target = t;
  s.distToTarget = bd;
}

// 通用：向目标移动（A* + 直接推进兜底）
function moveToward(s, tx, tz, speed, dt, direct) {
  const dx = tx - s.pos.x, dz = tz - s.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  let mvx, mvz;
  if (direct || !NAV.ready) { mvx = dx / d; mvz = dz / d; }
  else {
    s.pathT -= dt;
    if (s.pathT <= 0 || s.path.n === 0 || s.pathIdx >= s.path.n) {
      s.pathT = 0.55 + Math.random() * 0.4;
      navPath(s.pos.x, s.pos.z, tx, tz, s.path);
      s.pathIdx = 0;
    }
    const P = s.path;
    if (P.n > 0) {
      while (s.pathIdx < P.n - 1 &&
        Math.hypot(P.pts[s.pathIdx].x - s.pos.x, P.pts[s.pathIdx].z - s.pos.z) < 0.7) s.pathIdx++;
      const wp = P.pts[s.pathIdx];
      const wx = wp.x - s.pos.x, wz = wp.z - s.pos.z;
      const wd = Math.hypot(wx, wz);
      if (wd < 0.05) { mvx = dx / d; mvz = dz / d; }
      else { mvx = wx / wd; mvz = wz / wd; }
    } else { mvx = dx / d; mvz = dz / d; }
  }
  const sp = speed;
  s.pos.x += mvx * sp * dt;
  s.pos.z += mvz * sp * dt;
  collideMove(s.pos, s.radius, s.height, 0.5);
  s.pos.y = floorAt(s.pos.x, s.pos.z, s.pos.y + 0.3);
  // 朝向（模型默认面朝 -Z，故取反向）
  const wantYaw = Math.atan2(-mvx, -mvz);
  s.yaw = angLerp(s.yaw, wantYaw, clamp(dt * 7, 0, 1));
  s.walkT += sp * dt;
  return sp;
}

function faceTarget(s, dt, rate) {
  if (!s.target) return;
  const dx = s.target.pos.x - s.pos.x, dz = s.target.pos.z - s.pos.z;
  const wantYaw = Math.atan2(-dx, -dz);
  s.yaw = angLerp(s.yaw, wantYaw, clamp(dt * (rate || 8), 0, 1));
}

// 能否看到目标
function canSee(s, t) {
  if (!t) return false;
  const ey = s.pos.y + s.height * 0.9;
  return hasLOS(s.pos.x, ey, s.pos.z, t.pos.x, t.pos.y + 1.4, t.pos.z);
}

// 攻击目标
function tryAttack(s, dt, dmgOverride) {
  if (!s.target || !s.target.alive) return false;
  const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
  if (d > s.def.touchRange) return false;
  if (s.atkCd > 0) return false;
  s.atkCd = s.def.atkCd;
  const dmg = dmgOverride == null ? s.def.touchDmg : dmgOverride;
  s.target.damage(dmg, s, { limb: 'torso' });
  AudioSys.scpRoar(s.key, 0);
  if (s.target === player) addTrauma(0.5);
  // 攻击动作（rotation.x 取正 = 手臂朝前挥出）
  s.armLx = 1.5; s.armRx = 1.5; s.armOverride = 0.4;
  return true;
}

/* ---------------------------------------------------------------------
   9 套行为
   --------------------------------------------------------------------- */
const SCP_AI = {
  // ---------- SCP-173：观察冻结 ----------
  blink(s, dt) {
    const seen = player.alive && playerLooksAt(s.pos.x, s.pos.y + s.height * 0.55, s.pos.z, 34) && !player.blinking;
    s.observed = seen;
    s.model.group.visible = true;
    if (seen) {
      s.state = 'frozen';
      // 冻结时微微抖动
      s.model.hips.rotation.z = Math.sin(nowT * 40) * 0.004;
      if (Math.random() < dt * 0.5) AudioSys.scpRoar('173', dist3(s, player));
      return;
    }
    // 未被注视 → 高速逼近
    s.model.hips.rotation.z = 0;
    if (!s.target) return;
    const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
    s.state = d < 2.4 ? 'attack' : 'hunt';
    if (d < s.def.touchRange) {
      if (s.atkCd <= 0) {
        s.atkCd = s.def.atkCd;
        s.pos.x = s.target.pos.x + rand(-0.5, 0.5);
        s.pos.z = s.target.pos.z + rand(-0.5, 0.5);
        s.yaw = Math.atan2(-(s.target.pos.x - s.pos.x), -(s.target.pos.z - s.pos.z));
        AudioSys.scpRoar('173', 0);
        addTrauma(1.0);
        s.target.damage(999, s, { limb: 'head' });
        flashScreen(0.6, '#c81f1f');
      }
      return;
    }
    // 瞬移式推进：分 2~3 段
    const step = s.def.speed * dt;
    const dirx = (s.target.pos.x - s.pos.x) / d, dirz = (s.target.pos.z - s.pos.z) / d;
    s.pos.x += dirx * step; s.pos.z += dirz * step;
    collideMove(s.pos, s.radius, s.height, 0.5);
    s.pos.y = floorAt(s.pos.x, s.pos.z, s.pos.y + 0.3);
    s.yaw = Math.atan2(-dirx, -dirz);
    s.walkT += step;
  },

  // ---------- SCP-096：被注视即暴走（Project SCRAMBLE / 收容头套 可免疫）----------
  rage(s, dt) {
    // 已戴收容头套：永久失能，不会再暴走
    if (s.hooded) {
      s.state = 'contained';
      s.scrambleHold = false;
      s.rageT = 0;
      s.model.group.visible = true;
      if (s.model.hood) s.model.hood.visible = true;
      if (s.model.scrambleQuad) s.model.scrambleQuad.visible = false;
      s.model.neck.rotation.x = 0.30;
      return;
    }
    // 每帧重置"正在被 SCRAMBLE 干扰"标记，只有持续注视才会保持为 true
    s.scrambleHold = false;
    if (!s.enraged) {
      s.state = 'docile';
      s.model.group.visible = true;
      // 低头抽泣
      s.model.neck.rotation.x = 0.55 + Math.sin(nowT * 2.2) * 0.05;
      const looked = player.alive && playerLooksAt(s.pos.x, s.pos.y + s.height * 0.92, s.pos.z, 22);
      const blocked = looked && NVG.scrambleActive();
      s.scrambleHold = blocked;
      if (blocked) {
        // 看见了，但认不出来 —— 干扰装置把面部糊成一团马赛克
        s.rageT = Math.max(0, s.rageT - dt * 2.5);
        if (!s.scramTold) {
          s.scramTold = true;
          toast('SCRAMBLE：面部干扰生效 —— SCP-096 无法识别你', 2600, 'good');
        }
      } else if (looked) {
        s.scramTold = false;
        s.rageT += dt;
        if (s.rageT > s.def.rageTriggerTime) {
          s.enraged = true;
          s.state = 'enraged';
          s.model.scrambleQuad && (s.model.scrambleQuad.visible = false);
          subtitle('SCP-096 进入暴走状态', '它已经看见你看见了它', 2600);
          AudioSys.scpRoar('096', 0);
          addTrauma(0.7);
          broadcast('◤ 警告 · SCP-096 面部被观测 · 立即规避');
        }
      } else {
        s.scramTold = false;
        s.rageT = Math.max(0, s.rageT - dt * 0.6);
      }
      // 打码贴片只在「未暴走 + 正被干扰」时显示
      if (s.model.scrambleQuad) s.model.scrambleQuad.visible = blocked;
      return;
    }
    // 暴走：无视一切障碍冲向观测者
    s.state = 'enraged';
    s.model.neck.rotation.x = -0.2;
    if (!s.target) return;
    const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
    if (Math.random() < dt * 0.6) AudioSys.scpRoar('096', d);
    if (d < s.def.touchRange) { tryAttack(s, dt); return; }
    moveToward(s, s.target.pos.x, s.target.pos.z, s.def.speed, dt, true);
    if (Math.random() < dt * 8) addTrauma(0.05);
  },

  // ---------- SCP-049：触碰即死 + 复活尸体 ----------
  touch(s, dt) {
    if (!s.target) return;
    const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
    s.state = d < 3 ? 'approach' : 'hunt';
    if (d < s.def.touchRange) {
      if (s.atkCd <= 0) {
        s.atkCd = s.def.atkCd;
        AudioSys.scpRoar('049', 0);
        s.target.damage(999, s, { limb: 'torso' });
        if (s.target === player) { flashScreen(0.55, '#0d0d0d'); subtitle('"你的病症……需要治疗。"', 'SCP-049', 2400); }
      }
      faceTarget(s, dt, 4);
      return;
    }
    moveToward(s, s.target.pos.x, s.target.pos.z, s.def.speed, dt);
    if (Math.random() < dt * 0.35) AudioSys.scpRoar('049', d);
    // 复活尸体
    s.reviveT -= dt;
    if (s.reviveT <= 0) {
      s.reviveT = s.def.reviveCd;
      if (MINIONS.length < s.def.maxMinions) {
        for (const c of CORPSES) {
          if (c.revived) continue;
          const cd = Math.hypot(c.x - s.pos.x, c.z - s.pos.z);
          if (cd < s.def.reviveRange) {
            c.revived = true;
            spawnMinion(c.x, c.z);
            AudioSys.scpRoar('049', cd);
            break;
          }
        }
      }
    }
  },

  // ---------- SCP-076-2：高速武士 ----------
  duelist(s, dt) {
    if (!s.target) return;
    const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
    if (d < s.def.touchRange) {
      s.state = 'attack';
      faceTarget(s, dt, 10);
      tryAttack(s, dt);
      // 挥砍动画（从高举往前下方劈）
      if (s.atkCd > s.def.atkCd - 0.25) {
        s.armRx = 2.1 - (s.def.atkCd - s.atkCd) * 6;
        s.armLx = 0.4;
        s.armOverride = 0.3;
      }
      return;
    }
    s.state = 'hunt';
    const sp = d > 12 ? (s.def.sprintSpeed || s.def.speed) : s.def.speed;
    moveToward(s, s.target.pos.x, s.target.pos.z, sp, dt);
    if (Math.random() < dt * 0.25) AudioSys.scpRoar('076', d);
  },

  // ---------- SCP-106：穿墙 + 腐蚀 ----------
  phase(s, dt) {
    if (!s.target) return;
    const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
    s.state = 'hunt';
    // 周期性穿墙瞬移
    s.phaseT -= dt;
    if (s.phaseT <= 0 && d > 6) {
      s.phaseT = s.def.phaseCd;
      // 尝试瞬移到目标附近的可行走点
      const ang = Math.atan2(s.pos.x - s.target.pos.x, s.pos.z - s.target.pos.z) + rand(-0.9, 0.9);
      const r = rand(5, 11);
      let tx = s.target.pos.x + Math.sin(ang) * r;
      let tz = s.target.pos.z + Math.cos(ang) * r;
      const near = navNearest(tx, tz, 8);
      if (near) { tx = near.x; tz = near.z; }
      spawnCorrosion(s.pos.x, s.pos.z);
      s.pos.x = tx; s.pos.z = tz;
      s.pos.y = floorAt(tx, tz, 2);
      spawnCorrosion(tx, tz);
      AudioSys.scpRoar('106', 0);
      addTrauma(0.25);
      if (Math.random() < 0.5) broadcast('◤ 警告 · SCP-106 腐蚀痕迹出现在附近');
    }
    if (d < s.def.touchRange) {
      if (s.atkCd <= 0) {
        s.atkCd = s.def.atkCd;
        AudioSys.scpRoar('106', 0);
        s.target.damage(999, s, { limb: 'torso' });
        if (s.target === player) {
          flashScreen(0.7, '#0a0a06');
          subtitle('你被拖入了口袋空间……', '', 2600);
        }
      }
      return;
    }
    moveToward(s, s.target.pos.x, s.target.pos.z, s.def.speed, dt);
    if (Math.random() < dt * 0.4) spawnCorrosion(s.pos.x, s.pos.z);
  },

  // ---------- SCP-682：不灭孽蜥 ----------
  tank(s, dt) {
    if (!s.target) return;
    const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
    s.state = d < 5 ? 'attack' : 'hunt';
    // 咆哮
    s.roarT -= dt;
    if (s.roarT <= 0) {
      s.roarT = s.def.roarCd;
      AudioSys.scpRoar('682', d);
      if (d < 30) { addTrauma(0.55); if (player.alive) flashScreen(0.18, '#3a1010'); }
      broadcast('◤ 结构震动 · SCP-682 正在破坏承重墙');
    }
    // 酸性吐息
    if (d > 6 && d < 26 && canSee(s, s.target)) {
      s.acidT -= dt;
      if (s.acidT <= 0) {
        s.acidT = s.def.acidCd;
        spitAcid(s);
      }
    }
    if (d < s.def.touchRange) { tryAttack(s, dt); return; }
    moveToward(s, s.target.pos.x, s.target.pos.z, s.def.speed, dt);
  },

  // ---------- SCP-939：盲眼声呐 ----------
  sonar(s, dt) {
    // 强光僵直：给 s.stunT 充电，由 updateSCPs 的通用僵直分支消费
    if (VM.spot && VM.spot.visible && player.alive) {
      const dx = s.pos.x - player.pos.x, dz = s.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 16) {
        const fwd = V3(0, 0, -1).applyQuaternion(camera.quaternion);
        const dot = (fwd.x * dx + fwd.z * dz) / Math.max(0.001, d);
        if (dot > 0.85) {
          s.stunT = Math.max(s.stunT, s.def.lightStun * dt * 4);
          if (Math.random() < dt * 3) AudioSys.scpRoar('939', d);
        }
      }
    }
    s.model.neck.rotation.x = 0;
    // 听觉定位
    const n = loudestNoise(4.5);
    if (n && Math.hypot(n.x - s.pos.x, n.z - s.pos.z) < s.def.hearingRange) {
      s.lastSeen.set(n.x, 0, n.z);
      s.lastSeenT = nowT;
      s.active = true;
    }
    const hunting = (nowT - s.lastSeenT) < 7.5;
    s.state = hunting ? 'hunt' : 'search';
    // 靠近时若目标完全静音且蹲行，有一定概率丢失
    if (s.target && s.distToTarget < 3.2 && !hunting) {
      // 贴身仍会咬
      if (s.distToTarget < s.def.touchRange) { tryAttack(s, dt); return; }
    }
    if (hunting) {
      if (s.target && s.distToTarget < s.def.touchRange && (nowT - s.lastSeenT) < 1.6) {
        tryAttack(s, dt);
        return;
      }
      moveToward(s, s.lastSeen.x, s.lastSeen.z, s.def.speed, dt);
      if (Math.random() < dt * 0.5) AudioSys.scpRoar('939', s.distToTarget);
    } else {
      // 游荡
      if (!s.wander) s.wander = { x: s.spawnX + rand(-8, 8), z: s.spawnZ + rand(-8, 8), t: rand(2, 5) };
      s.wander.t -= dt;
      if (s.wander.t <= 0) s.wander = { x: s.spawnX + rand(-14, 14), z: s.spawnZ + rand(-14, 14), t: rand(3, 7) };
      moveToward(s, s.wander.x, s.wander.z, s.def.speed * 0.42, dt);
      if (Math.random() < dt * 0.12) AudioSys.scpRoar('939', s.distToTarget);
    }
  },

  // ---------- SCP-966：红外隐形 ----------
  thermal(s, dt) {
    // 可见性：夜视开启或距离很近
    const d = s.target ? Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z) : 999;
    const visible = NVG.on || d < s.def.revealRange;
    s.group.visible = visible;
    s.ghost = !visible;
    if (!s.target) return;
    s.state = 'stalk';
    // 剥夺睡眠
    if (player.alive && d < 20 && hasLOS(s.pos.x, s.pos.y + 1.2, s.pos.z, player.pos.x, player.pos.y + 1.2, player.pos.z)) {
      player.sleep = Math.max(0, player.sleep - s.def.sleepDrain * dt);
      if (Math.random() < dt * 0.35) AudioSys.sleepDrone();
      if (Math.random() < dt * 0.1) AudioSys.hallucinate();
      if (Math.random() < dt * 0.25) addTrauma(0.06);
    }
    if (d < s.def.touchRange) { tryAttack(s, dt); return; }
    // 潜行接近
    const sp = d > 10 ? s.def.speed : s.def.speed * 0.7;
    moveToward(s, s.target.pos.x, s.target.pos.z, sp, dt);
  },

  // ---------- SCP-3114：骸骨伪装 ----------
  mimic(s, dt) {
    if (!s.target) return;
    const d = Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.z - s.pos.z);
    // 伪装阶段：躺在地上装尸体
    if (s.disguised) {
      s.state = 'disguised';
      s.group.position.y = 0.2;
      s.group.rotation.z = HPI * 0.94;
      if (d < 7.5 || s.active) {
        s.disguised = false;
        s.group.rotation.z = 0;
        AudioSys.boneClick(d);
        subtitle('地上的"尸体"站了起来', 'SCP-3114 · 骸骨', 2200);
        addTrauma(0.5);
      }
      return;
    }
    s.group.rotation.z = 0;
    s.model.group.rotation.z = 0;
    // 抓住玩家
    if (s.grabbing) {
      s.state = 'grab';
      s.grabT += dt;
      if (player.grabbedBy === s) {
        player.hp -= s.def.grabDps * dt;
        player.dmgTaken += s.def.grabDps * dt;
        GAME.dmgTaken += s.def.grabDps * dt;
        if (Math.random() < dt * 6) AudioSys.boneClick(0);
        if (Math.random() < dt * 2) addTrauma(0.1);
        // 挣扎：按空格或移动键
        if (keys.jump || keys.fwd || keys.back || keys.left || keys.right) {
          s.grabT += dt * 1.6;
        }
        if (s.grabT > 1.7) {
          s.grabbing = null;
          player.grabbedBy = null;
          s.atkCd = 1.6;
          toast('挣脱了 SCP-3114', 1600, 'good');
        }
      } else {
        s.grabbing = null;
      }
      if (player.hp <= 0) player.die(s, { limb: 'torso' });
      return;
    }
    if (d < s.def.grabRange && s.atkCd <= 0 && s.target === player && player.alive) {
      s.grabbing = s;
      player.grabbedBy = s;
      s.grabT = 0;
      AudioSys.scpRoar('3114', 0);
      subtitle('SCP-3114 抓住了你', '连续按 [空格] 或移动键挣脱', 2600);
      addTrauma(0.6);
      return;
    }
    s.state = 'hunt';
    if (d < s.def.touchRange) { tryAttack(s, dt, s.def.touchDmg); return; }
    moveToward(s, s.target.pos.x, s.target.pos.z, s.def.speed, dt, d < 12);
    if (Math.random() < dt * 5) AudioSys.boneClick(d);
  },
};

/* ---------------------------------------------------------------------
   辅助：视线判定 / 距离 / 特效挂钩
   --------------------------------------------------------------------- */
function dist3(s, t) { return t ? Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : 60; }

function playerLooksAt(x, y, z, coneDeg) {
  if (!player.alive) return false;
  const cam = camera.position;
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  const fwd = _lookFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const dot = (fwd.x * dx + fwd.y * dy + fwd.z * dz) / d;
  if (dot < Math.cos(coneDeg * PI / 180)) return false;
  // 距离近时忽略遮挡（贴脸）
  if (d < 2.2) return true;
  return hasLOS(cam.x, cam.y, cam.z, x, y, z);
}
const _lookFwd = V3();

/* ---------------------------------------------------------------------
   SCP-049-2（被复活的尸体）
   --------------------------------------------------------------------- */
const MINIONS = [];
function spawnMinion(x, z) {
  const r = humanoidRig({ skin: 0x6a7a5a, cloth: 0x3a3a30, armW: 0.14, legW: 0.17, torsoW: 0.5, torsoH: 0.68, headR: 0.16 });
  r.group.position.set(x, 0, z);
  scene.add(r.group);
  registerLight(x, 1.6, z, 0x6aff8a, 0.4, 3, {});
  const m = {
    pos: V3(x, 0, z), hp: 90, maxHp: 90, alive: true, rig: r, group: r.group,
    yaw: 0, walkT: 0, atkCd: 0, isMinion: true,
    radius: 0.36, height: 1.85, name: 'SCP-049-2',
    damage(amt, attacker, o) {
      this.hp -= amt;
      if (this.hp <= 0 && this.alive) {
        this.alive = false;
        scene.remove(this.group);
        player.kills++; GAME.kills++;
        AudioSys.killConfirm();
        floatText(this, '击杀 SCP-049-2', '#8ad8ff');
      }
    },
    die() { },
  };
  MINIONS.push(m);
  return m;
}
function updateMinions(dt) {
  for (let i = MINIONS.length - 1; i >= 0; i--) {
    const m = MINIONS[i];
    if (!m.alive) { MINIONS.splice(i, 1); continue; }
    m.atkCd = Math.max(0, m.atkCd - dt);
    let t = null, bd = 1e9;
    if (player.alive) { t = player; bd = Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z); }
    if (typeof ALLY_LIST !== 'undefined') for (const a of ALLY_LIST) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - m.pos.x, a.pos.z - m.pos.z);
      if (d < bd) { bd = d; t = a; }
    }
    if (!t) continue;
    const speed = 3.2;
    if (bd < 1.8) {
      if (m.atkCd <= 0) { m.atkCd = 1.2; t.damage(14, m, { limb: 'torso' }); }
    } else {
      const dx = (t.pos.x - m.pos.x) / bd, dz = (t.pos.z - m.pos.z) / bd;
      m.pos.x += dx * speed * dt; m.pos.z += dz * speed * dt;
      collideMove(m.pos, 0.36, 1.8, 0.5);
      m.pos.y = floorAt(m.pos.x, m.pos.z, m.pos.y + 0.3);
      m.yaw = angLerp(m.yaw, Math.atan2(-dx, -dz), clamp(dt * 6, 0, 1));
      m.walkT += speed * dt;
    }
    m.group.position.copy(m.pos);
    m.group.rotation.y = m.yaw;
    // 摇摆动画（049-2 是伸着双臂往前扑的）
    const sw = Math.sin(m.walkT * 2.4) * 0.5;
    m.rig.legL.rotation.x = sw; m.rig.legR.rotation.x = -sw;
    m.rig.armL.rotation.x = -sw * 0.6 + 1.15; m.rig.armR.rotation.x = sw * 0.6 + 1.15;
  }
}

/* ---------------------------------------------------------------------
   SCP 动画（行走摆臂）
   --------------------------------------------------------------------- */
function animateSCP(s, dt) {
  const m = s.model;
  const speed = Math.hypot(s.pos.x - s.lastPos.x, s.pos.z - s.lastPos.z) / Math.max(dt, 0.0001);
  s.lastPos.copy(s.pos);
  const moving = speed > 0.15;
  if (m.legL && m.legR && !m.legs) {
    const sw = Math.sin(s.walkT * 2.6) * clamp(speed * 0.14, 0, 0.9);
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
    if (m.armL) {
      // 攻击/挥砍姿态优先（由 AI 写入 armOverride），否则用走路摆臂
      if (s.armOverride > 0) {
        s.armOverride -= dt;
        m.armL.rotation.x = s.armLx;
        if (m.armR) m.armR.rotation.x = s.armRx;
      } else {
        m.armL.rotation.x = -sw * 0.75;
        if (m.armR) m.armR.rotation.x = sw * 0.75;
      }
    }
  } else if (m.legs) {
    const sw = Math.sin(s.walkT * 2.2) * clamp(speed * 0.1, 0, 0.55);
    m.legs.forEach((L, i) => { L.rotation.x = (i % 2 === 0 ? sw : -sw); });
    if (m.armL) m.armL.rotation.x = -sw * 0.8;
    if (m.armR) m.armR.rotation.x = sw * 0.8;
  }
  // 身体起伏（只在 hips 是独立于整组的子节点时才做）
  if (m.hips && m.hips !== s.group) {
    if (m.hips.userData.baseY == null) m.hips.userData.baseY = m.hips.position.y;
    m.hips.position.y = m.hips.userData.baseY + (moving ? Math.abs(Math.sin(s.walkT * 2.6)) * 0.045 : 0);
  }
  // 受击反馈：整体轻微压扁（不碰共享材质，避免所有同类 SCP 一起闪）
  if (s.hitFlash > 0) {
    const k = 1 - (s.hitFlash / 0.16) * 0.06;
    s.group.scale.set(1 / k, k, 1 / k);
  } else if (s.group.scale.y !== 1) {
    s.group.scale.set(1, 1, 1);
  }
}

bootMark('scp');
