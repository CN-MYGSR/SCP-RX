'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  05 碰撞与寻路
   AABB 盒体 + 圆柱体碰撞、射线检测、空间网格加速、导航网格 + A*。
   设施全部由轴对齐方块构成，因此 AABB 是最合适的方案。
   ===================================================================== */

const BOXES = [];       // {minX,minY,minZ,maxX,maxY,maxZ, noNav, noHit}
const CYLS = [];        // {x,z,r,y0,y1}
const RAMPS = [];       // 斜坡行走面
const WORLD_LIMIT = 200;

function addBox(cx, cy, cz, w, h, d, opt) {
  const b = {
    minX: cx - w / 2, minY: cy - h / 2, minZ: cz - d / 2,
    maxX: cx + w / 2, maxY: cy + h / 2, maxZ: cz + d / 2,
  };
  if (opt) Object.assign(b, opt);
  BOXES.push(b);
  return b;
}
function addCyl(x, z, r, y0, y1) {
  const c = { x, z, r, y0, y1 };
  CYLS.push(c);
  return c;
}
function addRamp(x, z, ry, w, len, y0, y1) {
  RAMPS.push({ x, z, ry, w, len, y0, y1, sn: Math.sin(ry), cs: Math.cos(ry) });
}

// ---------- 射线 ----------
function rayBox(o, dir, b, maxD) {
  let tmin = 0, tmax = maxD, axis = -1, sign = 0;
  const oo = [o.x, o.y, o.z], dd = [dir.x, dir.y, dir.z];
  const mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) {
      if (oo[i] < mn[i] || oo[i] > mx[i]) return null;
    } else {
      const inv = 1 / dd[i];
      let t1 = (mn[i] - oo[i]) * inv, t2 = (mx[i] - oo[i]) * inv, s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmin <= 0.0001) return null;
  const n = [0, 0, 0]; n[axis] = sign;
  return { t: tmin, nx: n[0], ny: n[1], nz: n[2] };
}
function rayCyl(o, dir, c, maxD) {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-9) return null;
  const b2 = 2 * (ox * dir.x + oz * dir.z);
  const cc = ox * ox + oz * oz - c.r * c.r;
  const disc = b2 * b2 - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b2 - Math.sqrt(disc)) / (2 * a);
  if (t < 0.0001 || t > maxD) return null;
  const y = o.y + dir.y * t;
  if (y < c.y0 || y > c.y1) return null;
  const px = o.x + dir.x * t, pz = o.z + dir.z * t;
  return { t, nx: (px - c.x) / c.r, ny: 0, nz: (pz - c.z) / c.r };
}

// ---------- 空间网格 ----------
const RGRID = { cell: 8, N: 0, off: 0, boxCells: null, cylCells: null, stampB: null, stampC: null, gen: 0 };
function buildSpatialIndex() {
  const span = WORLD_LIMIT * 2;
  RGRID.N = Math.ceil(span / RGRID.cell);
  RGRID.off = WORLD_LIMIT;
  const { cell, N, off } = RGRID;
  RGRID.boxCells = Array.from({ length: N * N }, () => []);
  RGRID.cylCells = Array.from({ length: N * N }, () => []);
  BOXES.forEach((b, bi) => {
    const i0 = clamp(Math.floor((b.minX + off) / cell), 0, N - 1), i1 = clamp(Math.floor((b.maxX + off) / cell), 0, N - 1);
    const j0 = clamp(Math.floor((b.minZ + off) / cell), 0, N - 1), j1 = clamp(Math.floor((b.maxZ + off) / cell), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) RGRID.boxCells[j * N + i].push(bi);
  });
  CYLS.forEach((c, ci) => {
    const i0 = clamp(Math.floor((c.x - c.r + off) / cell), 0, N - 1), i1 = clamp(Math.floor((c.x + c.r + off) / cell), 0, N - 1);
    const j0 = clamp(Math.floor((c.z - c.r + off) / cell), 0, N - 1), j1 = clamp(Math.floor((c.z + c.r + off) / cell), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) RGRID.cylCells[j * N + i].push(ci);
  });
  RGRID.stampB = new Int32Array(BOXES.length + 64);
  RGRID.stampC = new Int32Array(CYLS.length + 64);
}

const _rcP = V3(), _rcN = V3();
function raycastWorld(o, dir, maxD, hitFlags) {
  let best = maxD, bn = null, kind = null, hitBox = null;
  const wantFloor = !hitFlags || hitFlags.floor !== false;
  if (RGRID.boxCells) {
    const { cell, N, off, boxCells, cylCells, stampB, stampC } = RGRID;
    const gen = ++RGRID.gen;
    let ci = Math.floor((o.x + off) / cell), cj = Math.floor((o.z + off) / cell);
    const dx = dir.x, dz = dir.z;
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDX = Math.abs(dx) < 1e-9 ? Infinity : cell / Math.abs(dx);
    const tDZ = Math.abs(dz) < 1e-9 ? Infinity : cell / Math.abs(dz);
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : (dx > 0 ? ((ci + 1) * cell - off - o.x) : (o.x - (ci * cell - off))) / Math.abs(dx);
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : (dz > 0 ? ((cj + 1) * cell - off - o.z) : (o.z - (cj * cell - off))) / Math.abs(dz);
    let t = 0, guard = 0;
    while (t <= best && guard++ < 80) {
      if (ci >= 0 && cj >= 0 && ci < N && cj < N) {
        const idx = cj * N + ci;
        const bl = boxCells[idx];
        for (let k = 0; k < bl.length; k++) {
          const bi = bl[k];
          if (stampB[bi] === gen) continue; stampB[bi] = gen;
          const b = BOXES[bi];
          if (b.noHit) continue;
          const r = rayBox(o, dir, b, best);
          if (r) { best = r.t; bn = r; kind = 'box'; hitBox = b; }
        }
        const cl = cylCells[idx];
        for (let k = 0; k < cl.length; k++) {
          const c2 = cl[k];
          if (stampC[c2] === gen) continue; stampC[c2] = gen;
          const r = rayCyl(o, dir, CYLS[c2], best);
          if (r) { best = r.t; bn = r; kind = 'cyl'; hitBox = null; }
        }
      } else if (ci < -1 || cj < -1 || ci > N || cj > N) break;
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDX; ci += stepI; }
      else { t = tMaxZ; tMaxZ += tDZ; cj += stepJ; }
    }
  } else {
    for (const b of BOXES) { if (b.noHit) continue; const r = rayBox(o, dir, b, best); if (r) { best = r.t; bn = r; kind = 'box'; hitBox = b; } }
    for (const c of CYLS) { const r = rayCyl(o, dir, c, best); if (r) { best = r.t; bn = r; kind = 'cyl'; hitBox = null; } }
  }
  // 地面
  if (wantFloor && dir.y < -0.02) {
    const gh = floorAt(o.x, o.z, o.y);
    if (o.y > gh) {
      const tf = (o.y - gh) / (-dir.y);
      if (tf < best && tf > 0) { best = tf; bn = { nx: 0, ny: 1, nz: 0 }; kind = 'floor'; hitBox = null; }
    }
  }
  if (!bn) return null;
  _rcP.set(o.x + dir.x * best, o.y + dir.y * best, o.z + dir.z * best);
  _rcN.set(bn.nx, bn.ny, bn.nz);
  return { dist: best, point: _rcP, normal: _rcN, kind, box: hitBox };
}

// ---------- 行走面高度 ----------
function rampHeightAt(x, z, curY) {
  let best = -1e9;
  for (let i = 0; i < RAMPS.length; i++) {
    const r = RAMPS[i];
    const dx = x - r.x, dz = z - r.z;
    const lx = dx * r.cs - dz * r.sn;
    const lz = dx * r.sn + dz * r.cs;
    if (Math.abs(lx) > r.w / 2 + 0.1 || lz < -r.len / 2 - 0.2 || lz > r.len / 2 + 0.2) continue;
    const t = clamp((lz + r.len / 2) / r.len, 0, 1);
    const hy = r.y0 + (r.y1 - r.y0) * t;
    if (hy <= curY + 0.62 && hy > best) best = hy;
  }
  return best;
}
// 地面基准（设施地板固定 y=0，另加平台）
const GROUND_Y = 0;
function floorAt(x, z, curY) {
  let h = GROUND_Y;
  const rh = RAMPS.length ? rampHeightAt(x, z, curY == null ? 99 : curY) : -1e9;
  if (rh > h) h = rh;
  const cy = curY == null ? 99 : curY;
  if (RGRID.boxCells) {
    const { cell, N, off } = RGRID;
    const ci = clamp(Math.floor((x + off) / cell), 0, N - 1), cj = clamp(Math.floor((z + off) / cell), 0, N - 1);
    const list = RGRID.boxCells[cj * N + ci];
    for (let k = 0; k < list.length; k++) {
      const b = BOXES[list[k]];
      if (b.noFloor) continue;
      if (x > b.minX - 0.04 && x < b.maxX + 0.04 && z > b.minZ - 0.04 && z < b.maxZ + 0.04) {
        if (b.maxY <= cy + 0.62 && b.maxY > h) h = b.maxY;
      }
    }
    return h;
  }
  for (const b of BOXES) {
    if (b.noFloor) continue;
    if (x > b.minX - 0.04 && x < b.maxX + 0.04 && z > b.minZ - 0.04 && z < b.maxZ + 0.04) {
      if (b.maxY <= cy + 0.62 && b.maxY > h) h = b.maxY;
    }
  }
  return h;
}

// ---------- 实体水平碰撞 ----------
function collideMove(pos, radius, bodyH, stepH) {
  const top = pos.y + (bodyH || 1.75);
  const bot = pos.y + 0.22;
  const maxStep = stepH == null ? 0.56 : stepH;
  const { cell, N, off } = RGRID;
  if (!RGRID.boxCells) return;
  const ci = clamp(Math.floor((pos.x + off) / cell), 0, N - 1), cj = clamp(Math.floor((pos.z + off) / cell), 0, N - 1);
  const g = ++RGRID.gen;
  const stamp = RGRID.stampB, stampC = RGRID.stampC;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ni = ci + di, nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
    const list = RGRID.boxCells[nj * N + ni];
    for (let k = 0; k < list.length; k++) {
      const bi = list[k];
      if (stamp[bi] === g) continue; stamp[bi] = g;
      const b = BOXES[bi];
      if (b.noClip) continue;
      if (top < b.minY || bot > b.maxY) continue;
      if (b.maxY - pos.y <= maxStep) continue;   // 可跨过的矮台
      const cx = clamp(pos.x, b.minX, b.maxX), cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 < 1e-8) {
          const l = Math.min(pos.x - b.minX, b.maxX - pos.x);
          const r = Math.min(pos.z - b.minZ, b.maxZ - pos.z);
          if (l < r) pos.x = (pos.x - b.minX < b.maxX - pos.x) ? b.minX - radius : b.maxX + radius;
          else pos.z = (pos.z - b.minZ < b.maxZ - pos.z) ? b.minZ - radius : b.maxZ + radius;
        } else {
          const d = Math.sqrt(d2), push = (radius - d) / d;
          pos.x += dx * push; pos.z += dz * push;
        }
      }
    }
    const listC = RGRID.cylCells[nj * N + ni];
    for (let k = 0; k < listC.length; k++) {
      const idx = listC[k];
      if (stampC[idx] === g) continue; stampC[idx] = g;
      const c = CYLS[idx];
      if (top < c.y0 || bot > c.y1) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const rr = c.r + radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (rr - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      }
    }
  }
  pos.x = clamp(pos.x, -WORLD_LIMIT, WORLD_LIMIT);
  pos.z = clamp(pos.z, -WORLD_LIMIT, WORLD_LIMIT);
}

// 视线是否被遮挡
const _losDir = V3();
const _losOrigin = V3();
function hasLOS(ax, ay, az, bx, by, bz) {
  _losDir.set(bx - ax, by - ay, bz - az);
  const d = _losDir.length();
  if (d < 0.001) return true;
  _losDir.multiplyScalar(1 / d);
  _losOrigin.set(ax, ay, az);
  const hit = raycastWorld(_losOrigin, _losDir, d - 0.05);
  return !hit;
}

/* ---------------------------------------------------------------------
   导航网格
   ⚠️ 两次修正（2026-09-28）：
   ① 旧版只把「碰撞体所在格」标为阻挡，于是设施外的实心岩层全是"可走"
      （71289 格里 66377 格可走），A* 会绕到设施外面穿墙。
   ② 随机摆放的箱子/柜子会把门洞和走廊堵死 —— 实测 19 个房间只有 1 个可达。
   现在：默认全阻挡 → 设施开放格开放 → 叠加道具 → 强制开通门洞 →
   **最后做一次连通性修复**，把被道具堵死的必经之路重新开通（但绝不动墙体）。
   --------------------------------------------------------------------- */
const NAV = { res: 1.5, N: 0, off: 0, grid: null, hard: null, ready: false };
// 户外地图的建筑门洞：{x0,z0,x1,z1}，导航网格会在这些矩形里强制开通
const NAV_OPENINGS = [];

function buildNavGrid() {
  const span = WORLD_LIMIT * 2;
  NAV.N = Math.ceil(span / NAV.res);
  NAV.off = WORLD_LIMIT;
  const { res, N, off } = NAV;
  const grid = new Uint8Array(N * N).fill(1);   // 最终网格：0 可走 / 1 阻挡
  const hard = new Uint8Array(N * N).fill(1);   // 结构阻挡（岩层/墙）：永不开通

  // ① 设施里被挖空的格子 → 可走
  for (let r = 0; r < GH; r++) {
    for (let c = 0; c < GW; c++) {
      if (FAC.open[idxOf(c, r)] !== 1) continue;
      const x0 = cellX(c) - CELL / 2, x1 = cellX(c) + CELL / 2;
      const z0 = cellZ(r) - CELL / 2, z1 = cellZ(r) + CELL / 2;
      const i0 = clamp(Math.floor((x0 + off) / res), 0, N - 1), i1 = clamp(Math.floor((x1 + off) / res), 0, N - 1);
      const j0 = clamp(Math.floor((z0 + off) / res), 0, N - 1), j1 = clamp(Math.floor((z1 + off) / res), 0, N - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { grid[j * N + i] = 0; hard[j * N + i] = 0; }
    }
  }

  // ①b 硬阻挡：标记为 wall 的碰撞体（户外地图的建筑外墙 / 栅栏 / 大型结构）
  //     设施地图里这些格子本来就不是开放格，所以这一步对它是空操作。
  for (const b of BOXES) {
    if (!b.wall) continue;
    if (b.maxY < 0.6 || b.minY > 1.9) continue;
    const i0 = clamp(Math.floor((b.minX + off) / res), 0, N - 1), i1 = clamp(Math.ceil((b.maxX + off) / res), 0, N - 1);
    const j0 = clamp(Math.floor((b.minZ + off) / res), 0, N - 1), j1 = clamp(Math.ceil((b.maxZ + off) / res), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { grid[j * N + i] = 1; hard[j * N + i] = 1; }
  }

  // ② 道具/立柱一律不写进导航网格。
  //    原因：道具位置是随机的，把它们的包围盒写进去会把门洞堵死，
  //    而且每次开局堵的地方都不一样（实测连通性在 7/19 ~ 19/19 之间乱跳）。
  //    碰撞系统本来就会挡住实体，AI 撞到箱子会被 collideMove 平滑滑开，
  //    完全没必要为箱子绕路。这样导航网格 = 设施的结构连通性，稳定且一定连通。

  // ③ 门洞强制开通：以门格为中心，向外各扩 0.8m，保证一定有一条完整通路
  for (const d of FAC.doors) {
    if (!d.cells) continue;
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const [c, r] of d.cells) {
      mnx = Math.min(mnx, cellX(c) - CELL / 2); mxx = Math.max(mxx, cellX(c) + CELL / 2);
      mnz = Math.min(mnz, cellZ(r) - CELL / 2); mxz = Math.max(mxz, cellZ(r) + CELL / 2);
    }
    const ex = 0.8;
    const i0 = clamp(Math.floor((mnx - ex + off) / res), 0, N - 1), i1 = clamp(Math.ceil((mxx + ex + off) / res), 0, N - 1);
    const j0 = clamp(Math.floor((mnz - ex + off) / res), 0, N - 1), j1 = clamp(Math.ceil((mxz + ex + off) / res), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // 只开通"结构上本来就是空的"格子，绝不凿穿墙体
      if (hard[j * N + i] === 0) grid[j * N + i] = 0;
    }
  }

  // ③b 显式门洞（户外地图的建筑门口）。
  //     ⚠️ 户外建筑的门洞是直接在墙上留缺口做的，缺口只有 2~3m，
  //        而导航格是 1.5m，floor/ceil 取整会把整条门洞吃掉 ——
  //        实测农舍内部直接变成不可达。所以这里显式登记门洞并强制开通。
  for (const op of NAV_OPENINGS) {
    const i0 = clamp(Math.floor((op.x0 + off) / res), 0, N - 1), i1 = clamp(Math.ceil((op.x1 + off) / res), 0, N - 1);
    const j0 = clamp(Math.floor((op.z0 + off) / res), 0, N - 1), j1 = clamp(Math.ceil((op.z1 + off) / res), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { grid[j * N + i] = 0; hard[j * N + i] = 0; }
  }

  NAV.grid = grid;
  NAV.hard = hard;
  NAV.repairLog = navRepairConnectivity(grid, hard);
  NAV.ready = true;
}

/* 连通性修复：把「结构上连通、但被道具堵死」的必经之路重新开通。
   绝不触碰 hard（岩层/墙体），所以不会让 AI 穿墙。 */
function navRepairConnectivity(grid, hard) {
  const N = NAV.N, off = NAV.off, res = NAV.res;
  const start = navIdx(FAC.spawn.x, FAC.spawn.z);
  grid[start] = 0; hard[start] = 0;

  // (a) 结构连通集：只看 hard，得到一张「理论上能走通」的父指针树
  const par = new Int32Array(N * N).fill(-1);
  const seenH = new Uint8Array(N * N);
  const q = new Int32Array(N * N);
  let qh = 0, qt = 0;
  q[qt++] = start; seenH[start] = 1;
  while (qh < qt) {
    const cur = q[qh++], cx = cur % N, cy = (cur - cx) / N;
    for (let d = 0; d < 8; d++) {
      const nx = cx + _DX8[d], ny = cy + _DY8[d];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (seenH[ni] || hard[ni]) continue;
      if (d >= 4 && (hard[cy * N + nx] || hard[ny * N + cx])) continue;
      seenH[ni] = 1; par[ni] = cur; q[qt++] = ni;
    }
  }

  // (b) 当前（含道具）可达集
  const seenS = new Uint8Array(N * N);
  qh = qt = 0;
  q[qt++] = start; seenS[start] = 1;
  while (qh < qt) {
    const cur = q[qh++], cx = cur % N, cy = (cur - cx) / N;
    for (let d = 0; d < 8; d++) {
      const nx = cx + _DX8[d], ny = cy + _DY8[d];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (seenS[ni] || grid[ni] === 1) continue;
      if (d >= 4 && (grid[cy * N + nx] === 1 || grid[ny * N + cx] === 1)) continue;
      seenS[ni] = 1; q[qt++] = ni;
    }
  }

  // (c) 目标清单：所有房间中心 + 关键交互点 + SCP 收容间
  const targets = [];
  for (const rm of FAC.rooms) targets.push([rm.cx, rm.cz, rm.id]);
  if (FAC.terminal) targets.push([FAC.terminal.x, FAC.terminal.z, 'terminal']);
  if (FAC.extract) targets.push([FAC.extract.x, FAC.extract.z, 'extract']);
  for (const b of FAC.breakers) targets.push([b.x, b.z, 'brk' + b.id]);
  for (const key of SCP_ORDER) {
    const rid = Object.keys(CONTAINMENT_ROOMS).find(k => CONTAINMENT_ROOMS[k] === key);
    const rm = FAC.roomAt[rid];
    if (rm) targets.push([rm.cx, rm.cz, 'scp' + key]);
  }

  const log = [];
  let cleared = 0;
  for (const [tx, tz, id] of targets) {
    let ci = navIdx(tx, tz);
    if (!seenH[ci]) { log.push(id + ':结构不可达'); continue; }   // 理论都走不到，跳过
    if (grid[ci] === 0 && seenS[ci]) continue;                    // 已经通
    // 沿结构路径从目标回溯，一路清除软阻挡，直到接入已有可达区
    let cur = ci, guard = 0;
    while (cur !== -1 && guard++ < 30000) {
      if (grid[cur] === 1) { grid[cur] = 0; cleared++; }
      if (seenS[cur]) break;
      cur = par[cur];
    }
    // 清完之后，把这条新开的走廊并入可达集（增量洪泛，避免下一轮重复）
    if (cur !== -1) {
      const stack = [ci];
      while (stack.length) {
        const cc = stack.pop();
        if (seenS[cc]) continue;
        seenS[cc] = 1;
        const cx2 = cc % N, cy2 = (cc - cx2) / N;
        for (let d = 0; d < 8; d++) {
          const nx = cx2 + _DX8[d], ny = cy2 + _DY8[d];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const ni = ny * N + nx;
          if (seenS[ni] || grid[ni] === 1) continue;
          stack.push(ni);
        }
      }
    }
    log.push(id + ':已开通');
  }
  // 收尾：出生点周围再清一圈，保证玩家/队友不会卡在家门口
  const r0 = 3;
  const sc = navIdx(FAC.spawn.x, FAC.spawn.z), scx = sc % N, scy = (sc - scx) / N;
  for (let dj = -r0; dj <= r0; dj++) for (let di = -r0; di <= r0; di++) {
    const i = scx + di, j = scy + dj;
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const ni = j * N + i;
    if (!hard[ni] && grid[ni] === 1) { grid[ni] = 0; cleared++; }
  }
  return { cleared, log: log };
}
function navIdx(x, z) {
  const i = clamp(Math.round((x + NAV.off) / NAV.res), 0, NAV.N - 1);
  const j = clamp(Math.round((z + NAV.off) / NAV.res), 0, NAV.N - 1);
  return j * NAV.N + i;
}
function navBlocked(x, z) {
  if (!NAV.ready) return false;
  return NAV.grid[navIdx(x, z)] === 1;
}
// 找最近的可行走格（写入 out，避免每次分配对象）
function navNearest(x, z, maxR, out) {
  const o = out || { x: 0, z: 0 };
  if (!NAV.ready) return null;
  if (!navBlocked(x, z)) { o.x = x; o.z = z; return o; }
  const R = maxR || 8;
  for (let r = 1; r <= R; r++) {
    for (let a = 0; a < 12; a++) {
      const th = a / 12 * TAU;
      const nx = x + Math.cos(th) * r * NAV.res, nz = z + Math.sin(th) * r * NAV.res;
      if (!navBlocked(nx, nz)) { o.x = nx; o.z = nz; return o; }
    }
  }
  return null;
}
const _navSrc = { x: 0, z: 0 }, _navDst = { x: 0, z: 0 };

/* ---------------------------------------------------------------------
   A* 寻路
   ⚠️ 性能要点（2026-09-28 剖析后重写）：
   旧版每次调用都 `new Float32Array(N*N).fill(1e9)` + `new Int32Array(N*N).fill(-1)`，
   在 267×267 的网格上是 424 KB/次。9 只 SCP + 3 名队友每秒调用约 17 次
   → 约 7 MB/s 垃圾 → 周期性 major GC → 肉眼可见的卡顿。
   现在改为：所有大数组只分配一次，用「代数戳（generation stamp）」代替 fill()，
   二叉堆节点也用对象池，路径写进调用方自带的缓冲区。
   --------------------------------------------------------------------- */
let NAV_VISIT = new Int32Array(0);   // 出堆标记（按代数）
let NAV_GSCORE = new Float32Array(0); // g 值
let NAV_GEN = new Int32Array(0);      // g 值写入时的代数
let NAV_FROM = new Int32Array(0);     // 父节点
let NAV_PATHI = new Int32Array(0);    // 回溯临时栈
let navVisitGen = 0;

function navEnsureBuffers() {
  const n = NAV.N * NAV.N;
  if (NAV_VISIT.length === n) return;
  NAV_VISIT = new Int32Array(n);
  NAV_GSCORE = new Float32Array(n);
  NAV_GEN = new Int32Array(n);
  NAV_FROM = new Int32Array(n);
  NAV_PATHI = new Int32Array(n);
  navVisitGen = 0;
}

// 二叉堆：用两条定长 TypedArray，零分配、零别名
// ⚠️ 曾经用对象数组 + 复用节点，结果 heapPop 把末尾节点搬到根后没清空原槽位，
//    下一次 heapPush 写进同一个对象 → 堆被写坏 → 搜索十几个节点就提前结束。
const HEAP_CAP = 1 << 16;
const _heapIdx = new Int32Array(HEAP_CAP);
const _heapF = new Float32Array(HEAP_CAP);
let _heapN = 0;
function heapPush(i, f) {
  if (_heapN >= HEAP_CAP) return;
  let n = _heapN++;
  _heapIdx[n] = i; _heapF[n] = f;
  while (n > 0) {
    const p = (n - 1) >> 1;
    if (_heapF[p] <= _heapF[n]) break;
    const ti = _heapIdx[p]; _heapIdx[p] = _heapIdx[n]; _heapIdx[n] = ti;
    const tf = _heapF[p]; _heapF[p] = _heapF[n]; _heapF[n] = tf;
    n = p;
  }
}
function heapPopI() {
  const topI = _heapIdx[0];
  const n = --_heapN;
  if (n > 0) {
    _heapIdx[0] = _heapIdx[n]; _heapF[0] = _heapF[n];
    let i = 0;
    for (; ;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < n && _heapF[l] < _heapF[m]) m = l;
      if (r < n && _heapF[r] < _heapF[m]) m = r;
      if (m === i) break;
      const ti = _heapIdx[m]; _heapIdx[m] = _heapIdx[i]; _heapIdx[i] = ti;
      const tf = _heapF[m]; _heapF[m] = _heapF[i]; _heapF[i] = tf;
      i = m;
    }
  }
  return topI;
}

// 每帧/每实体的路径缓冲：{pts:[{x,z}], n:0}
function makePathBuf() { return { pts: [], n: 0 }; }

// 路径平滑用：能否从 (ax,az) 直连到 (bx,bz)
function navClear(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / (NAV.res * 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (navBlocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

/**
 * A* 寻路（无分配）
 * @param buf  调用方自带的路径缓冲，见 makePathBuf()
 * @returns 是否找到路径；结果写在 buf 里（buf.n = 路点数量，0 表示失败）
 */
function navPath(sx, sz, tx, tz, buf, maxNodes) {
  const DBG = navPath.dbg;
  DBG.calls++;
  if (!NAV.ready) { buf.n = 0; DBG.noNav++; return false; }
  const s = navNearest(sx, sz, 6, _navSrc);
  if (!s) { buf.n = 0; DBG.noSrc++; return false; }
  const t = navNearest(tx, tz, 10, _navDst);
  if (!t) { buf.n = 0; DBG.noDst++; return false; }
  DBG.snappedSrc += (Math.abs(s.x - sx) > 0.01 || Math.abs(s.z - sz) > 0.01) ? 1 : 0;
  DBG.snappedDst += (Math.abs(t.x - tx) > 0.01 || Math.abs(t.z - tz) > 0.01) ? 1 : 0;
  const N = NAV.N, res = NAV.res, off = NAV.off, grid = NAV.grid;
  const si = clamp(Math.round((s.x + off) / res), 0, N - 1), sj = clamp(Math.round((s.z + off) / res), 0, N - 1);
  const ti = clamp(Math.round((t.x + off) / res), 0, N - 1), tj = clamp(Math.round((t.z + off) / res), 0, N - 1);
  const sIdx = sj * N + si, tIdx = tj * N + ti;
  if (sIdx === tIdx) {
    writeWp(buf, 0, t.x, t.z);
    buf.n = 1;
    DBG.sameCell++;
    return true;
  }
  DBG.attempted++;
  navEnsureBuffers();
  const gen = ++navVisitGen;
  const VISIT = NAV_VISIT, G = NAV_GSCORE, GEN = NAV_GEN, FROM = NAV_FROM, PATHI = NAV_PATHI;

  _heapN = 0;
  G[sIdx] = 0; GEN[sIdx] = gen; FROM[sIdx] = -1;
  heapPush(sIdx, Math.hypot(si - ti, sj - tj));

  let expanded = 0;
  const limit = maxNodes || 16000;
  let found = false;
  let bestIdx = sIdx, bestH = Math.hypot(si - ti, sj - tj);
  while (_heapN > 0 && expanded < limit) {
    const ci = heapPopI();
    if (VISIT[ci] === gen) continue;
    VISIT[ci] = gen;
    expanded++;
    if (ci === tIdx) { found = true; break; }
    const cx = ci % N, cy = (ci - cx) / N;
    for (let d = 0; d < 8; d++) {
      const dx = _DX8[d], dy = _DY8[d];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (grid[ni] === 1) continue;
      if (d >= 4 && (grid[cy * N + nx] === 1 || grid[ny * N + cx] === 1)) continue;  // 不允许穿角
      if (VISIT[ni] === gen) continue;
      const ng = G[ci] + (d >= 4 ? 1.414 : 1);
      if (GEN[ni] === gen && G[ni] <= ng) continue;
      G[ni] = ng; GEN[ni] = gen; FROM[ni] = ci;
      const h = Math.hypot(nx - ti, ny - tj);
      if (h < bestH) { bestH = h; bestIdx = ni; }
      heapPush(ni, ng + h);
    }
  }
  // 没搜到就退而求其次：走向"离目标最近的那个已探索节点"，
  // 保证 AI 至少能朝正确方向绕，而不是原地卡死。
  const endIdx = found ? tIdx : bestIdx;
  if (!found && endIdx === sIdx) { buf.n = 0; DBG.fail++; DBG.lastExpanded = expanded; return false; }
  DBG.sumExpanded += expanded; DBG.maxExpanded = Math.max(DBG.maxExpanded, expanded);
  if (found) DBG.ok++; else DBG.partial++;

  // 回溯
  let cnt = 0, cur = endIdx, guard = 0;
  while (cur !== -1 && cur !== sIdx && guard++ < 4096) {
    PATHI[cnt++] = cur;
    cur = FROM[cur];
  }
  // 反转 → 正序路点
  let n = 0;
  for (let i = cnt - 1; i >= 0; i--) {
    const idx = PATHI[i];
    const cx = idx % N, cy = (idx - cx) / N;
    writeWp(buf, n++, cx * res - off, cy * res - off);
  }
  // 视线平滑：能直连就跳过中间点
  let outN = 0;
  let px = sx, pz = sz;
  for (let i = 0; i < n; i++) {
    const p = buf.pts[i];
    if (i === n - 1 || !navClear(px, pz, buf.pts[i + 1].x, buf.pts[i + 1].z)) {
      writeWp(buf, outN++, p.x, p.z);
      px = p.x; pz = p.z;
    }
  }
  buf.n = outN;
  return outN > 0;
}
const _DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
const _DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

// 诊断计数器（开发用，开销可忽略）
navPath.dbg = {
  calls: 0, noNav: 0, noSrc: 0, noDst: 0, sameCell: 0, attempted: 0,
  ok: 0, partial: 0, fail: 0, snappedSrc: 0, snappedDst: 0,
  sumExpanded: 0, maxExpanded: 0, lastExpanded: 0,
};
function navDbgReset() {
  const d = navPath.dbg;
  for (const k in d) d[k] = 0;
}

// 复用路点对象，不产生新分配
function writeWp(buf, i, x, z) {
  let w = buf.pts[i];
  if (w === undefined) { w = buf.pts[i] = { x: 0, z: 0 }; }
  w.x = x; w.z = z;
}

bootMark('collision');
