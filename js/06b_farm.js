'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  06b 加州农场
   行动：收容 SCP-096
   背景：SCP-096 于一次摄影事故后脱离收容，最终在美国加利福尼亚州
         一处偏远农场停下。Nu-7「落锤」被部署到现场执行收容。

   玩法与设施地图完全不同：
     · 户外夜景，开阔地，掩体只有木栅栏 / 干草垛 / 树木 / 车辆
     · SCP-096 一开始是温顺状态，蹲坐在田野里
     · 靠近按住 F 给它套上收容头套 → 之后它再也看不见，不会暴走
     · 场内散落 6 张拍到 SCP-096 面部的照片，必须按 F 逐一划掉
       （盯着照片看太久会把它「看」暴走）
     · 最后到公路上的直升机撤离
   ===================================================================== */

const FARM = {
  photos: [],
  heli: null,
  house: null, barn: null, silo: null, truck: null,
  photoTotal: 0,
};

/* ---------------------------------------------------------------------
   工具
   --------------------------------------------------------------------- */
function carveRect(c0, c1, r0, r1, zone) {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (!inGrid(c, r)) continue;
    FAC.open[idxOf(c, r)] = 1;
    FAC.zone[idxOf(c, r)] = zone || 'EZ';
  }
}

// 沿 X 方向的一段墙（位于 z 处，从 x0 到 x1）。gaps: [[start,end], ...] 是沿墙的开口区间（绝对坐标）
function wallX(x0, x1, z, h, thick, mat, gaps) {
  const a = Math.min(x0, x1), b = Math.max(x0, x1);
  const segs = splitGaps(a, b, gaps);
  for (const [s0, s1] of segs) {
    const L = s1 - s0;
    if (L <= 0.06) continue;
    const cx = (s0 + s1) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, thick), mat);
    m.position.set(cx, h / 2, z);
    scene.add(m);
    addBox(cx, h / 2, z, L, h, thick, { wall: true });
  }
  // 每个门洞都在导航网格上登记，避免 1.5m 的导航格把 2m 的门洞取整吃掉
  for (const [g0, g1] of (gaps || [])) {
    NAV_OPENINGS.push({ x0: Math.min(g0, g1), x1: Math.max(g0, g1), z0: z - thick * 2.5, z1: z + thick * 2.5 });
  }
  return segs.length;
}
// 沿 Z 方向的一段墙（位于 x 处，从 z0 到 z1）
function wallZ(z0, z1, x, h, thick, mat, gaps) {
  const a = Math.min(z0, z1), b = Math.max(z0, z1);
  const segs = splitGaps(a, b, gaps);
  for (const [s0, s1] of segs) {
    const L = s1 - s0;
    if (L <= 0.06) continue;
    const cz = (s0 + s1) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(thick, h, L), mat);
    m.position.set(x, h / 2, cz);
    scene.add(m);
    addBox(x, h / 2, cz, thick, h, L, { wall: true });
  }
  for (const [g0, g1] of (gaps || [])) {
    NAV_OPENINGS.push({ z0: Math.min(g0, g1), z1: Math.max(g0, g1), x0: x - thick * 2.5, x1: x + thick * 2.5 });
  }
  return segs.length;
}
function splitGaps(a, b, gaps) {
  const segs = [];
  let cur = a;
  const gs = (gaps || []).map(g => [Math.max(a, Math.min(g[0], g[1])), Math.min(b, Math.max(g[0], g[1]))]).sort((p, q) => p[0] - q[0]);
  for (const [g0, g1] of gs) {
    if (g0 > cur) segs.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (cur < b) segs.push([cur, b]);
  return segs;
}

/* ---------------------------------------------------------------------
   主入口
   --------------------------------------------------------------------- */
function buildFarm() {
  FAC.mode = 'farm';
  FAC.rooms.length = 0; FAC.roomAt = {}; FAC.doors.length = 0; FAC.lights.length = 0;
  FAC.breakers.length = 0; FAC.props.length = 0;
  FAC.terminal = null; FAC.extract = null; FAC.nuke = null; FAC.coffee = null;
  PHOTOS.length = 0;

  // 整个农场区域在结构上都是可走的；建筑墙由 wall 碰撞体挡（buildNavGrid 的 ①b 步）
  FAC.open = new Uint8Array(GW * GH);
  FAC.zone = new Array(GW * GH).fill('EZ');
  NAV_OPENINGS.length = 0;
  carveRect(3, 56, 3, 68, 'EZ');

  applyEnvironment('farm');

  buildOccupancyForProps();
  buildFarmGround();
  buildFarmRoad();
  buildFarmSky();
  buildFarmhouse();
  buildFarmBarn();
  buildFarmSilo();
  buildFarmTower();
  buildFarmFences();
  buildFarmTrees();
  buildFarmTruck();
  buildFarmProps();
  buildFarmLights();
  buildFarmKeyPoints();

  buildNavGrid();
  buildSpatialIndex();
}

/* ---------------------------------------------------------------------
   地面 / 公路 / 夜空
   --------------------------------------------------------------------- */
function buildFarmGround() {
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 200),
    new THREE.MeshStandardMaterial({ map: cloneTex(TEX.grass, 40, 44), roughness: 1, metalness: 0 })
  );
  g.rotation.x = -HPI;
  g.position.set(0, 0, 0);
  scene.add(g);
  // 远处地平线压暗
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(78, 190, 40),
    new THREE.MeshBasicMaterial({ color: 0x0a0d14, side: THREE.DoubleSide })
  );
  ring.rotation.x = -HPI; ring.position.y = 0.03;
  scene.add(ring);
}

function buildFarmRoad() {
  const roadMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.dirt, 26, 3), roughness: 1 });
  const road = new THREE.Mesh(new THREE.BoxGeometry(160, 0.12, 13), roadMat);
  road.position.set(0, 0.06, 63);
  scene.add(road);
  // 车道：从公路拐到农舍
  const drive = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 34), roadMat);
  drive.position.set(-26, 0.06, 44);
  scene.add(drive);
}

function buildFarmSky() {
  // 星空
  const N = 420, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = rand(0, TAU), ph = Math.acos(rand(-0.05, 0.98));
    const r = 300;
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    pos[i * 3 + 1] = Math.cos(ph) * r * 0.85 + 8;
    pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8e4ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
  stars.frustumCulled = false;
  scene.add(stars);
  // 月亮
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g2 = c.getContext('2d');
  const gr = g2.createRadialGradient(64, 64, 3, 64, 64, 64);
  gr.addColorStop(0, 'rgba(238,244,255,1)');
  gr.addColorStop(0.22, 'rgba(206,222,255,.85)');
  gr.addColorStop(1, 'rgba(160,190,255,0)');
  g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
  moon.position.set(-140, 150, -190);
  moon.scale.setScalar(34);
  scene.add(moon);
}

/* ---------------------------------------------------------------------
   农舍（可进入，两个房间 + 门廊）
   --------------------------------------------------------------------- */
function buildFarmhouse() {
  const cx = -26, cz = 16, W = 18, D = 13, H = 3.3, T = 0.24;
  const wood = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 3, 1), roughness: 0.95 });
  const woodV = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 1, 2), roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.rust, 3, 3), roughness: 0.9 });
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;

  // 四面外墙：南墙开门 + 两扇窗，其余墙开窗
  wallX(x0, x1, z1, H, T, wood, [[cx - 1.1, cx + 1.1]]);                 // 南（正面）· 大门
  wallX(x0, x1, z0, H, T, wood, [[cx - 5.5, cx - 3.5], [cx + 3.5, cx + 5.5]]); // 北 · 两窗
  wallZ(z0, z1, x0, H, T, woodV, [[cz - 3.5, cz - 1.8]]);                // 西 · 一窗
  wallZ(z0, z1, x1, H, T, woodV, [[cz + 1.8, cz + 3.5]]);                // 东 · 一窗
  // 内墙（把屋子分成前后两间）
  wallZ(z0, z1, cx + 2, H, T, woodV, [[cz + 2.2, cz + 4.2]]);
  // 地板 / 天花板 / 屋顶
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, D), new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 5, 4), roughness: 0.95 }));
  floor.position.set(cx, 0.07, cz); scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.2, D + 0.5), woodV);
  ceil.position.set(cx, H + 0.1, cz); scene.add(ceil);
  // 双坡屋顶（屋脊在中间、檐口在外侧）
  const roofRise = 2.2, roofHalf = W / 2 + 0.6;
  const slopeLen = Math.hypot(roofHalf, roofRise), ang = Math.atan2(roofRise, roofHalf);
  for (const sx of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.2, D + 1.2), roofMat);
    slope.position.set(cx + sx * roofHalf / 2, H + roofRise / 2, cz);
    slope.rotation.z = -sx * ang;
    scene.add(slope);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, D + 1.3), roofMat);
  ridge.position.set(cx, H + roofRise, cz); scene.add(ridge);
  // 门廊
  const porch = new THREE.Mesh(new THREE.BoxGeometry(7, 0.14, 2.4), wood);
  porch.position.set(cx, 0.07, z1 + 1.2); scene.add(porch);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), wood);
    post.position.set(cx + sx * 3.2, 1.3, z1 + 2.2); scene.add(post);
    addBox(cx + sx * 3.2, 1.3, z1 + 2.2, 0.2, 2.6, 0.2, {});
  }
  const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.16, 2.8), roofMat);
  porchRoof.position.set(cx, 2.7, z1 + 1.2); scene.add(porchRoof);

  FARM.house = { x: cx, z: cz, w: W, d: D, x0, x1, z0, z1, h: H };
  registerFarmRoom('HOUSE', '农舍', cx, cz, W, D, 'office');
}

/* ---------------------------------------------------------------------
   谷仓（高大开阔，内部有隔栏）
   --------------------------------------------------------------------- */
function buildFarmBarn() {
  const cx = 24, cz = 0, W = 22, D = 16, H = 7, T = 0.3;
  const wood = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 4, 3), color: 0x9a7c58, roughness: 0.98 });
  const woodV = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 1, 4), color: 0x8a6e4c, roughness: 0.98 });
  const roofMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.rust, 4, 4), roughness: 0.92 });
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;

  // 南面开大门（5m），北面开两扇小门
  wallX(x0, x1, z1, H, T, wood, [[cx - 2.6, cx + 2.6]]);
  wallX(x0, x1, z0, H, T, wood, [[cx - 8.5, cx - 7.0], [cx + 7.0, cx + 8.5]]);
  wallZ(z0, z1, x0, H, T, woodV, []);
  wallZ(z0, z1, x1, H, T, woodV, []);

  // 内部隔栏（四间畜栏，每间朝南留 3.4m 的栏门，否则里面进不去）
  for (let i = 0; i < 4; i++) {
    const sx = cx - 8 + i * 5.4;
    wallZ(z0 + 0.4, z0 + 5.4, sx, 2.0, 0.16, woodV, []);
    if (i < 3) wallX(sx, sx + 5.4, z0 + 5.4, 2.0, 0.16, woodV, [[sx + 2.0, sx + 5.4]]);
  }
  // 干草阁楼
  const loft = new THREE.Mesh(new THREE.BoxGeometry(W - 1, 0.25, 6), wood);
  loft.position.set(cx, 4.2, z0 + 3.4); scene.add(loft);
  addBox(cx, 4.2, z0 + 3.4, W - 1, 0.25, 6, {});
  for (const sx of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, D), woodV);
    beam.position.set(cx + sx * (W / 2 - 1.2), 4.5, cz); scene.add(beam);
  }
  // 地板 / 屋顶
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, D), new THREE.MeshStandardMaterial({ map: cloneTex(TEX.dirt, 8, 6), roughness: 1 }));
  floor.position.set(cx, 0.07, cz); scene.add(floor);
  // 双坡屋顶
  const roofRise = 2.6, roofHalf = W / 2 + 0.7;
  const slopeLen = Math.hypot(roofHalf, roofRise), ang = Math.atan2(roofRise, roofHalf);
  for (const sx of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.24, D + 1.4), roofMat);
    slope.position.set(cx + sx * roofHalf / 2, H + roofRise / 2, cz);
    slope.rotation.z = -sx * ang;
    scene.add(slope);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, D + 1.5), roofMat);
  ridge.position.set(cx, H + roofRise, cz); scene.add(ridge);
  // 山墙（把三角形缺口用两块板补上）
  for (const zz of [z0, z1]) {
    for (const sx of [-1, 1]) {
      const g2 = new THREE.Mesh(new THREE.BoxGeometry(slopeLen * 0.98, 0.18, 0.22), wood);
      g2.position.set(cx + sx * roofHalf / 2, H + roofRise / 2, zz);
      g2.rotation.z = -sx * ang;
      scene.add(g2);
    }
  }
  FARM.barn = { x: cx, z: cz, w: W, d: D, x0, x1, z0, z1, h: H };
  registerFarmRoom('BARN', '谷仓', cx, cz, W, D, 'store');
}

/* ---------------------------------------------------------------------
   筒仓 / 水塔
   --------------------------------------------------------------------- */
function buildFarmSilo() {
  const cx = 39, cz = 8, r = 3.6, h = 13;
  const mat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.metalWall, 4, 8), color: 0xb8bfc6, roughness: 0.6, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18, 1, true), mat);
  body.position.set(cx, h / 2, cz);
  scene.add(body);
  addCyl(cx, cz, r, 0, h);
  // 顶盖
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 8, 0, TAU, 0, HPI), mat);
  cap.position.set(cx, h, cz); scene.add(cap);
  // 加固环
  for (let i = 1; i <= 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.06, 0.07, 6, 20), new THREE.MeshStandardMaterial({ color: 0x6a7076, metalness: 0.7, roughness: 0.4 }));
    ring.position.set(cx, i * (h / 5), cz); ring.rotation.x = HPI; scene.add(ring);
  }
  // 送料管
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, h * 0.7, 8), mat);
  pipe.position.set(cx - r - 0.5, h * 0.45, cz); scene.add(pipe);
  registerLight(cx, h - 1.2, cz, 0xff5a3a, 0.9, 12, { flicker: 0.55 });   // 航空障碍灯
  registerFarmRoom('SILO', '筒仓', cx, cz, r * 2, r * 2, 'utility');
}

function buildFarmTower() {
  const cx = -44, cz = -26, legH = 9, tankR = 3.2;
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.7, roughness: 0.5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, legH, 6), steel);
    leg.position.set(cx + sx * 2.2, legH / 2, cz + sz * 2.2);
    leg.rotation.z = sx * -0.06; leg.rotation.x = sz * 0.06;
    scene.add(leg);
    addCyl(cx + sx * 2.2, cz + sz * 2.2, 0.2, 0, legH);
  }
  for (let i = 1; i <= 3; i++) {
    const brace = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.06, 4, 4), steel);
    brace.position.set(cx, i * (legH / 4), cz); brace.rotation.x = HPI; brace.rotation.z = PI / 4;
    scene.add(brace);
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(tankR, tankR, 3.4, 16), new THREE.MeshStandardMaterial({ map: cloneTex(TEX.rust, 3, 2), roughness: 0.9 }));
  tank.position.set(cx, legH + 1.7, cz); scene.add(tank);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(tankR, 1.2, 16), new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.9 }));
  cone.position.set(cx, legH + 4.0, cz); scene.add(cone);
  registerLight(cx, legH + 4.8, cz, 0xff5a3a, 0.8, 12, { flicker: 0.6 });
  registerFarmRoom('TOWER', '水塔', cx, cz, 8, 8, 'utility');
}

/* ---------------------------------------------------------------------
   栅栏 / 树 / 车 / 杂物
   --------------------------------------------------------------------- */
function buildFarmFences() {
  const wood = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 2, 1), roughness: 0.98 });
  const postMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 1, 2), color: 0x8a7355, roughness: 0.98 });
  const fenceLine = (x0, z0, x1, z1, gaps) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = lerp(x0, x1, t), pz = lerp(z0, z1, t);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), postMat);
      post.position.set(px, 0.75, pz); scene.add(post);
      addCyl(px, pz, 0.12, 0, 1.5);
    }
    // 两道横杆
    const ry = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.55, 1.15]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, len), wood);
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.rotation.y = ry;
      scene.add(rail);
    }
  };
  // 牧场围栏（SCP-096 就在里面）
  fenceLine(-2, -52, 34, -52);
  fenceLine(34, -52, 34, -18);
  fenceLine(34, -18, -2, -18);
  fenceLine(-2, -18, -2, -52);
  // 农舍前的车道两侧
  fenceLine(-38, 34, -38, 56);
  fenceLine(-14, 34, -14, 56);
}

function buildFarmTrees() {
  const trunkMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 2, 3), color: 0x6a5238, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2c3a22, roughness: 1 });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x38461f, roughness: 1 });
  const spots = [
    [-56, 40], [-52, 4], [-58, -14], [-30, -46], [-52, -54], [8, 44], [44, 40],
    [54, 24], [56, -8], [52, -40], [16, -60], [-16, -62], [-46, 60], [58, 58], [-60, 22], [40, -60],
  ];
  for (const [x, z] of spots) {
    const h = rand(4.5, 7.5), r = rand(0.22, 0.36);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h, 7), trunkMat);
    trunk.position.set(x, h / 2, z); scene.add(trunk);
    addCyl(x, z, r + 0.1, 0, h);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(rand(1.8, 2.8), 8, 6), Math.random() < 0.5 ? leafMat : leafMat2);
    crown.position.set(x, h + 1.2, z);
    crown.scale.y = rand(0.8, 1.2);
    scene.add(crown);
  }
}

function buildFarmTruck() {
  const x = -14, z = 44, ry = 0.35;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.55, metalness: 0.45 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x203040, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.55 });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.6), bodyMat); bed.position.set(0, 0.85, 0); g.add(bed);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.05, 1.9), bodyMat); cab.position.set(0, 1.7, -1.25); g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.7), bodyMat); roof.position.set(0, 2.28, -1.25); g.add(roof);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.06), glassMat); wind.position.set(0, 1.85, -2.18); g.add(wind);
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.4), glassMat); sideL.position.set(-1.0, 1.85, -1.2); g.add(sideL);
  const sideR = sideL.clone(); sideR.position.x = 1.0; g.add(sideR);
  for (const [wx, wz] of [[-1.05, -1.5], [1.05, -1.5], [-1.05, 1.5], [1.05, 1.5]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), darkMat);
    wheel.position.set(wx, 0.42, wz); wheel.rotation.z = HPI; g.add(wheel);
  }
  // 尾灯
  for (const sx of [-0.75, 0.75]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    lamp.position.set(sx, 1.0, 2.32); g.add(lamp);
  }
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
  // 碰撞体（近似一个盒子）
  addBox(x, 1.1, z, 2.6, 2.2, 5.2, {});
  FARM.truck = { x, z, ry };
}

function buildFarmProps() {
  const hayMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.grass, 3, 2), color: 0xc8a850, roughness: 1 });
  const crateMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 2, 2), color: 0x9a7c58, roughness: 1 });
  const barrelMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.rust, 2, 2), color: 0x6a5a48, roughness: 0.85, metalness: 0.3 });
  // 干草垛（圆形，可当掩体）
  const haySpots = [[6, 20], [12, 24], [30, 22], [-6, -6], [40, -4], [16, 34], [-34, 6], [46, 16]];
  for (const [x, z] of haySpots) {
    const r = rand(1.1, 1.5), h = rand(1.1, 1.4);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), hayMat);
    m.position.set(x, h / 2, z);
    m.rotation.z = Math.random() < 0.5 ? HPI : 0;
    if (m.rotation.z !== 0) m.position.y = r;
    scene.add(m);
    addCyl(x, z, r, 0, m.rotation.z === 0 ? h : r * 2);
  }
  // 木箱 / 油桶
  const crates = [[-30, 22], [-32, 20], [20, -6], [28, -6], [-38, 50], [44, 8], [-20, -20], [24, 30]];
  for (const [x, z] of crates) {
    const s = rand(0.8, 1.15);
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.9, s), crateMat);
    m.position.set(x, s * 0.45, z);
    m.rotation.y = rand(0, TAU);
    scene.add(m);
    addBox(x, s * 0.45, z, s * 1.1, s * 0.9, s * 1.1, {});
  }
  const barrels = [[-33, 24], [42, 12], [-40, 46], [26, -18], [-12, -30], [52, 20]];
  for (const [x, z] of barrels) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), barrelMat);
    m.position.set(x, 0.5, z); scene.add(m);
    addCyl(x, z, 0.44, 0, 1.0);
  }
  // 农具 / 木桩
  const toolMat = new THREE.MeshStandardMaterial({ color: 0x4a4a50, metalness: 0.6, roughness: 0.5 });
  for (const [x, z] of [[-24, 26], [22, 10], [36, -14]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), toolMat);
    m.position.set(x, 0.8, z); scene.add(m);
  }
}

/* ---------------------------------------------------------------------
   灯光
   --------------------------------------------------------------------- */
function buildFarmLights() {
  // 门廊灯
  registerLight(FARM.house.x, 2.6, FARM.house.z1 + 0.4, 0xffc070, 1.6, 14, { flicker: 0.12 });
  registerLight(FARM.house.x + 6.5, 2.2, FARM.house.z1 + 0.2, 0xffb060, 0.9, 9, { flicker: 0.3 });
  // 屋内
  registerLight(FARM.house.x - 4.5, 2.5, FARM.house.z, 0xffd8a0, 1.5, 12, { flicker: 0.18 });
  registerLight(FARM.house.x + 5.0, 2.5, FARM.house.z, 0xffd8a0, 1.3, 11, { flicker: 0.5 });
  // 谷仓
  registerLight(FARM.barn.x, 5.6, FARM.barn.z, 0xffd090, 2.0, 20, { flicker: 0.25 });
  registerLight(FARM.barn.x - 7, 4.6, FARM.barn.z - 4, 0xffc880, 1.3, 13, { flicker: 0.45 });
  registerLight(FARM.barn.x + 7, 4.6, FARM.barn.z + 4, 0xffc880, 1.3, 13, { flicker: 0.1 });
  // 户外泛光灯（农场空地）
  registerLight(0, 7, 40, 0xcfe0ff, 1.4, 26, { flicker: 0 });
  registerLight(-20, 6, -4, 0xcfe0ff, 1.2, 24, { flicker: 0.2 });
  registerLight(30, 6, -30, 0xcfe0ff, 1.2, 24, { flicker: 0 });
  // 杆灯模型
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.6, roughness: 0.5 });
  for (const [x, z] of [[0, 40], [-20, -4], [30, -30]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 8), poleMat);
    pole.position.set(x, 3.5, z); scene.add(pole);
    addCyl(x, z, 0.2, 0, 7);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.5), new THREE.MeshBasicMaterial({ color: 0xdff0ff }));
    head.position.set(x, 7.05, z); scene.add(head);
  }
  // 直升机着陆区灯
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    const x = FARM.heliX + Math.cos(a) * 7, z = FARM.heliZ + Math.sin(a) * 7;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x39ff8a : 0xffd23f }));
    lamp.position.set(x, 0.2, z); scene.add(lamp);
  }
  registerLight(FARM.heliX, 3, FARM.heliZ, 0x8fffc0, 1.6, 22, { flicker: 0 });
}

/* ---------------------------------------------------------------------
   关键点位：出生点 / 撤离直升机 / 照片 / SCP-096
   --------------------------------------------------------------------- */
FARM.heliX = 46; FARM.heliZ = 63;

function buildFarmKeyPoints() {
  // 出生点：公路西端
  FAC.spawn = { x: -48, z: 62, yaw: HPI };
  // 撤离直升机
  FAC.extract = makeHelicopter(FARM.heliX, FARM.heliZ, 'EZ');
  // 照片（6 张）
  const photoSpots = [
    { x: FARM.house.x - 4.5, z: FARM.house.z + 4.4, y: 0.86, ry: 0.0, where: '农舍 · 厨房餐桌' },
    { x: FARM.house.x + 5.2, z: FARM.house.z - 4.2, y: 0.86, ry: 0.0, where: '农舍 · 里屋书桌' },
    { x: FARM.barn.x - 5.0, z: FARM.barn.z + 3.6, y: 0.86, ry: 0.4, where: '谷仓 · 工作台' },
    { x: FARM.barn.x + 8.5, z: FARM.barn.z + 4.0, y: 0.86, ry: -0.3, where: '谷仓 · 干草阁楼梯口' },
    { x: FARM.truck.x + 0.2, z: FARM.truck.z - 1.2, y: 1.05, ry: 0.35, where: '皮卡 · 驾驶室' },
    { x: 39, z: 12.4, y: 0.86, ry: 0.0, where: '筒仓 · 底座' },
  ];
  PHOTOS.length = 0;
  for (let i = 0; i < photoSpots.length; i++) {
    const sp = photoSpots[i];
    makePhoto(sp.x, sp.y, sp.z, sp.ry, i, sp.where);
  }
  FARM.photoTotal = PHOTOS.length;
  scatterFarmPickups();
}

/* ---------- 农场补给：弹药 / 医疗 / 电池 ---------- */
function scatterFarmPickups() {
  const spots = [
    { x: -48, z: 58, t: 'ammo_rifle' }, { x: -44, z: 66, t: 'medkit' },
    { x: -30, z: 24, t: 'ammo_rifle' }, { x: -22, z: 20, t: 'bandage' },
    { x: -26, z: 12, t: 'armor_plate' }, { x: -20, z: 9, t: 'ammo_smg' },
    { x: 20, z: 6, t: 'ammo_rifle' }, { x: 27, z: -5, t: 'bandage' },
    { x: 24, z: 7, t: 'medkit' }, { x: 36, z: 4, t: 'battery' },
    { x: -12, z: 42, t: 'ammo_smg' }, { x: -16, z: 46, t: 'bandage' },
    { x: 40, z: 60, t: 'medkit' }, { x: 52, z: 66, t: 'ammo_rifle' },
    { x: 8, z: -30, t: 'bandage' }, { x: -4, z: -34, t: 'ammo_rifle' },
  ];
  for (const s of spots) {
    if (!openAtWorld(s.x, s.z, 0)) continue;
    spawnPickup(s.t, s.x, s.z);
  }
}

/* ---------- 交互物：一张拍到 SCP-096 面部的照片 ----------
   style: 'desk'（木桌，农舍/办公室用）| 'crate'（木箱，仓库/军械库用）| 'metal'（设施金属台） */
function makePhoto(x, y, z, ry, idx, where, style) {
  const g = new THREE.Group();
  const kind = style || 'desk';
  if (kind === 'metal') {
    // 设施里的金属档案台
    const mm = new THREE.MeshStandardMaterial({ color: 0x8a9199, metalness: 0.6, roughness: 0.45 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9), mm);
    top.position.y = -0.06; g.add(top);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 0.8), new THREE.MeshStandardMaterial({ color: 0x3a4046, metalness: 0.5, roughness: 0.6 }));
    skirt.position.y = -0.46; g.add(skirt);
  } else if (kind === 'crate') {
    // 木箱
    const cm = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 2, 2), color: 0x9a7c58, roughness: 0.98 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.86, 1.0), cm);
    box.position.y = -0.47; g.add(box);
    for (const sy of [-0.75, -0.2]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.07, 1.06), new THREE.MeshStandardMaterial({ color: 0x5a4a36, roughness: 1 }));
      band.position.y = sy; g.add(band);
    }
  } else {
    // 木桌
    const tableMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.wood, 2, 1), roughness: 0.95 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9), tableMat);
    table.position.y = -0.06; g.add(table);
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.34, 0.34]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), tableMat);
      leg.position.set(sx, -0.46, sz); g.add(leg);
    }
  }
  // 档案夹（垫在照片下面，让它在深色台面上更好认）
  const folder = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.32), new THREE.MeshStandardMaterial({ color: 0xb8a878, roughness: 0.9 }));
  folder.position.set(0, -0.005, 0); g.add(folder);
  // 照片本体（略微倾斜地摆在台面上）
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.19), new THREE.MeshStandardMaterial({ map: TEX.photo096, roughness: 0.85, side: THREE.DoubleSide }));
  photo.position.set(0, 0.01, 0); photo.rotation.x = -HPI + 0.12; photo.rotation.z = rand(-0.3, 0.3);
  g.add(photo);
  // 被划掉的红叉（初始隐藏）
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xd83a2a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const cross = new THREE.Group();
  for (const rz of [0.78, -0.78]) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.045), crossMat);
    bar.rotation.z = rz; cross.add(bar);
  }
  cross.position.set(0, 0.02, 0); cross.rotation.x = -HPI + 0.12;
  cross.visible = false;
  g.add(cross);
  // 位置标记（淡淡的黄色微光，方便找到）
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.07 }));
  halo.position.y = 0.25; g.add(halo);
  g.position.set(x, y, z);
  g.rotation.y = ry || 0;
  scene.add(g);
  addBox(x, y - 0.45, z, 1.7, 0.9, 1.0, { noNav: true });
  registerLight(x, y + 0.7, z, 0xffd23f, 0.5, 4.5, { flicker: 0.15 });
  const p = {
    isPhoto: true, x, y, z, idx, where, group: g, photo, cross,
    // ⚠️ holdNeed 不能漏！updatePlayer 里的完成判定是 `interactHold >= interact.holdNeed`，
    //    漏掉就是 `x >= undefined` 恒为 false —— 表现就是"按 F 完全没反应"。
    done: false, range: 2.0, holdNeed: 1.0, viewT: 0, warned: false,
  };
  PHOTOS.push(p);
  return p;
}

/* ---------- 落锤行动：设施里散落的收容档案照片 ----------
   分布在三个分区，逼玩家把设施走一遍；仓库/军械库里放在木箱上。
   房间里的道具是随机摆放的，所以每个点都做几次带抖动的重试，
   否则偶尔会被一张桌子占掉位置导致照片少放一张。 */
function buildFacilityPhotos() {
  // ⚠️ 房间 id 必须和 06_facility.js 的 LAYOUT 对齐 —— 写错会被静默跳过，
  //    表现就是"照片少放了一张"（曾把 LCZ-OFFICE 写进去，而它早就改成手枪库了）。
  const spots = [
    { room: 'EZ-OFFICE', dx: -4.2, dz: 3.4, style: 'metal', where: '办公区 · 办公桌' },
    { room: 'EZ-SEC', dx: 3.6, dz: -3.2, style: 'metal', where: '安保站 · 监控台' },
    { room: 'LCZ-PISTOL', dx: -3.0, dz: 3.6, style: 'metal', where: '手枪库 · 值班台' },
    { room: 'LCZ-LAB', dx: 6.0, dz: -2.4, style: 'metal', where: '实验室 · 实验台' },
    { room: 'HCZ-ARMORY', dx: -2.6, dz: 4.6, style: 'crate', where: '重收武器库 · 缴获物箱' },
    { room: 'HCZ-STORE-A', dx: 2.2, dz: -3.6, style: 'crate', where: '仓库 A · 木箱' },
  ];
  const jitter = [[0, 0], [1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8],
    [3.0, 0], [-3.0, 0], [0, 3.0], [0, -3.0], [3.0, 3.0], [-3.0, -3.0]];
  spots.forEach((sp, i) => {
    const rm = FAC.roomAt[sp.room];
    if (!rm) { console.warn('[facility] 照片点位房间不存在: ' + sp.room); return; }
    for (const [jx, jz] of jitter) {
      const x = clamp(rm.cx + sp.dx + jx, rm.cx - rm.w / 2 + 2.0, rm.cx + rm.w / 2 - 2.0);
      const z = clamp(rm.cz + sp.dz + jz, rm.cz - rm.d / 2 + 2.0, rm.cz + rm.d / 2 - 2.0);
      if (!openAtWorld(x, z, 0)) continue;
      makePhoto(x, 0.86, z, rand(-0.6, 0.6), i, sp.where, sp.style);
      return;
    }
    console.warn('[facility] 照片放不下: ' + sp.where);
  });
}

/* ---------- 撤离直升机 ---------- */
function makeHelicopter(x, z, zone) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e3a44, roughness: 0.5, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a2026, roughness: 0.7, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a3040, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.0, 6.4), bodyMat); body.position.y = 2.0; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 1.8), bodyMat); nose.position.set(0, 1.9, -3.9); g.add(nose);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.2, 1.5), glassMat); canopy.position.set(0, 2.3, -4.2); g.add(canopy);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 3.4), bodyMat); tail.position.set(0, 2.3, 4.8); g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.4, 1.1), bodyMat); fin.position.set(0, 3.2, 6.4); g.add(fin);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 0.1), darkMat); tailRotor.position.set(0.25, 3.4, 6.7); g.add(tailRotor);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), darkMat); mast.position.set(0, 3.3, -0.4); g.add(mast);
  const rotor = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 10.5), darkMat);
    b.rotation.y = i * PI / 2;
    rotor.add(b);
  }
  rotor.position.set(0, 3.7, -0.4);
  g.add(rotor);
  // 起落橇
  for (const sx of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 5.2), darkMat);
    skid.position.set(sx * 1.3, 0.35, 0.2); g.add(skid);
    for (const sz of [-1.6, 1.4]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), darkMat);
      strut.position.set(sx * 1.3, 0.8, sz); g.add(strut);
    }
  }
  // 航行灯
  for (const [lx, ly, lz, col] of [[-1.6, 2.1, -1.2, 0xff3020], [1.6, 2.1, -1.2, 0x39ff8a], [0, 1.0, 2.6, 0xffffff]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: col }));
    lamp.position.set(lx, ly, lz); g.add(lamp);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  addBox(x, 2.0, z, 3.4, 2.4, 7.0, { noNav: true });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.9),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate('撤 离 点', 'MTF Nu-7 · EXFIL', false) }));
  sign.position.set(x, 5.6, z);
  scene.add(sign);
  registerLight(x, 4.5, z, 0x8fffc0, 1.4, 18, { flicker: 0 });
  return { x, z, zone, group: g, rotor, holdT: 0, holdNeed: 5.0, range: 5.0 };
}

/* 世界坐标 → 设施格 */
function worldToCell(x, z) {
  return [Math.round(x / CELL + GW / 2 - 0.5), Math.round(z / CELL + GH / 2 - 0.5)];
}
// 把建筑登记成"房间"，让平面图能画出轮廓与名称
function registerFarmRoom(id, name, cx, cz, w, d, kind) {
  const [c0, r0] = worldToCell(cx - w / 2, cz - d / 2);
  const [c1, r1] = worldToCell(cx + w / 2, cz + d / 2);
  FAC.rooms.push({ id, name, zone: 'EZ', kind: kind || 'office', c0, c1, r0, r1, cx, cz, w, d });
  FAC.roomAt[id] = FAC.rooms[FAC.rooms.length - 1];
}

/* ---------- 收容行动：场上只有 SCP-096 ---------- */
function spawnFarmSCPs() {
  GAME.saw096 = false;
  const s = spawnSCP('096', 0, -32);
  if (!s) return;
  s.awake = true;
  s.yaw = rand(0, TAU);
  s.state = 'docile';
  s.model.neck.rotation.x = 0.55;
  // 蹲坐在田野里：整体略微下沉 + 抱头姿态
  s.group.position.y = 0;
  s.farmIdle = true;
  s.model.armL && (s.model.armL.rotation.x = 1.9);
  s.model.armR && (s.model.armR.rotation.x = 1.9);
}

/* ---------- 通用：照片被注视太久会把 SCP-096「看」暴走 ----------
   两个行动共用（落锤行动的设施里也散落着拍到 096 面部的照片）。 */
function updatePhotos(dt) {
  if (!PHOTOS.length) return;
  const s = SCP_LIST.find(v => v.key === '096');
  // Project SCRAMBLE 同样能挡住"照片里的脸" —— 它拦的是视神经识别，不分是实物还是影像
  const scrambled = (typeof NVG !== 'undefined') && NVG.scrambleActive();
  for (const p of PHOTOS) {
    if (p.done) { p.viewT = 0; continue; }
    const looking = player.alive && playerLooksAt(p.x, p.y + 0.05, p.z, 26);
    const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    if (looking && d < 5.5) {
      p.viewT += dt;
      if (!p.warned && p.viewT > 1.6) {
        p.warned = true;
        if (scrambled) toast('SCRAMBLE：照片中的面部已打码 · 它认不出你', 2600, 'good');
        else toast('⚠ 不要再盯着照片看了 —— 长按 [F] 划掉它', 2600, 'warn');
      }
      // 戴着 SCRAMBLE 时，盯着看也不会触发暴走（viewT 照常累积，方便 HUD 提示）
      if (p.viewT > 3.2 && !scrambled && s && s.alive && !s.hooded && !s.enraged) {
        s.enraged = true;
        s.state = 'enraged';
        p.viewT = 0;
        broadcast('◤ 警告 · 照片中的 SCP-096 面部被观测 · 已暴走');
        subtitle('它看见了你在看它', 'SCP-096 已暴走 —— 立即回避', 3200);
        AudioSys.scpRoar('096', 0);
        addTrauma(0.8);
      }
    } else {
      p.viewT = Math.max(0, p.viewT - dt * 2.2);
      if (p.viewT < 0.5) p.warned = false;
    }
  }
}

/* ---------- 农场专属更新 ---------- */
function updateFarm(dt) {
  if (FAC.mode !== 'farm') return;
  // 直升机旋翼怠速（收容完成后加速，准备起飞）
  if (FAC.extract && FAC.extract.rotor) {
    FAC.extract.rotor.rotation.y += dt * (extractReady() ? 7 : 1.2);
  }
  // 玩家靠近 096 → 记录"已找到"
  const s = SCP_LIST.find(v => v.key === '096');
  if (s && s.alive && !GAME.saw096) {
    const d = Math.hypot(s.pos.x - player.pos.x, s.pos.z - player.pos.z);
    if (d < 22) {
      GAME.saw096 = true;
      subtitle('发现 SCP-096', '它蹲坐在田野里，双手抱头 —— 不要直视它的脸', 4200);
      broadcast('◤ 目标确认 · SCP-096 位于农场北侧牧场内');
    }
  }
}

bootMark('farm');
