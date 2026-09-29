'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  06 设施生成
   Site-19 地下设施：办公区(EZ) / 轻收容区(LCZ) / 重收容区(HCZ)。

   布局依照 SCP:RX 的三张官方分区平面图重画（2026-09-28）：
     · 轻收隔离区：SCP-173 / SCP-096 / SCP-966 收容间、实验室、手枪库、弹药库
     · 重收隔离区：SCP-682 / 106 / 939 / 076-2 / 3114 / 049 收容间、
                   电磁炮房、重收武器库、仓库 A/B、核弹控制室、重收电梯厅
     · 办公区    ：玻璃房、咖啡休息区、MTF 弹药库、办公区、设施总控室、
                   安保站、入口大堂（撤离电梯）

   生成方式：先用「开放矩形」标出房间与走廊，再自动把"紧邻开放格的实心格"
   识别为墙体。这样房间与走廊之间只要有没开门的格子，就会自动长出墙 ——
   门的位置完全由数据控制，不会出现漏墙/穿墙。
   ===================================================================== */

const CELL = 2.4;
const WALL_H = 3.6;
const GW = 60, GH = 72;                 // 网格宽高（格）→ 144m × 172.8m
const FAC = {
  W: GW, H: GH, CELL,
  open: null, zone: null,
  rooms: [], roomAt: {},
  doors: [], lights: [], props: [],
  breakers: [], terminal: null, extract: null, spawn: null, nuke: null, coffee: null,
};

const cellX = (c) => (c - GW / 2 + 0.5) * CELL;
const cellZ = (r) => (r - GH / 2 + 0.5) * CELL;
const inGrid = (c, r) => c >= 0 && r >= 0 && c < GW && r < GH;
const idxOf = (c, r) => r * GW + c;

// ---------- 房间/走廊定义 ----------
// rect: [c0, c1, r0, r1]（含端点）；doors: [[c,r], ...] —— 门一律开在「门行」上，
// 洞口沿 X 展开 2 格（4.8m），门板也沿 X 滑动。
const LAYOUT = {
  corridors: [
    { id: 'C_V', rect: [26, 30, 3, 70], name: '中央主廊' },
    { id: 'C_H1', rect: [3, 56, 15, 17], name: '重收容区横向走廊 · 上' },
    { id: 'C_H2', rect: [3, 56, 31, 33], name: '重收容区横向走廊 · 下' },
    { id: 'C_H3', rect: [3, 56, 47, 49], name: '轻收容区横向走廊' },
    { id: 'C_H4', rect: [3, 56, 63, 65], name: '办公区横向走廊' },
  ],
  rooms: [
    // ================= 重收容区 · 上排（rows 3..13，门行 14）=================
    { id: 'HCZ-682', zone: 'HCZ', rect: [3, 10, 3, 13], doors: [[6, 14]], name: 'SCP-682 收容间', kind: 'containment', big: true },
    { id: 'HCZ-106', zone: 'HCZ', rect: [12, 17, 3, 13], doors: [[14, 14]], name: 'SCP-106 收容间', kind: 'containment' },
    { id: 'HCZ-939', zone: 'HCZ', rect: [19, 24, 3, 13], doors: [[21, 14]], name: 'SCP-939 收容间', kind: 'containment' },
    { id: 'HCZ-076', zone: 'HCZ', rect: [32, 38, 3, 13], doors: [[35, 14]], name: 'SCP-076-2 收容间', kind: 'containment' },
    { id: 'HCZ-3114', zone: 'HCZ', rect: [40, 45, 3, 13], doors: [[42, 14]], name: 'SCP-3114 收容间', kind: 'containment' },
    { id: 'HCZ-ELECTRO', zone: 'HCZ', rect: [47, 56, 3, 13], doors: [[51, 14]], name: '电磁炮房', kind: 'utility' },
    // ================= 重收容区 · 下排（rows 19..29，门行 30）=================
    { id: 'HCZ-ARMORY', zone: 'HCZ', rect: [3, 10, 19, 29], doors: [[6, 30]], name: '重收武器库', kind: 'armory' },
    { id: 'HCZ-STORE-A', zone: 'HCZ', rect: [12, 17, 19, 29], doors: [[14, 30]], name: '仓库 A', kind: 'store' },
    { id: 'HCZ-STORE-B', zone: 'HCZ', rect: [19, 24, 19, 29], doors: [[21, 30]], name: '仓库 B', kind: 'store' },
    { id: 'HCZ-049', zone: 'HCZ', rect: [32, 38, 19, 29], doors: [[35, 30]], name: 'SCP-049 收容间', kind: 'containment' },
    { id: 'HCZ-NUKE', zone: 'HCZ', rect: [40, 45, 19, 29], doors: [[42, 30]], name: '核弹控制室', kind: 'nuke' },
    { id: 'HCZ-LIFT', zone: 'HCZ', rect: [47, 56, 19, 29], doors: [[51, 30]], name: '重收电梯厅', kind: 'lift' },
    // ================= 轻收容区（rows 35..45，门行 46）=================
    { id: 'LCZ-173', zone: 'LCZ', rect: [3, 9, 35, 45], doors: [[6, 46]], name: 'SCP-173 收容间', kind: 'containment' },
    { id: 'LCZ-AMMO', zone: 'LCZ', rect: [11, 15, 35, 45], doors: [[13, 46]], name: '弹药库', kind: 'vault' },
    { id: 'LCZ-LAB', zone: 'LCZ', rect: [17, 24, 35, 45], doors: [[20, 46]], name: '实验室', kind: 'lab', big: true },
    { id: 'LCZ-096', zone: 'LCZ', rect: [32, 37, 35, 45], doors: [[34, 46]], name: 'SCP-096 收容间', kind: 'containment' },
    { id: 'LCZ-966', zone: 'LCZ', rect: [39, 44, 35, 45], doors: [[41, 46]], name: 'SCP-966 收容间', kind: 'containment' },
    { id: 'LCZ-PISTOL', zone: 'LCZ', rect: [46, 56, 35, 45], doors: [[51, 46]], name: '手枪库', kind: 'vault' },
    // ================= 办公区 · 上排（rows 51..61，门行 62）=================
    { id: 'EZ-GLASS', zone: 'EZ', rect: [3, 9, 51, 61], doors: [[6, 62]], name: '玻璃房', kind: 'glass' },
    { id: 'EZ-COFFEE', zone: 'EZ', rect: [11, 16, 51, 61], doors: [[13, 62]], name: '咖啡休息区', kind: 'coffee' },
    { id: 'EZ-ARMORY', zone: 'EZ', rect: [18, 24, 51, 61], doors: [[21, 62]], name: 'MTF 弹药库', kind: 'armory' },
    { id: 'EZ-OFFICE', zone: 'EZ', rect: [32, 40, 51, 61], doors: [[36, 62]], name: '办公区', kind: 'office' },
    { id: 'EZ-PANEL', zone: 'EZ', rect: [42, 48, 51, 61], doors: [[45, 62]], name: '设施总控室', kind: 'panel' },
    { id: 'EZ-SEC', zone: 'EZ', rect: [50, 56, 51, 61], doors: [[53, 62]], name: '安保站', kind: 'sec' },
    // ================= 办公区 · 入口大堂（rows 67..70，门行 66）=================
    { id: 'EZ-LOBBY', zone: 'EZ', rect: [3, 56, 67, 70], doors: [[10, 66], [28, 66], [46, 66]], name: '入口大堂', kind: 'lobby' },
  ],
};

function zoneOfRow(r) {
  if (r <= 33) return 'HCZ';
  if (r <= 49) return 'LCZ';
  return 'EZ';
}

/* =====================================================================
   构建
   ===================================================================== */
function buildFacility() {
  FAC.mode = 'facility';
  FAC.open = new Uint8Array(GW * GH);
  FAC.zone = new Array(GW * GH).fill(null);
  applyEnvironment('facility');

  const carve = (c0, c1, r0, r1, zone) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (!inGrid(c, r)) continue;
      FAC.open[idxOf(c, r)] = 1;
      FAC.zone[idxOf(c, r)] = zone || zoneOfRow(r);
    }
  };

  // 走廊
  for (const co of LAYOUT.corridors) {
    const [c0, c1, r0, r1] = co.rect;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (!inGrid(c, r)) continue;
      FAC.open[idxOf(c, r)] = 1;
      FAC.zone[idxOf(c, r)] = zoneOfRow(r);
    }
  }
  // 房间
  for (const rm of LAYOUT.rooms) {
    const [c0, c1, r0, r1] = rm.rect;
    carve(c0, c1, r0, r1, rm.zone);
    const room = {
      id: rm.id, name: rm.name, zone: rm.zone, kind: rm.kind,
      c0, c1, r0, r1,
      cx: cellX((c0 + c1) / 2), cz: cellZ((r0 + r1) / 2),
      w: (c1 - c0 + 1) * CELL, d: (r1 - r0 + 1) * CELL,
      big: !!rm.big, doors: rm.doors || [],
    };
    FAC.rooms.push(room);
    FAC.roomAt[room.id] = room;
  }
  // 门格（同时开放，供通行）
  // 所有门都开在「门行」上：洞口沿 X 展开 2 格（4.8m），门板也沿 X 滑动。
  for (const rm of LAYOUT.rooms) {
    for (const [dc, dr] of (rm.doors || [])) {
      const cells = [[dc, dr], [dc + 1, dr]];
      for (const [c, r] of cells) {
        if (!inGrid(c, r)) continue;
        FAC.open[idxOf(c, r)] = 1;
        FAC.zone[idxOf(c, r)] = rm.zone;
      }
      FAC.doors.push({ c: dc, r: dr, room: rm, horizontal: true, cells });
    }
  }

  // 顺序很关键：先把所有几何与碰撞体建出来，再烘培导航网格与空间索引。
  buildOccupancyForProps();     // 先拿到"哪些格是空的"
  buildFacilityMeshes();        // 墙体 + 地板 + 天花板 + 立柱
  buildDoors();                 // 气密门
  buildProps();                 // 桌椅箱桶 + 尸体
  buildSpeakers();
  buildFacilityLights();        // 灯具 + 点光源
  buildKeyPoints();             // 断路器 / 终端 / 电梯 / 核弹开关 / 咖啡机 / 物资 / 出生点
  buildSetPieces();             // 电梯门 / 检查点 / 玻璃房 / 实验室与电磁炮房布景
  buildFacilityPhotos();        // 散落三个分区的收容档案照片（划照片任务）
  buildNavGrid();               // 依赖上面全部 addBox / addCyl
  buildSpatialIndex();
}

/* ---------------------------------------------------------------------
   墙体 / 地板 / 天花板（全部用 InstancedMesh，各 1 次 draw call）
   --------------------------------------------------------------------- */
const FAC_GROUPS = { walls: [], floors: [], ceilings: [], pillars: [] };

function makeInstanced(geo, mat, list, colorFn) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    m.makeTranslation(it.x, it.y, it.z);
    im.setMatrixAt(i, m);
    if (colorFn) { colorFn(col, it, i); im.setColorAt(i, col); }
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.frustumCulled = false;
  scene.add(im);
  return im;
}

function buildFacilityMeshes() {
  const isOpen = (c, r) => inGrid(c, r) && FAC.open[idxOf(c, r)] === 1;

  // ---- 收集墙格 ----
  const wallCells = [];
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    if (isOpen(c, r)) continue;
    if (isOpen(c - 1, r) || isOpen(c + 1, r) || isOpen(c, r - 1) || isOpen(c, r + 1)) {
      wallCells.push([c, r]);
    }
  }

  // ---- 地板 / 天花板 ----
  const floors = [], ceilings = [];
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    if (!isOpen(c, r)) continue;
    const z = FAC.zone[idxOf(c, r)];
    floors.push({ x: cellX(c), y: -0.12, z: cellZ(r), zone: z });
    ceilings.push({ x: cellX(c), y: WALL_H + 0.1, z: cellZ(r), zone: z });
  }

  const zoneTint = {
    HCZ: new THREE.Color(0x8a7f72),
    LCZ: new THREE.Color(0xa8a89c),
    EZ: new THREE.Color(0xb0b8c0),
  };

  // 墙体几何：CELL x WALL_H x CELL
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const wallMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.concrete, 1, 1), roughness: 0.96, metalness: 0.02 });
  const wallList = wallCells.map(([c, r]) => ({ x: cellX(c), y: WALL_H / 2, z: cellZ(r) }));
  // 外圈加高，形成"岩层"感
  makeInstanced(wallGeo, wallMat, wallList, (col, it) => {
    const v = rand(0.78, 1.0);
    col.setRGB(v * 0.62, v * 0.60, v * 0.56);
  });

  // 地板
  const floorGeo = new THREE.BoxGeometry(CELL, 0.24, CELL);
  const floorMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.concreteFloor, 1, 1), roughness: 0.98, metalness: 0.02 });
  makeInstanced(floorGeo, floorMat, floors, (col, it) => {
    const t = zoneTint[it.zone] || zoneTint.LCZ;
    const v = rand(0.62, 0.86);
    col.copy(t).multiplyScalar(v);
  });

  // 天花板
  const ceilMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.ceiling, 1, 1), roughness: 0.95, metalness: 0.05 });
  makeInstanced(floorGeo, ceilMat, ceilings, (col) => {
    const v = rand(0.5, 0.7);
    col.setRGB(v, v, v * 1.03);
  });

  // ---- 墙裙（踢脚线，视觉细节）----
  // 在每面墙格的底部加一圈金属裙板，用同一个 InstancedMesh
  const skirtGeo = new THREE.BoxGeometry(CELL * 1.002, 0.5, CELL * 1.002);
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.7, metalness: 0.45 });
  makeInstanced(skirtGeo, skirtMat, wallCells.map(([c, r]) => ({ x: cellX(c), y: 0.25, z: cellZ(r) })));

  // ---- 碰撞体（沿行合并连续墙格，减少盒体数量）----
  const used = new Uint8Array(GW * GH);
  for (const [c, r] of wallCells) used[idxOf(c, r)] = 1;
  for (let r = 0; r < GH; r++) {
    let c = 0;
    while (c < GW) {
      if (!used[idxOf(c, r)]) { c++; continue; }
      let c1 = c;
      while (c1 + 1 < GW && used[idxOf(c1 + 1, r)]) c1++;
      const w = (c1 - c + 1) * CELL;
      addBox(cellX((c + c1) / 2), WALL_H / 2, cellZ(r), w, WALL_H, CELL, { wall: true });
      c = c1 + 1;
    }
  }

  // ---- 主廊立柱（掩体）----
  const pillarGeo = new THREE.BoxGeometry(CELL * 0.9, WALL_H, CELL * 0.9);
  const pillarMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.metalWall, 1, 1), roughness: 0.8, metalness: 0.3 });
  const pillars = [];
  for (let r = 5; r <= 56; r += 6) {
    for (const c of [25, 27]) {
      if (!isOpen(c, r)) continue;
      pillars.push({ x: cellX(c), y: WALL_H / 2, z: cellZ(r) });
    }
  }
  makeInstanced(pillarGeo, pillarMat, pillars, (col) => { const v = rand(0.5, 0.72); col.setRGB(v, v, v * 1.05); });
  for (const p of pillars) addBox(p.x, WALL_H / 2, p.z, CELL * 0.9, WALL_H, CELL * 0.9, { noNav: false });
}

function cloneTex(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

/* ---------------------------------------------------------------------
   门（滑动式气密门）
   注意：材质必须惰性创建 —— 贴图由 boot() 里的 buildTextures() 生成，
   而本文件在加载时就会执行到顶层语句，此时 TEX 还是空的。
   --------------------------------------------------------------------- */
let DOOR_MAT = null, DOOR_EDGE_MAT = null;
function doorMaterials() {
  if (!DOOR_MAT) {
    DOOR_MAT = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.metalWall, 1, 1), color: 0x9aa4ad, roughness: 0.55, metalness: 0.7 });
    DOOR_EDGE_MAT = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.5, emissive: 0x3a2c05 });
  }
  return { DOOR_MAT, DOOR_EDGE_MAT };
}

const DOOR_W = CELL * 2;          // 门洞宽度（2 格 = 4.8m），沿 X 展开
function buildDoors() {
  doorMaterials();
  for (let di = 0; di < FAC.doors.length; di++) {
    const d = FAC.doors[di];
    const x = cellX(d.c + 0.5), z = cellZ(d.r);     // 洞口中心在 2 格之间
    const g = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.6, metalness: 0.6 });
    // 门框：顶梁 + 两侧立柱
    const top = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.3, 0.28, 0.32), frameMat);
    top.position.set(0, WALL_H - 0.14, 0); g.add(top);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, WALL_H, 0.32), frameMat);
      post.position.set(sx * (DOOR_W / 2 + 0.08), WALL_H / 2, 0); g.add(post);
    }
    // 两扇门板（沿 X 对开滑动）
    const panelW = (DOOR_W / 2) * 0.985;
    const leafA = new THREE.Mesh(new THREE.BoxGeometry(panelW, WALL_H - 0.28, 0.20), DOOR_MAT);
    const leafB = leafA.clone();
    leafA.position.set(-panelW / 2, (WALL_H - 0.28) / 2, 0);
    leafB.position.set(panelW / 2, (WALL_H - 0.28) / 2, 0);
    // 门中缝黄条
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, WALL_H - 0.5, 0.24), DOOR_EDGE_MAT);
    stripe.position.set(0, (WALL_H - 0.28) / 2, 0);
    g.add(leafA); g.add(leafB); g.add(stripe);
    g.position.set(x, 0, z);
    scene.add(g);

    // 碰撞体（可开关）
    const col = addBox(x, (WALL_H - 0.28) / 2, z, DOOR_W, WALL_H - 0.28, 0.24, { noNav: false });
    col.noNav = true;   // 门不计入导航阻挡（AI 能通过开着的门）

    const door = Object.assign({}, d, {
      x, z, group: g, leafA, leafB, col, open: false, t: 0, slide: panelW, panelW,
    });
    FAC.doors[di] = door;
  }
}
/* 门口有没有"任何会走路的东西" —— 玩家 / SCP / 队友 / 049-2 小怪都算。
   ⚠️ 旧版只查了玩家和 SCP，队友与 049-2 不在名单里，
      它们撞上关闭的气密门就会被门碰撞体顶住，永远过不去。 */
function anyActorNear(x, z, r2) {
  if (typeof player !== 'undefined' && player.alive) {
    const dx = player.pos.x - x, dz = player.pos.z - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  if (typeof SCP_LIST !== 'undefined') {
    for (let i = 0; i < SCP_LIST.length; i++) {
      const s = SCP_LIST[i];
      if (!s.alive) continue;
      const dx = s.pos.x - x, dz = s.pos.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  if (typeof ALLY_LIST !== 'undefined') {
    for (let i = 0; i < ALLY_LIST.length; i++) {
      const a = ALLY_LIST[i];
      if (!a.alive) continue;
      const dx = a.pos.x - x, dz = a.pos.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  if (typeof MINIONS !== 'undefined') {
    for (let i = 0; i < MINIONS.length; i++) {
      const m = MINIONS[i];
      if (!m.alive) continue;
      const dx = m.pos.x - x, dz = m.pos.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  return false;
}

function updateDoors(dt) {
  for (const d of FAC.doors) {
    if (!d.leafA) continue;
    // 触发源：玩家 / SCP / 队友 / 小怪 —— 任何走到门口的生物都会把门打开
    const near = d.forced || anyActorNear(d.x, d.z, 25);
    const want = near && !d.locked;
    if (want !== d.open) { d.open = want; if (want) AudioSys.door(true); }
    const tgt = d.open ? 1 : 0;
    if (Math.abs(d.t - tgt) > 0.001) {
      d.t = dampF(d.t, tgt, 7, dt);
      const s = d.t * d.slide;
      d.leafA.position.x = -d.panelW / 2 - s;
      d.leafB.position.x = d.panelW / 2 + s;
      d.col.noClip = d.t > 0.3;
    }
  }
}

/* ---------------------------------------------------------------------
   灯光
   --------------------------------------------------------------------- */
function buildFacilityLights() {
  const lampGeo = new THREE.BoxGeometry(CELL * 0.72, 0.1, CELL * 0.42);
  const onMat = new THREE.MeshBasicMaterial({ color: 0xdff0ff });
  const emergMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  const deadMat = new THREE.MeshBasicMaterial({ color: 0x2a2e30 });
  const listOn = [], listEmerg = [], listDead = [];

  const place = (x, z, zone, forceDead) => {
    const dead = forceDead || Math.random() < (zone === 'HCZ' ? 0.30 : zone === 'LCZ' ? 0.20 : 0.10);
    const emerg = !dead && Math.random() < (zone === 'HCZ' ? 0.26 : 0.08);
    const y = WALL_H - 0.12;
    const item = { x, y, z };
    if (dead) listDead.push(item);
    else if (emerg) { listEmerg.push(item); }
    else listOn.push(item);
    const inten = emerg ? 1.35 : 1.85;
    const dist = emerg ? 10 : 15;
    const col = emerg ? 0xff4a3a : 0xcfe4ff;
    registerLight(x, y - 0.25, z, col, dead ? 0 : inten, dist, {
      flicker: dead ? 0 : (Math.random() < 0.14 ? 0.75 : (Math.random() < 0.2 ? 0.25 : 0)),
      on: !dead,
    });
    FAC.lights.push({ x, y, z, dead, emerg });
  };

  // 走廊：每 2 格一盏
  for (const co of LAYOUT.corridors) {
    const [c0, c1, r0, r1] = co.rect;
    if (co.id === 'C_V') {
      for (let r = r0 + 1; r <= r1 - 1; r += 3) place(cellX((c0 + c1) / 2), cellZ(r), zoneOfRow(r));
    } else {
      for (let c = c0 + 1; c <= c1 - 1; c += 3) place(cellX(c), cellZ((r0 + r1) / 2), zoneOfRow(r0));
    }
  }
  // 房间：按大小铺灯
  for (const rm of FAC.rooms) {
    const nc = Math.max(1, Math.round(rm.w / 7)), nr = Math.max(1, Math.round(rm.d / 7));
    for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) {
      const x = rm.cx + (nc === 1 ? 0 : (i / (nc - 1) - 0.5) * (rm.w - 3));
      const z = rm.cz + (nr === 1 ? 0 : (j / (nr - 1) - 0.5) * (rm.d - 3));
      place(x, z, rm.zone, rm.kind === 'containment' && Math.random() < 0.35);
    }
  }
  makeInstanced(lampGeo, onMat, listOn);
  makeInstanced(lampGeo, emergMat, listEmerg);
  makeInstanced(lampGeo, deadMat, listDead);
}

/* ---------------------------------------------------------------------
   关键点位：断路器 / 终端 / 撤离点 / 出生点 / 物资
   --------------------------------------------------------------------- */
function buildKeyPoints() {
  // 三个断路器：分别藏在三个分区的功能间里
  const brkRooms = [
    { id: 'A', zone: 'EZ', room: 'EZ-SEC', dx: -3.5, dz: 3.0, label: '配电箱 A' },
    { id: 'B', zone: 'LCZ', room: 'LCZ-LAB', dx: 3.5, dz: 4.0, label: '配电箱 B' },
    { id: 'C', zone: 'HCZ', room: 'HCZ-ELECTRO', dx: -4.0, dz: 3.5, label: '配电箱 C' },
  ];
  for (const b of brkRooms) {
    const rm = FAC.roomAt[b.room];
    if (!rm) continue;
    FAC.breakers.push(makeBreaker(b.id, b.label, rm.cx + b.dx, rm.cz + b.dz, b.zone));
  }
  // 设施总控台（收容协议上传点）—— 办公区的设施总控室
  const panel = FAC.roomAt['EZ-PANEL'];
  FAC.terminal = makeTerminal(panel.cx, panel.cz - 2.5, 'EZ');
  // 撤离电梯 —— 入口大堂西端
  const lobby = FAC.roomAt['EZ-LOBBY'];
  FAC.extract = makeElevator(cellX(lobby.c0 + 4), lobby.cz, 'EZ');
  // 出生点：入口大堂东侧，面朝西（正对地表电梯与通往设施深处的门）
  FAC.spawn = { x: cellX(lobby.c1 - 6), z: lobby.cz + 1.2, yaw: HPI };
  // 核弹开关（重收容区 · 核弹控制室）—— 可选的 EMP 冲击
  const nuke = FAC.roomAt['HCZ-NUKE'];
  FAC.nuke = makeNukeSwitch(nuke.cx, nuke.cz + 3, 'HCZ');
  // 咖啡机（办公区 · 咖啡休息区）
  const coffee = FAC.roomAt['EZ-COFFEE'];
  FAC.coffee = makeCoffeeMachine(coffee.cx - 2.2, coffee.cz + 4.5, 'EZ');
  // 物资
  scatterPickups();
}

/* ---------------------------------------------------------------------
   布景：电梯门 / 检查点 / 玻璃房 / 各功能间的标志物
   --------------------------------------------------------------------- */
function buildSetPieces() {
  const spineW = cellX(26) - CELL / 2;    // 主廊西壁 x
  const spineE = cellX(30) + CELL / 2;    // 主廊东壁 x

  // ---- 电梯门（贴在主廊两侧墙上，串起三个分区）----
  makeLiftDoor(spineW + 0.25, cellZ(20), -HPI, '重收电梯');
  makeLiftDoor(spineE - 0.25, cellZ(26), HPI, '蓝冰电梯');
  makeLiftDoor(spineE - 0.25, cellZ(40), HPI, '核弹电梯');
  makeLiftDoor(spineW + 0.25, cellZ(44), -HPI, '轻收电梯');
  makeLiftDoor(spineE - 0.25, cellZ(57), HPI, '地表电梯');

  // ---- 检查点闸门（分区交界处横跨主廊）----
  makeCheckpoint(0, cellZ(33.5), 0, '重收容区检查点', 6);
  makeCheckpoint(0, cellZ(49.5), 0, '轻收容区检查点', 6);
  makeCheckpoint(0, cellZ(65.5), 0, '办公区检查点', 6);
  makeCheckpoint(cellX(20), cellZ(14), 0, '重收单门检查点', 3);
  makeCheckpoint(cellX(46), cellZ(30), 0, '重收双电网检查点', 3);

  // ---- 玻璃房（办公区 · 观察室）----
  const glass = FAC.roomAt['EZ-GLASS'];
  makeGlassBox(glass.cx, glass.cz + 2.0, 9.0, 8.0, 2.9);

  // ---- 功能间标志物 ----
  const lab = FAC.roomAt['LCZ-LAB'];
  if (lab) {
    // 实验室：中央实验台 + 隔离舱
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a8f93, metalness: 0.5, roughness: 0.4 });
    for (let i = -1; i <= 1; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.9, 1.4), benchMat);
      b.position.set(lab.cx, 0.45, lab.cz - 6 + i * 3.2);
      scene.add(b);
      addBox(lab.cx, 0.45, lab.cz - 6 + i * 3.2, 6.0, 0.9, 1.4);
    }
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x7fd8c0, transparent: true, opacity: 0.22, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.4, 14, 1, true), tankMat);
      t.position.set(lab.cx - 6 + i * 4, 1.2, lab.cz + 7);
      scene.add(t);
      registerLight(lab.cx - 6 + i * 4, 2.0, lab.cz + 7, 0x7fd8c0, 0.5, 4, { flicker: 0.2 });
    }
  }
  const armory = FAC.roomAt['EZ-ARMORY'];
  if (armory) {
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x4a5158, metalness: 0.6, roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.9, 5.0), rackMat);
      r.position.set(armory.cx - 5 + i * 5, 0.95, armory.cz + 3);
      scene.add(r);
      addBox(armory.cx - 5 + i * 5, 0.95, armory.cz + 3, 0.6, 1.9, 5.0);
    }
  }
  const electro = FAC.roomAt['HCZ-ELECTRO'];
  if (electro) {
    // 电磁炮：两根导轨 + 电容组
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.85, roughness: 0.25 });
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 12), railMat);
      rail.position.set(electro.cx + sx * 1.2, 2.1, electro.cz);
      scene.add(rail);
    }
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.6, roughness: 0.5, emissive: 0x061a2a });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 12), capMat);
      c.position.set(electro.cx - 6 + i * 2.4, 1.1, electro.cz + 6);
      scene.add(c);
      addCyl(electro.cx - 6 + i * 2.4, electro.cz + 6, 0.55, 0, 2.2);
    }
    registerLight(electro.cx, 3.0, electro.cz, 0x6ac8ff, 1.2, 12, { flicker: 0.3 });
  }
}

/* ---------- 布景：玻璃观察室 ---------- */
function makeGlassBox(x, z, w, d, h) {
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xa8e0f0, transparent: true, opacity: 0.16, roughness: 0.04,
    metalness: 0.05, side: THREE.DoubleSide, depthWrite: false,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a444c, metalness: 0.7, roughness: 0.35 });
  const g = new THREE.Group();
  // 四面玻璃
  for (const [px, pz, rot] of [[0, -d / 2, 0], [0, d / 2, 0], [-w / 2, 0, HPI], [w / 2, 0, HPI]]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(rot ? d : w, h), glassMat);
    pane.position.set(px, h / 2, pz);
    pane.rotation.y = rot;
    g.add(pane);
  }
  // 框架：四角立柱 + 顶圈 + 底圈
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.14), frameMat);
    post.position.set(sx * w / 2, h / 2, sz * d / 2); g.add(post);
  }
  for (const y of [0.06, h - 0.06]) {
    const beamX = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.12, 0.14), frameMat);
    beamX.position.set(0, y, -d / 2); g.add(beamX);
    const beamX2 = beamX.clone(); beamX2.position.z = d / 2; g.add(beamX2);
    const beamZ = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, d + 0.14), frameMat);
    beamZ.position.set(-w / 2, y, 0); g.add(beamZ);
    const beamZ2 = beamZ.clone(); beamZ2.position.x = w / 2; g.add(beamZ2);
  }
  // 顶灯
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.1, d * 0.3), new THREE.MeshBasicMaterial({ color: 0xdff0ff }));
  lamp.position.set(0, h - 0.16, 0); g.add(lamp);
  g.position.set(x, 0, z);
  scene.add(g);
  // 玻璃墙做碰撞（可以走进去，但不穿墙）
  for (const [px, pz, ww, dd] of [[0, -d / 2, w, 0.12], [0, d / 2, w, 0.12], [-w / 2, 0, 0.12, d], [w / 2, 0, 0.12, d]]) {
    addBox(x + px, h / 2, z + pz, ww, h, dd, { noNav: true, glass: true });
  }
  registerLight(x, h - 0.4, z, 0xdff0ff, 1.1, 10, { flicker: 0 });
  return g;
}

/* ---------- 交互物：核弹开关（EMP 冲击） ---------- */
function makeNukeSwitch(x, z, zone) {
  const g = new THREE.Group();
  const ped = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.05, 0.9), INTERACT_MAT);
  ped.position.y = 0.52; g.add(ped);
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x1b2025, metalness: 0.6, roughness: 0.35 }));
  console_.position.y = 1.06; console_.rotation.x = -0.35; g.add(console_);
  // 两个大红按钮
  for (const sx of [-0.35, 0.35]) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.1, 12),
      new THREE.MeshStandardMaterial({ color: 0xc02020, emissive: 0x4a0a06, roughness: 0.4 }));
    btn.position.set(sx, 1.14, 0.1); btn.rotation.x = -0.35; g.add(btn);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate('核弹开关', 'NUCLEAR DEVICE · EMP PULSE', true) }));
  sign.position.set(0, 2.4, 0.5); g.add(sign);
  g.position.set(x, 0, z);
  scene.add(g);
  addBox(x, 0.6, z, 1.7, 1.2, 1.0, { noNav: true });
  registerLight(x, 2.2, z + 0.6, 0xff3020, 0.8, 6, { flicker: 0.35 });
  return { x, z, zone, group: g, done: false, holdT: 0, holdNeed: 3.0, range: 2.8 };
}

/* ---------- 交互物：咖啡机（恢复体力） ---------- */
function makeCoffeeMachine(x, z, zone) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.85, 0.6), INTERACT_MAT);
  body.position.y = 0.92; g.add(body);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x201814, roughness: 0.35, emissive: 0x1a0d05 }));
  face.position.set(0, 1.25, 0.32); g.add(face);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.7, roughness: 0.35 }));
  tray.position.set(0, 0.95, 0.34); g.add(tray);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.26),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate('咖啡机', 'COFFEE · FREE FOR STAFF', false) }));
  sign.position.set(0, 2.15, 0.3); g.add(sign);
  g.position.set(x, 0, z);
  scene.add(g);
  addBox(x, 0.9, z, 0.95, 1.9, 0.65, { noNav: true });
  registerLight(x, 1.9, z + 0.5, 0xffb060, 0.5, 4, { flicker: 0.15 });
  return { x, z, zone, group: g, done: false, holdT: 0, holdNeed: 1.8, range: 2.2 };
}

/* ---------- 装饰物：电梯门 ---------- */
function makeLiftDoor(x, z, ry, label) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x353b41, metalness: 0.7, roughness: 0.4 });
  const doorMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.metalWall, 1, 1), color: 0x9aa4ad, roughness: 0.5, metalness: 0.75 });
  const w = CELL * 2.6, h = 3.0;
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.35), frameMat);
  back.position.y = h / 2; g.add(back);
  for (const sx of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - 0.08, h - 0.4, 0.12), doorMat);
    leaf.position.set(sx * (w / 4), (h - 0.4) / 2 + 0.1, 0.22); g.add(leaf);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x39ff8a }));
  lamp.position.set(0, h + 0.25, 0.25); g.add(lamp);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 0.5),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate(label || '电梯', 'ELEVATOR', false) }));
  sign.position.set(0, h + 0.85, 0.25); g.add(sign);
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  scene.add(g);
  registerLight(x, h + 0.5, z + 0.4, 0x4fff8a, 0.6, 6, { flicker: 0 });
  return g;
}

/* ---------- 装饰物：检查点闸门 ---------- */
function makeCheckpoint(x, z, ry, label, halfW) {
  const g = new THREE.Group();
  const hw = halfW || 2.2;
  const mat = new THREE.MeshStandardMaterial({ color: 0x3c434a, metalness: 0.6, roughness: 0.5 });
  const h = 2.6;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), mat);
    post.position.set(sx * hw, h / 2, 0); g.add(post);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.4, 0.4, 0.4), mat);
  top.position.set(0, h, 0); g.add(top);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.4, hw), 0.16, 0.2), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  lamp.position.set(0, h - 0.28, 0.1); g.add(lamp);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.6, hw * 1.6), 0.5),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate(label || '检查点', 'CHECKPOINT', false) }));
  sign.position.set(0, h + 0.5, 0.24); g.add(sign);
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  scene.add(g);
  const cs = Math.cos(ry || 0), sn = Math.sin(ry || 0);
  for (const sx of [-1, 1]) addBox(x + cs * sx * hw, h / 2, z - sn * sx * hw, 0.45, h, 0.45, { noNav: true });
  registerLight(x, h - 0.3, z + 0.5, 0xffd23f, 0.55, 6, { flicker: 0.1 });
  return g;
}

/* ---------- 交互物：断路器 ---------- */
const INTERACT_MAT = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.7, metalness: 0.5 });
function makeBreaker(id, label, x, z, zone) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.42), INTERACT_MAT);
  box.position.y = 1.3; g.add(box);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1a2024, roughness: 0.4, metalness: 0.3, emissive: 0x220000 }));
  panel.position.set(0, 1.3, 0.24); g.add(panel);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.14),
    new THREE.MeshStandardMaterial({ color: 0xd8442f, emissive: 0x5a1208, roughness: 0.4 }));
  lever.position.set(0, 1.15, 0.32); g.add(lever);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  led.position.set(0.3, 1.72, 0.26); g.add(led);
  // 标牌
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.3),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate('PWR-' + id, 'BREAKER ' + id, true) }));
  sign.position.set(0, 2.35, 0.24); g.add(sign);
  g.position.set(x, 0, z);
  scene.add(g);
  addBox(x, 0.9, z, 1.2, 1.8, 0.55, { noNav: true });
  registerLight(x, 2.3, z + 0.4, 0xff5533, 0.55, 4.5, { flicker: 0.5 });
  return {
    id, label, zone, x, z, group: g, lever, led,
    done: false, holdT: 0, holdNeed: 2.6, range: 2.4,
    key: 'breaker_' + id,
  };
}

/* ---------- 交互物：终端 ---------- */
function makeTerminal(x, z, zone) {
  const g = new THREE.Group();
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 1.1), INTERACT_MAT);
  desk.position.y = 0.5; g.add(desk);
  const scrMat = new THREE.MeshBasicMaterial({ map: TEX.screen('SITE-19\nPROTOCOL\nSTANDBY\n\n[ POWER OFF ]', '#ff9a3a') });
  for (let i = -1; i <= 1; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.54), scrMat);
    s.position.set(i * 0.82, 1.32, 0.1);
    s.rotation.x = -0.32;
    g.add(s);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.1), new THREE.MeshStandardMaterial({ color: 0x1b2025, metalness: 0.6, roughness: 0.4 }));
  base.position.y = 1.0; g.add(base);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate('ALPHA 控制台', 'CONTAINMENT PROTOCOL', false) }));
  sign.position.set(0, 2.5, 0.6); g.add(sign);
  g.position.set(x, 0, z);
  scene.add(g);
  addBox(x, 0.6, z, 2.7, 1.2, 1.2, { noNav: true });
  registerLight(x, 1.6, z + 1.0, 0xffa040, 0.7, 5, { flicker: 0.2 });
  return { x, z, zone, group: g, done: false, holdT: 0, holdNeed: 3.4, range: 2.8 };
}

/* ---------- 交互物：撤离电梯 ---------- */
function makeElevator(x, z, zone) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x353b41, metalness: 0.7, roughness: 0.4 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(6.0, 3.5, 0.4), frameMat);
  back.position.set(0, 1.75, -1.5); g.add(back);
  for (const sx of [-3, 3]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.5, 3.2), frameMat);
    side.position.set(sx, 1.75, 0); g.add(side);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.4, 3.4), frameMat);
  top.position.set(0, 3.5, 0); g.add(top);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.1),
    new THREE.MeshBasicMaterial({ color: 0x1a5a2a, transparent: true, opacity: 0.35 }));
  glow.position.set(0, 1.75, -1.28); g.add(glow);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9),
    new THREE.MeshBasicMaterial({ map: TEX.signPlate('撤 离 电 梯', 'EVACUATION LIFT · LEVEL 1', false) }));
  sign.position.set(0, 4.0, 0); g.add(sign);
  g.position.set(x, 0, z);
  scene.add(g);
  registerLight(x, 3.0, z, 0x4fff8a, 1.0, 9, { flicker: 0 });
  registerLight(x - 2.5, 2.0, z - 1.0, 0x4fff8a, 0.5, 5, {});
  return { x, z, zone, group: g, holdT: 0, holdNeed: 5.0, range: 3.2, glow };
}

/* ---------- 物资散布 ---------- */
const PICK_POOLS = {
  armory: ['ammo_rifle', 'ammo_rifle', 'ammo_smg', 'ammo_smg', 'armor_plate', 'armor_plate', 'bandage'],
  vault: ['ammo_rifle', 'ammo_rifle', 'ammo_smg', 'armor_plate', 'bandage', 'medkit'],
  store: ['ammo_rifle', 'ammo_smg', 'armor_plate', 'bandage', 'bandage', 'battery'],
  lab: ['battery', 'battery', 'medkit', 'medkit', 'bandage'],
  coffee: ['medkit', 'medkit', 'bandage', 'bandage'],
  med: ['medkit', 'medkit', 'bandage', 'bandage', 'armor_plate'],
  default: ['ammo_rifle', 'ammo_rifle', 'ammo_smg', 'ammo_smg', 'medkit', 'bandage', 'bandage', 'armor_plate', 'battery'],
};
function scatterPickups() {
  const spots = [];
  for (const rm of FAC.rooms) {
    if (rm.kind === 'containment') continue;
    const n = rm.kind === 'armory' ? 6 : rm.kind === 'vault' ? 4
      : rm.kind === 'store' ? 5 : rm.kind === 'lobby' ? 4 : randi(1, 3);
    for (let i = 0; i < n; i++) {
      spots.push({
        x: rm.cx + rand(-rm.w / 2 + 1.6, rm.w / 2 - 1.6),
        z: rm.cz + rand(-rm.d / 2 + 1.6, rm.d / 2 - 1.6),
        kind: rm.kind,
      });
    }
  }
  // 走廊里也撒一些
  for (const co of LAYOUT.corridors) {
    const [c0, c1, r0, r1] = co.rect;
    for (let i = 0; i < 6; i++) {
      spots.push({ x: cellX(rand(c0, c1)), z: cellZ(rand(r0, r1)), kind: 'default' });
    }
  }
  for (const s of spots) {
    if (!openAtWorld(s.x, s.z, 1)) continue;
    if (Math.hypot(s.x - FAC.spawn.x, s.z - FAC.spawn.z) < 5) continue;
    const pool = PICK_POOLS[s.kind] || PICK_POOLS.default;
    spawnPickup(pick(pool), s.x, s.z);
  }
}

/* ---------------------------------------------------------------------
   辅助：把开放格标记进占用图（给 props 用，避免摆到墙里）
   --------------------------------------------------------------------- */
let OCC_PROPS = null;
function buildOccupancyForProps() {
  OCC_PROPS = new Uint8Array(GW * GH);
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) OCC_PROPS[idxOf(c, r)] = FAC.open[idxOf(c, r)];
}
function isCellOpen(c, r) { return inGrid(c, r) && OCC_PROPS[idxOf(c, r)] === 1; }
// 世界坐标 → 该点是否落在开放区域内（留 0.5 格边距，避免贴墙摆放）
function openAtWorld(x, z, margin) {
  const c = Math.round(x / CELL + GW / 2 - 0.5);
  const r = Math.round(z / CELL + GH / 2 - 0.5);
  const m = margin == null ? 1 : margin;
  for (let dr = -m; dr <= m; dr++) for (let dc = -m; dc <= m; dc++) {
    if (!isCellOpen(c + dc, r + dr)) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------
   设施道具：桌子、柜子、箱子、管道、尸体、血迹、标识
   --------------------------------------------------------------------- */
function buildProps() {
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.85, metalness: 0.02 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x5a6167, roughness: 0.6, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.8, metalness: 0.2 });
  const crateMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.metalWall, 1, 1), color: 0x8a7a58, roughness: 0.85, metalness: 0.2 });
  const pipeMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.pipe, 1, 4), color: 0x9aa2a8, roughness: 0.5, metalness: 0.7 });

  const propList = { desk: [], cabinet: [], crate: [], barrel: [], pipe: [] };

  for (const rm of FAC.rooms) {
    const kinds = rm.kind;
    if (kinds === 'containment') continue;
    if (kinds === 'glass') { // 玻璃房：只放两张椅子，保持通透
      for (let i = 0; i < 2; i++) {
        const x = rm.cx + rand(-5, 5), z = rm.cz - 8 + i * 2.5;
        if (openAtWorld(x, z, 0)) propList.desk.push({ x, y: 0, z, ry: rand(0, TAU) });
      }
      continue;
    }
    const n = kinds === 'lobby' ? Math.round(rm.w * rm.d / 90)
      : kinds === 'lift' ? 3
        : Math.max(2, Math.round(rm.w * rm.d / 46));
    for (let i = 0; i < n; i++) {
      const x = rm.cx + rand(-rm.w / 2 + 1.4, rm.w / 2 - 1.4);
      const z = rm.cz + rand(-rm.d / 2 + 1.4, rm.d / 2 - 1.4);
      if (!openAtWorld(x, z, 0)) continue;
      const roll = Math.random();
      if (kinds === 'office' || kinds === 'command' || kinds === 'sec' || kinds === 'lab'
        || kinds === 'panel' || kinds === 'nuke' || kinds === 'coffee') {
        if (roll < 0.42) propList.desk.push({ x, y: 0, z, ry: rand(0, TAU) });
        else if (roll < 0.72) propList.cabinet.push({ x, y: 0, z, ry: rand(0, TAU) });
        else propList.crate.push({ x, y: 0, z, ry: rand(0, TAU) });
      } else if (kinds === 'armory' || kinds === 'vault' || kinds === 'store') {
        if (roll < 0.35) propList.cabinet.push({ x, y: 0, z, ry: rand(0, TAU) });
        else propList.crate.push({ x, y: 0, z, ry: rand(0, TAU) });
      } else if (kinds === 'utility' || kinds === 'waste') {
        if (roll < 0.5) propList.barrel.push({ x, y: 0, z });
        else propList.crate.push({ x, y: 0, z, ry: rand(0, TAU) });
      } else {
        if (roll < 0.45) propList.crate.push({ x, y: 0, z, ry: rand(0, TAU) });
        else if (roll < 0.75) propList.barrel.push({ x, y: 0, z });
        else propList.cabinet.push({ x, y: 0, z, ry: rand(0, TAU) });
      }
    }
    // 实验室 / 医疗站的尸袋
    if (kinds === 'lab' || kinds === 'med') {
      for (let i = 0; i < 2; i++) {
        const x = rm.cx + rand(-rm.w / 3, rm.w / 3), z = rm.cz + rand(-rm.d / 3, rm.d / 3);
        if (openAtWorld(x, z, 0)) spawnCorpse(x, z);
      }
    }
  }
  // 走廊杂物
  for (const co of LAYOUT.corridors) {
    const [c0, c1, r0, r1] = co.rect;
    for (let i = 0; i < 8; i++) {
      const x = cellX(rand(c0, c1)), z = cellZ(rand(r0, r1));
      if (!openAtWorld(x, z, 0)) continue;
      if (Math.random() < 0.5) propList.crate.push({ x, y: 0, z, ry: rand(0, TAU) });
      else propList.barrel.push({ x, y: 0, z });
    }
  }

  // 实例化
  const deskGeo = new THREE.BoxGeometry(1.5, 0.78, 0.8);
  makeInstanced(deskGeo, woodMat, propList.desk, (col) => { const v = rand(0.7, 1.0); col.setRGB(v, v * 0.95, v * 0.88); });
  for (const d of propList.desk) addBox(d.x, 0.39, d.z, 1.5, 0.78, 0.8);

  const cabGeo = new THREE.BoxGeometry(0.85, 1.85, 0.6);
  makeInstanced(cabGeo, metalMat, propList.cabinet, (col) => { const v = rand(0.6, 0.9); col.setRGB(v * 0.95, v, v * 1.05); });
  for (const d of propList.cabinet) addBox(d.x, 0.92, d.z, 0.85, 1.85, 0.6);

  const crateGeo = new THREE.BoxGeometry(1.1, 1.0, 1.1);
  makeInstanced(crateGeo, crateMat, propList.crate, (col) => { const v = rand(0.65, 1.0); col.setRGB(v, v * 0.92, v * 0.7); });
  for (const d of propList.crate) addBox(d.x, 0.5, d.z, 1.1, 1.0, 1.1);

  const barrelGeo = new THREE.CylinderGeometry(0.36, 0.36, 1.0, 12);
  makeInstanced(barrelGeo, darkMat, propList.barrel, (col) => { const v = rand(0.7, 1.15); col.setRGB(v * 0.8, v * 0.85, v * 0.6); });
  for (const d of propList.barrel) addCyl(d.x, d.z, 0.38, 0, 1.0);

  // 天花板管道（沿主廊）
  const pipeGeo = new THREE.CylinderGeometry(0.16, 0.16, CELL * 8, 8);
  const pipeList = [];
  for (let r = 6; r < 56; r += 8) {
    pipeList.push({ x: cellX(24.3), y: WALL_H - 0.5, z: cellZ(r), ry: HPI });
  }
  for (const p of pipeList) {
    const m = new THREE.Mesh(pipeGeo, pipeMat);
    m.position.set(p.x, p.y, p.z); m.rotation.z = HPI;
    scene.add(m);
  }
}

/* ---------- 尸体（可被 049 复活 / 供 3114 伪装） ---------- */
function spawnCorpse(x, z) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 1.25), bodyMat);
  torso.position.y = 0.18; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), bodyMat);
  head.position.set(0, 0.24, -0.72); g.add(head);
  for (const sx of [-0.36, 0.36]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7), bodyMat);
    arm.position.set(sx, 0.12, -0.1); g.add(arm);
  }
  for (const sx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.85), bodyMat);
    leg.position.set(sx, 0.1, 0.75); g.add(leg);
  }
  g.position.set(x, 0.06, z);
  g.rotation.y = rand(0, TAU);
  scene.add(g);
  // 血泊
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(rand(1.6, 2.6), rand(1.6, 2.6)),
    new THREE.MeshBasicMaterial({ map: TEX.blood, transparent: true, opacity: 0.85, depthWrite: false }));
  pool.rotation.x = -HPI; pool.rotation.z = rand(0, TAU);
  pool.position.set(x, 0.012, z);
  scene.add(pool);
  const corpse = { x, z, group: g, alive: false, revived: false };
  CORPSES.push(corpse);
  return corpse;
}
const CORPSES = [];

/* ---------- 拾取物 ---------- */
const PICKUPS = [];
function spawnPickup(type, x, z) {
  const def = PICKUP_TYPES[type];
  if (!def) return null;
  const g = new THREE.Group();
  let mesh;
  if (def.kind === 'ammo') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.4, emissive: new THREE.Color(def.color).multiplyScalar(0.14) }));
  } else if (def.kind === 'heal') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.22),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, emissive: new THREE.Color(def.color).multiplyScalar(0.18) }));
  } else if (def.kind === 'battery') {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 8),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.4, emissive: 0x0a4a30 }));
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.14),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.5, emissive: 0x14202a }));
  }
  mesh.position.y = 0.3;
  g.add(mesh);
  // 微光标记
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6),
    new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.09 }));
  halo.position.y = 0.3; g.add(halo);
  g.position.set(x, 0, z);
  scene.add(g);
  const p = { type, def, x, z, group: g, mesh, taken: false, bob: Math.random() * TAU };
  PICKUPS.push(p);
  return p;
}
function updatePickups(dt) {
  for (const p of PICKUPS) {
    if (p.taken) continue;
    p.group.rotation.y += dt * 0.9;
    p.group.position.y = Math.sin(nowT * 2 + p.bob) * 0.06;
  }
}

/* ---------- 中央广播扬声器 ---------- */
function buildSpeakers() {
  const g = new THREE.BoxGeometry(0.34, 0.34, 0.18);
  const m = new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.5, roughness: 0.5 });
  const list = [];
  for (const co of LAYOUT.corridors) {
    const [c0, c1, r0, r1] = co.rect;
    if (co.id === 'C_V') for (let r = 8; r < 56; r += 12) list.push({ x: cellX(24) - CELL / 2, y: 3.1, z: cellZ(r) });
    else for (let c = 8; c < 48; c += 14) list.push({ x: cellX(c), y: 3.1, z: cellZ(r0) - CELL / 2 });
  }
  makeInstanced(g, m, list);
}

bootMark('facility');
