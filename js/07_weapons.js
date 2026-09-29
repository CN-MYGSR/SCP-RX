'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  07 武器系统
   ① 数值合成：基础数值 + 改装件 mul/add
   ② 程序化枪模：机匣/枪管/护木/枪托/弹匣/握把/瞄具/枪口/战术配件
   ③ 世界模型（第三人称掉落物）与视图模型（第一人称）共用同一套建模函数
   ===================================================================== */

/* ---------------------------------------------------------------------
   ① 数值合成
   --------------------------------------------------------------------- */
function computeWeaponStats(wpnId, mods) {
  const base = WPN_DEFS[wpnId];
  if (!base) return null;
  const s = Object.assign({}, base);
  s.mods = [];
  s.stealth = 0; s.hasFlashlight = false; s.hasBipod = false; s.hasLaser = false;
  s.hasScope = false;
  const slots = base.slots || [];
  for (const slot of slots) {
    const mid = mods && mods[slot];
    if (!mid) continue;
    const m = MOD_DEFS[mid];
    if (!m) continue;
    s.mods.push(m);
    for (const k in m.mul) s[k] = (s[k] == null ? 0 : s[k]) * m.mul[k];
    for (const k in m.add) {
      if (k === 'stealth') s.stealth += m.add[k];
      else if (k === 'flashlight') s.hasFlashlight = true;
      else if (k === 'bipod') s.hasBipod = true;
      else s[k] = (s[k] == null ? 0 : s[k]) + m.add[k];
    }
  }
  if (mods && mods.laser === 'laser' || mods && mods.laser === 'laserlight') s.hasLaser = true;
  if (mods && mods.optic === 'scope3x') s.hasScope = true;
  s.mag = Math.round(s.mag);
  s.reserve = Math.round(s.reserve);
  s.adsFov = clamp(s.adsFov, 12, 75);
  s.spreadAds = Math.max(0.02, s.spreadAds);
  s.spreadHip = Math.max(0.3, s.spreadHip);
  return s;
}

/* ---------------------------------------------------------------------
   ② 程序化枪模
   所有模型都朝 -Z 方向（three 的默认前向），枪口在 z 负方向。
   返回 { group, muzzle(Vector3 局部), magAnchor, boltAnchor, len }
   --------------------------------------------------------------------- */
const GUN_MAT = {
  body: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.62, metalness: 0.55 }),
  bodyLight: new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.58, metalness: 0.5 }),
  poly: new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.85, metalness: 0.1 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x5c646b, roughness: 0.34, metalness: 0.85 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.7, metalness: 0.4 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x6b6250, roughness: 0.8, metalness: 0.1 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x2a4a5a, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.6 }),
  emissiveRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  emissiveGreen: new THREE.MeshBasicMaterial({ color: 0x39ff8a }),
};

function bx(mat, w, h, d, x, y, z, g) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); if (g) g.add(m); return m;
}
function cyl(mat, r1, r2, h, x, y, z, g, axis) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 10), mat);
  m.position.set(x, y, z);
  if (axis === 'z') m.rotation.x = HPI;
  else if (axis === 'x') m.rotation.z = HPI;
  if (g) g.add(m); return m;
}
function boxMesh(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }

// 通用部件
function partRail(g, len, x, y, z, mat) {
  bx(mat || GUN_MAT.dark, 0.022, 0.012, len, x, y, z, g);
  // 齿
  const n = Math.floor(len / 0.026);
  for (let i = 0; i < n; i++) {
    bx(mat || GUN_MAT.dark, 0.026, 0.008, 0.012, x, y + 0.008, z - len / 2 + 0.014 + i * 0.026, g);
  }
}
function partGrip(g, x, y, z, rot, mat) {
  const m = bx(mat || GUN_MAT.poly, 0.038, 0.13, 0.055, x, y - 0.07, z, g);
  m.rotation.x = rot || 0.22;
  return m;
}
function partTrigger(g, x, y, z) {
  bx(GUN_MAT.metal, 0.012, 0.05, 0.016, x, y - 0.03, z, g);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 6, 12, PI), GUN_MAT.metal);
  guard.position.set(x, y - 0.032, z); guard.rotation.y = HPI; guard.rotation.z = PI;
  g.add(guard);
}
function partMag(g, x, y, z, mat, curve, len, w) {
  w = w || 0.03;
  const m = bx(mat || GUN_MAT.poly, w, len || 0.18, 0.075, x, y - (len || 0.18) / 2, z, g);
  m.rotation.x = curve || 0;
  return m;
}
function partStock(g, x, y, z, kind, mat) {
  const M = mat || GUN_MAT.poly;
  if (kind === 'solid') {
    bx(M, 0.045, 0.075, 0.20, x, y, z + 0.10, g);
    bx(M, 0.05, 0.11, 0.05, x, y - 0.01, z + 0.21, g);
  } else if (kind === 'skeleton') {
    bx(M, 0.04, 0.05, 0.19, x, y + 0.015, z + 0.10, g);
    bx(M, 0.04, 0.05, 0.19, x, y - 0.045, z + 0.10, g);
    bx(M, 0.05, 0.10, 0.045, x, y - 0.015, z + 0.20, g);
  } else if (kind === 'heavy') {
    bx(M, 0.055, 0.10, 0.21, x, y, z + 0.105, g);
    bx(M, 0.06, 0.13, 0.055, x, y - 0.012, z + 0.22, g);
  } else if (kind === 'none') {
    // 无托
  }
}
// 镜筒专用材质：中空圆柱需要双面，才能看到内壁
const GUN_MAT_TUBE = new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide });
const GUN_MAT_LENS = new THREE.MeshStandardMaterial({ color: 0x24506a, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
const GUN_MAT_DOT = new THREE.MeshBasicMaterial({ color: 0xff2010, side: THREE.DoubleSide });
const GUN_MAT_HOLO = new THREE.MeshBasicMaterial({ color: 0x2ad06a, transparent: true, opacity: 0.30, side: THREE.DoubleSide });

function partOptic(g, x, y, z, kind) {
  if (!kind || kind === 'iron') {
    // 机械瞄具：准星柱 + 缺口式照门
    // ⚠️ 照门必须是「左右两柱 + 中间缺口」，不能是一整块实心板 ——
    //    否则开镜时中心会被自己挡死。
    bx(GUN_MAT.dark, 0.008, 0.026, 0.008, x, y + 0.016, z - 0.16, g);          // 准星柱
    bx(GUN_MAT.dark, 0.006, 0.008, 0.006, x, y + 0.028, z - 0.16, g);          // 准星尖
    bx(GUN_MAT.dark, 0.011, 0.024, 0.008, x - 0.011, y + 0.014, z + 0.10, g);  // 照门左柱
    bx(GUN_MAT.dark, 0.011, 0.024, 0.008, x + 0.011, y + 0.014, z + 0.10, g);  // 照门右柱
    bx(GUN_MAT.dark, 0.033, 0.005, 0.008, x, y + 0.001, z + 0.10, g);          // 照门底座
    return;
  }
  // 通用底座 + 镜座
  bx(GUN_MAT.dark, 0.038, 0.014, 0.09, x, y + 0.012, z, g);
  const mountY = y + 0.034;

  if (kind === 'reddot') {
    // 中空镜筒（openEnded），从后面能直接看穿
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.085, 14, 1, true), GUN_MAT_TUBE);
    tube.rotation.x = HPI; tube.position.set(x, mountY + 0.012, z); g.add(tube);
    // 前后镜圈
    for (const dz of [-0.043, 0.043]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0045, 6, 16), GUN_MAT.dark);
      r.position.set(x, mountY + 0.012, z + dz); g.add(r);
    }
    // 前镜片（半透明）
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 16), GUN_MAT_LENS);
    lens.position.set(x, mountY + 0.012, z - 0.040); g.add(lens);
    // 红点
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0042, 10), GUN_MAT_DOT);
    dot.position.set(x, mountY + 0.012, z - 0.036); g.add(dot);
    // 顶部电池仓（在准线之上，不挡视线）
    bx(GUN_MAT.dark, 0.024, 0.018, 0.03, x, mountY + 0.040, z + 0.02, g);
    return;
  }
  if (kind === 'holo') {
    // 全息：四条细边围成的方框 + 透光窗。
    // ⚠️ 绝对不能加"后部外壳"——旧版在 z+0.045 放了个 0.05×0.036×0.05 的实心方块，
    //    正好卡在眼睛和透光窗之间，开镜后整块视野被自己挡死。
    const fw = 0.052, ft = 0.006, cy = mountY + 0.030;
    bx(GUN_MAT.body, fw, ft, 0.012, x, cy + fw / 2, z - 0.03, g);   // 上边
    bx(GUN_MAT.body, fw, ft, 0.012, x, cy - fw / 2, z - 0.03, g);   // 下边
    bx(GUN_MAT.body, ft, fw, 0.012, x - fw / 2, cy, z - 0.03, g);   // 左边
    bx(GUN_MAT.body, ft, fw, 0.012, x + fw / 2, cy, z - 0.03, g);   // 右边
    // 透光窗 + 全息准星环
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.044), GUN_MAT_HOLO);
    win.position.set(x, cy, z - 0.028); g.add(win);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0018, 6, 18), GUN_MAT_DOT);
    ring.position.set(x, cy, z - 0.026); g.add(ring);
    // 顶部遮光檐：位置在准线之上，只挡上方漏光，不挡视线
    bx(GUN_MAT.body, fw + 0.006, 0.012, 0.06, x, cy + fw / 2 + 0.009, z + 0.006, g);
    // 两侧小护翼
    for (const sx of [-1, 1]) {
      bx(GUN_MAT.body, 0.006, 0.022, 0.055, x + sx * (fw / 2 + 0.003), cy + 0.012, z + 0.004, g);
    }
    return;
  }
  if (kind === 'scope3x') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.20, 14, 1, true), GUN_MAT_TUBE);
    tube.rotation.x = HPI; tube.position.set(x, mountY + 0.020, z); g.add(tube);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.027, 0.05, 14, 1, true), GUN_MAT_TUBE);
    bell.rotation.x = HPI; bell.position.set(x, mountY + 0.020, z - 0.115); g.add(bell);
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.05, 14, 1, true), GUN_MAT_TUBE);
    eye.rotation.x = HPI; eye.position.set(x, mountY + 0.020, z + 0.105); g.add(eye);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.034, 16), GUN_MAT_LENS);
    lens.position.set(x, mountY + 0.020, z - 0.138); g.add(lens);
    for (const dz of [-0.06, 0.06]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.006, 6, 14), GUN_MAT.metal);
      r.position.set(x, mountY + 0.020, z + dz); g.add(r);
    }
    // 调节旋钮（在镜筒侧面，不挡视线）
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 8), GUN_MAT.metal);
    k.position.set(x + 0.030, mountY + 0.020, z + 0.02); k.rotation.z = HPI; g.add(k);
    return;
  }
}
function partMuzzle(g, x, y, z, kind) {
  if (!kind || kind === 'none_muzzle') { cyl(GUN_MAT.metal, 0.008, 0.008, 0.05, x, y, z, g, 'z'); return z; }
  if (kind === 'comp') {
    cyl(GUN_MAT.metal, 0.017, 0.017, 0.07, x, y, z, g, 'z');
    for (let i = 0; i < 3; i++) bx(GUN_MAT.dark, 0.036, 0.006, 0.008, x, y + 0.014, z - 0.02 + i * 0.02, g);
    return z - 0.035;
  }
  if (kind === 'flashhider') {
    cyl(GUN_MAT.metal, 0.012, 0.016, 0.06, x, y, z, g, 'z');
    return z - 0.03;
  }
  if (kind === 'supp') {
    cyl(GUN_MAT.dark, 0.024, 0.024, 0.16, x, y, z - 0.05, g, 'z');
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.002, 6, 12), GUN_MAT.metal);
      r.position.set(x, y, z - 0.02 - i * 0.03); g.add(r);
    }
    return z - 0.13;
  }
  return z;
}
function partTactical(g, x, y, z, kind) {
  if (!kind || kind === 'none_laser') return;
  if (kind === 'laser' || kind === 'laserlight') {
    const b = cyl(GUN_MAT.dark, 0.014, 0.014, 0.05, x, y, z, g, 'z');
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 8), GUN_MAT.emissiveRed);
    dot.position.set(x, y, z - 0.026); g.add(dot);
  }
  if (kind === 'flashlight' || kind === 'laserlight') {
    const b = cyl(GUN_MAT.metal, 0.017, 0.02, 0.05, x + 0.032, y, z, g, 'z');
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), new THREE.MeshBasicMaterial({ color: 0xfff4d0 }));
    lens.position.set(x + 0.032, y, z - 0.026); g.add(lens);
  }
}

// ---- 各枪的整枪建模 ----
// 视图模型整体缩放：真实枪长 0.9~1.2m，直接放在眼前会占满屏幕，
// 统一缩到 0.7 左右并用独立的 vmCamera 渲染，是 FPS 的常规做法。
const VM_SCALE = 0.70;

// 瞄具中心相对枪体原点的高度：开镜时把枪下移这么多，准线正好压在屏幕中心
function opticSightY(baseY, kind) {
  if (!kind || kind === 'iron') return baseY + 0.026;
  if (kind === 'reddot') return baseY + 0.046;
  if (kind === 'holo') return baseY + 0.064;
  if (kind === 'scope3x') return baseY + 0.054;
  return baseY + 0.03;
}

function buildGunModel(wpnId, mods, opts) {
  const g = new THREE.Group();
  const def = WPN_DEFS[wpnId];
  if (!def) return { group: g, muzzleZ: -0.5, muzzle: V3(), sightY: 0.1, anchors: {} };
  const M = mods || {};
  let muzzleZ = -0.4, sightY = 0.1;
  const A = {};   // 锚点

  if (wpnId === 'hk416' || wpnId === 'mp5' || wpnId === 'm249') {
    const isMG = wpnId === 'm249';
    const isSMG = wpnId === 'mp5';
    const recLen = isMG ? 0.40 : isSMG ? 0.22 : 0.28;
    const hgLen = isMG ? 0.34 : isSMG ? 0.16 : 0.26;
    // 机匣
    bx(GUN_MAT.body, 0.062, 0.10, recLen, 0, 0, 0.02, g);
    bx(GUN_MAT.bodyLight, 0.064, 0.03, recLen * 0.85, 0, 0.062, 0.02, g);
    // 顶部导轨
    partRail(g, recLen * 0.8, 0, 0.082, 0.0);
    // 护木
    const hgZ = -recLen / 2 - hgLen / 2 + 0.02;
    if (isSMG) {
      const tube = cyl(GUN_MAT.poly, 0.036, 0.036, hgLen + 0.06, 0, 0, hgZ, g, 'z');
      partRail(g, hgLen, 0, 0.045, hgZ);
    } else {
      bx(GUN_MAT.poly, 0.055, 0.075, hgLen, 0, -0.005, hgZ, g);
      for (let i = 0; i < 4; i++) bx(GUN_MAT.dark, 0.058, 0.008, 0.02, 0, -0.038, hgZ - hgLen / 2 + 0.05 + i * 0.06, g);
      partRail(g, hgLen * 0.9, 0, 0.038, hgZ);
    }
    // 枪管
    const barrelLen = isMG ? 0.42 : isSMG ? 0.16 : 0.34;
    const barrelZ = hgZ - hgLen / 2;
    cyl(GUN_MAT.metal, isMG ? 0.016 : 0.011, isMG ? 0.016 : 0.011, barrelLen, 0, 0, barrelZ - barrelLen / 2, g, 'z');
    // 导气管
    if (!isSMG) cyl(GUN_MAT.dark, 0.007, 0.007, barrelLen * 0.7, 0, 0.026, barrelZ - barrelLen * 0.35, g, 'z');
    muzzleZ = partMuzzle(g, 0, 0, barrelZ - barrelLen + 0.02, M.muzzle);
    // 握把
    A.grip = V3(0, -0.1, 0.10);
    partGrip(g, 0, -0.06, 0.10);
    partTrigger(g, 0, -0.035, 0.055);
    // 弹匣
    const magLen = isMG ? 0.22 : 0.19;
    A.mag = partMag(g, 0, -0.05, -0.03, GUN_MAT.poly, isMG ? 0.05 : 0.20, magLen, isMG ? 0.055 : 0.03);
    if (isMG) bx(GUN_MAT.dark, 0.075, 0.10, 0.16, 0, -0.13, -0.02, g);
    // 枪托
    partStock(g, 0, 0, recLen / 2 + 0.02, isMG ? 'heavy' : (M.stock === 'light' ? 'skeleton' : 'solid'));
    // 拉机柄
    A.bolt = bx(GUN_MAT.metal, 0.018, 0.016, 0.06, 0.045, 0.03, -recLen * 0.15, g);
    // 抛壳口
    bx(GUN_MAT.dark, 0.008, 0.026, 0.05, 0.033, 0.02, 0.02, g);
    // 瞄具
    partOptic(g, 0, 0.082, M.optic === 'scope3x' ? 0.0 : 0.01, M.optic);
    // 战术
    partTactical(g, -0.035, -0.02, hgZ + 0.02, M.laser);
    // 两脚架
    if (isMG && M.grip === 'bipod') {
      for (const sx of [-1, 1]) {
        const leg = bx(GUN_MAT.metal, 0.012, 0.16, 0.012, sx * 0.04, -0.13, -0.18, g);
        leg.rotation.z = sx * 0.35;
      }
    }
    A.length = Math.abs(muzzleZ) + 0.3;
  } else if (wpnId === 'glock18') {
    // 套筒
    bx(GUN_MAT.body, 0.045, 0.055, 0.21, 0, 0.02, -0.03, g);
    bx(GUN_MAT.metal, 0.046, 0.012, 0.21, 0, 0.05, -0.03, g);
    // 套筒锯齿
    for (let i = 0; i < 5; i++) bx(GUN_MAT.dark, 0.048, 0.03, 0.006, 0, 0.018, 0.03 + i * 0.014, g);
    // 枪管口
    cyl(GUN_MAT.metal, 0.011, 0.011, 0.03, 0, 0.02, -0.14, g, 'z');
    muzzleZ = partMuzzle(g, 0, 0.02, -0.135, M.muzzle);
    // 握把
    const grip = bx(GUN_MAT.poly, 0.042, 0.16, 0.055, 0, -0.09, 0.055, g);
    grip.rotation.x = 0.26;
    partTrigger(g, 0, -0.01, 0.005);
    // 弹匣（插在握把里）
    bx(GUN_MAT.dark, 0.032, 0.10, 0.042, 0, -0.13, 0.062, g);
    A.mag = bx(GUN_MAT.dark, 0.032, 0.09, 0.042, 0, -0.11, 0.062, g);
    A.bolt = bx(GUN_MAT.metal, 0.01, 0.012, 0.04, 0.026, 0.035, 0.03, g);
    // 瞄具
    if (M.optic && M.optic !== 'iron') {
      partOptic(g, 0, 0.048, -0.05, M.optic === 'scope3x' ? 'reddot' : M.optic);
    } else {
      bx(GUN_MAT.dark, 0.006, 0.016, 0.006, 0, 0.062, -0.125, g);
      bx(GUN_MAT.dark, 0.022, 0.016, 0.008, 0, 0.062, 0.055, g);
    }
    partTactical(g, -0.028, 0.0, -0.06, M.laser);
    A.length = 0.42;
  } else if (wpnId === 'spas12') {
    bx(GUN_MAT.body, 0.06, 0.11, 0.30, 0, 0, 0.02, g);
    cyl(GUN_MAT.metal, 0.019, 0.019, 0.44, 0, 0.01, -0.42, g, 'z');
    cyl(GUN_MAT.dark, 0.016, 0.016, 0.40, 0, -0.045, -0.40, g, 'z');   // 弹管
    bx(GUN_MAT.poly, 0.05, 0.06, 0.18, 0, -0.01, -0.20, g);            // 泵柄
    partGrip(g, 0, -0.07, 0.11);
    partTrigger(g, 0, -0.04, 0.06);
    partStock(g, 0, 0, 0.17, 'solid');
    muzzleZ = partMuzzle(g, 0, 0.01, -0.63, M.muzzle);
    partOptic(g, 0, 0.062, 0.02, M.optic);
    A.length = 0.8;
  }

  // 统一缩放到"视图模型尺度"（真实枪长 0.6~0.9m，视图里直接用米）
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  // 世界模型（队友/掉落物）保持真实尺寸，视图模型缩到 VM_SCALE
  const sc = (opts && opts.worldScale) ? 1.0 : VM_SCALE;
  g.scale.setScalar(sc);
  // 瞄具基准高度（这是"世界偏移"，需同步缩放；muzzleZ 交给 localToWorld，不能缩放）
  if (wpnId === 'glock18') sightY = opticSightY(0.048, M.optic || 'iron');
  else if (wpnId === 'spas12') sightY = opticSightY(0.062, M.optic || 'iron');
  else sightY = opticSightY(0.082, M.optic || 'iron');
  sightY *= sc;
  return { group: g, muzzleZ, anchors: A, def, sightY, scale: sc };
}

/* ---------------------------------------------------------------------
   ③ 枪口火焰 & 弹道曳光
   --------------------------------------------------------------------- */
function makeMuzzleFlash() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.22, 'rgba(255,214,120,0.92)');
  gr.addColorStop(0.55, 'rgba(255,140,40,0.36)');
  gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // 星形放射
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * TAU;
    g.save(); g.translate(64, 64); g.rotate(a);
    const lg = g.createLinearGradient(0, 0, 62, 0);
    lg.addColorStop(0, 'rgba(255,240,200,0.85)'); lg.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = lg; g.fillRect(0, -3, 62, 6);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const MUZZLE_TEX = makeMuzzleFlash();

bootMark('weapons');
