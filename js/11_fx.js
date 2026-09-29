'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  11 特效层
   曳光弹 / 弹着点 / 血迹 / 腐蚀 / 酸液 / 伤害数字 / 屏幕反馈 / 抖动

   ⚠️ 性能要点（2026-09-28 重写）：
   旧版每生成一个血滴/灰尘都 `new THREE.SphereGeometry(...)` —— 等于每次
   命中都要新建一批 GPU 缓冲再销毁，驱动层会周期性卡顿。
   现在全部改为：**几何体与材质只创建一次，用对象池 + scale 复用**。
   ===================================================================== */

let dmgFlash = 0;
let flashOv = null, flashLayer = null, dirHitBox = null;

/* ---------------------------------------------------------------------
   共享几何体 / 材质（只创建一次）
   --------------------------------------------------------------------- */
const FX_GEO = {};
const FX_MAT = {};
let FX_READY = false;

function fxInit() {
  if (FX_READY) return;
  FX_READY = true;
  FX_GEO.ball = new THREE.SphereGeometry(1, 5, 4);
  FX_GEO.tracer = new THREE.BoxGeometry(1, 1, 1);
  FX_GEO.decal = new THREE.PlaneGeometry(1, 1);
  FX_GEO.pool = new THREE.CircleGeometry(1, 14);

  FX_MAT.blood = new THREE.MeshBasicMaterial({ color: 0x7a1414, transparent: true, opacity: 0.95 });
  FX_MAT.bloodBone = new THREE.MeshBasicMaterial({ color: 0x9a9a8a, transparent: true, opacity: 0.95 });
  FX_MAT.dust = new THREE.MeshBasicMaterial({ color: 0x9a968a, transparent: true, opacity: 0.75 });
  FX_MAT.acid = new THREE.MeshBasicMaterial({ color: 0x8adf3a, transparent: true, opacity: 0.9 });
  FX_MAT.tracer = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  FX_MAT.decal = new THREE.MeshBasicMaterial({ map: TEX.bulletHole, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  FX_MAT.corrosion = new THREE.MeshBasicMaterial({ map: TEX.corrosion, transparent: true, opacity: 0.85, depthWrite: false });
  FX_MAT.bloodPool = new THREE.MeshBasicMaterial({ map: TEX.blood, transparent: true, opacity: 0.85, depthWrite: false });
  // 曳光弹：每个实例一份材质（要独立淡出），但只创建一次
  FX_MAT.tracerPool = [];
  for (let i = 0; i < 48; i++) FX_MAT.tracerPool.push(new THREE.MeshBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

function initFX() {
  flashOv = el('flashOv');
  flashLayer = el('floatLayer');
  dirHitBox = el('dirHits');
  fxInit();
}

/* ---------------------------------------------------------------------
   通用粒子池（共享几何体 + 共享材质，靠 scale 做淡出）
   --------------------------------------------------------------------- */
const PARTS = [];
const PART_CAP = 220;
let partCursor = 0;
function fxSpawn(mat, x, y, z, r0, r1, vx, vy, vz, life, grav) {
  let p;
  if (PARTS.length < PART_CAP) {
    p = { mesh: new THREE.Mesh(FX_GEO.ball, mat), v: V3(), t: 0, life: 1, r0: 1, r1: 0, grav: 1, dead: false };
    scene.add(p.mesh);
    PARTS.push(p);
  } else {
    p = PARTS[partCursor];
    partCursor = (partCursor + 1) % PART_CAP;
  }
  p.dead = false;
  p.mesh.material = mat;
  p.mesh.visible = true;
  p.mesh.position.set(x, y, z);
  p.mesh.scale.setScalar(r0);
  p.v.set(vx, vy, vz);
  p.t = 0; p.life = life; p.r0 = r0; p.r1 = r1; p.grav = grav;
}
function updateParts(dt) {
  for (let i = 0; i < PARTS.length; i++) {
    const p = PARTS[i];
    if (p.dead) continue;
    p.t += dt;
    if (p.t >= p.life) { p.dead = true; p.mesh.visible = false; continue; }
    p.v.y -= p.grav * dt;
    p.mesh.position.addScaledVector(p.v, dt);
    p.mesh.scale.setScalar(lerp(p.r0, p.r1, p.t / p.life));
  }
}

/* ---------------------------------------------------------------------
   射击射线（玩家开火调用）
   --------------------------------------------------------------------- */
function fireRay(origin, dir, stats) {
  const maxD = 200;
  const scpRes = raycastSCPs(origin, dir, maxD);
  const worldRes = raycastWorld(origin, dir, maxD);
  const worldD = worldRes ? worldRes.dist : maxD;
  if (scpRes && scpRes.dist < worldD) {
    const dmg = damageSCP(scpRes.scp, stats.dmg, { byPlayer: true, head: scpRes.head, from: player });
    floatText(scpRes.scp, (scpRes.head ? '暴击 ' : '') + Math.round(dmg), scpRes.head ? '#ffd23f' : '#ffffff');
    const bone = (scpRes.scp.key === '3114' || scpRes.scp.key === '173');
    spawnBloodBurst(scpRes.scp.pos.clone().setY(scpRes.scp.pos.y + scpRes.scp.height * (scpRes.head ? 0.92 : 0.55)), bone ? 'bone' : 'blood', 8);
    const hitPt = origin.clone().addScaledVector(dir, scpRes.dist);
    spawnTracer(VM.muzzleWorld, hitPt);
    return { scpHit: scpRes.scp, head: scpRes.head, dist: scpRes.dist };
  }
  if (worldRes) {
    spawnTracer(VM.muzzleWorld, worldRes.point);
    spawnImpact(worldRes.point, worldRes.normal, worldRes.kind);
  } else {
    spawnTracer(VM.muzzleWorld, origin.clone().addScaledVector(dir, maxD));
  }
  return null;
}

/* ---------------------------------------------------------------------
   曳光弹（环形缓冲，零分配）
   --------------------------------------------------------------------- */
const TRACER_N = 48;
const TRACERS = [];
let tracerHead = 0;
function spawnTracer(from, to) {
  const d = _fxV1.copy(to).sub(from);
  const len = d.length();
  if (len < 0.05) return;
  let t = TRACERS[tracerHead];
  if (!t) {
    t = { mesh: new THREE.Mesh(FX_GEO.tracer, FX_MAT.tracerPool[tracerHead]), t: 0, life: 0.055, active: false };
    t.mesh.frustumCulled = false;
    scene.add(t.mesh);
    TRACERS[tracerHead] = t;
  }
  tracerHead = (tracerHead + 1) % TRACER_N;
  t.active = true; t.t = 0;
  t.mesh.visible = true;
  t.mesh.material.opacity = 0.9;
  t.mesh.position.copy(from).addScaledVector(d, 0.5);
  t.mesh.lookAt(to);
  t.mesh.scale.set(0.022, 0.022, len);
}
function updateTracers(dt) {
  for (let i = 0; i < TRACERS.length; i++) {
    const t = TRACERS[i];
    if (!t || !t.active) continue;
    t.t += dt;
    if (t.t >= t.life) { t.active = false; t.mesh.visible = false; continue; }
    t.mesh.material.opacity = 0.9 * (1 - t.t / t.life);
  }
}
const _fxV1 = V3();

/* ---------------------------------------------------------------------
   弹着点（环形缓冲 + 共享材质）
   --------------------------------------------------------------------- */
const DECAL_N = 96;
const DECALS = [];
let decalHead = 0;
function spawnImpact(point, normal, kind) {
  if (kind === 'floor') return;
  let m = DECALS[decalHead];
  if (!m) { m = new THREE.Mesh(FX_GEO.decal, FX_MAT.decal); m.frustumCulled = false; scene.add(m); DECALS[decalHead] = m; }
  decalHead = (decalHead + 1) % DECAL_N;
  m.visible = true;
  m.position.copy(point).addScaledVector(normal, 0.012);
  m.lookAt(point.clone().add(normal));
  m.rotateZ(rand(0, TAU));
  m.scale.setScalar(rand(0.13, 0.20));
  for (let i = 0; i < 3; i++) {
    fxSpawn(FX_MAT.dust,
      point.x + normal.x * 0.03, point.y + normal.y * 0.03, point.z + normal.z * 0.03,
      rand(0.012, 0.03), 0.002,
      normal.x * rand(0.8, 2.2) + rand(-1, 1), rand(0.4, 1.6), normal.z * rand(0.8, 2.2) + rand(-1, 1),
      rand(0.25, 0.5), 6);
  }
}

/* ---------------------------------------------------------------------
   血雾 / 酸液飞溅
   kind: 'bone' 骨屑（173/3114）| 'acid' 绿色酸液 | 其它 → 血
   --------------------------------------------------------------------- */
FX_MAT.acidSplash = null;   // 惰性建（要等 fxInit 之后）
function spawnBloodBurst(pos, kind, n) {
  if (!FX_MAT.acidSplash) FX_MAT.acidSplash = new THREE.MeshBasicMaterial({ color: 0x8adf3a, transparent: true, opacity: 0.9 });
  const mat = kind === 'bone' ? FX_MAT.bloodBone : (kind === 'acid' ? FX_MAT.acidSplash : FX_MAT.blood);
  for (let i = 0; i < n; i++) {
    fxSpawn(mat, pos.x, pos.y, pos.z,
      rand(0.02, 0.055), 0.004,
      rand(-1.8, 1.8), rand(0.6, 3.0), rand(-1.8, 1.8),
      rand(0.4, 0.9), 11);
  }
}

/* ---------------------------------------------------------------------
   SCP-106 腐蚀
   --------------------------------------------------------------------- */
const CORROSION_N = 36;
const CORROSION = [];
let corrHead = 0;
function spawnCorrosion(x, z) {
  let m = CORROSION[corrHead];
  if (!m) { m = new THREE.Mesh(FX_GEO.decal, FX_MAT.corrosion); m.frustumCulled = false; scene.add(m); CORROSION[corrHead] = m; }
  corrHead = (corrHead + 1) % CORROSION_N;
  m.visible = true;
  m.rotation.set(-HPI, 0, rand(0, TAU));
  m.position.set(x, 0.016, z);
  m.scale.setScalar(rand(1.7, 3.4));
}

/* ---------------------------------------------------------------------
   SCP-682 酸液
   --------------------------------------------------------------------- */
const ACIDS = [];
const ACID_POOLS = [];
const ACID_POOL_N = 16;
let acidPoolHead = 0;
function spitAcid(s) {
  const from = V3(s.pos.x, s.pos.y + s.height * 0.72, s.pos.z);
  const to = s.target ? V3(s.target.pos.x, s.target.pos.y + 1.0, s.target.pos.z) : from.clone().add(V3(0, 0, -6));
  const dir = to.clone().sub(from);
  const dist = dir.length();
  dir.normalize();
  const m = new THREE.Mesh(FX_GEO.ball, FX_MAT.acid);
  m.position.copy(from);
  m.scale.setScalar(0.16);
  scene.add(m);
  const speed = 22;
  ACIDS.push({
    mesh: m, t: 0, life: dist / speed,
    vel: dir.multiplyScalar(speed).add(V3(0, dist * 0.22, 0)),
  });
  AudioSys.scpRoar('682', 0);
}
function updateAcid(dt) {
  for (let i = ACIDS.length - 1; i >= 0; i--) {
    const a = ACIDS[i];
    a.t += dt;
    a.vel.y -= 9 * dt;
    a.mesh.position.addScaledVector(a.vel, dt);
    if (a.t >= a.life) {
      const px = a.mesh.position.x, pz = a.mesh.position.z;
      scene.remove(a.mesh);       // 几何体/材质都是共享的，不要 dispose
      ACIDS.splice(i, 1);
      let pool = ACID_POOLS[acidPoolHead];
      if (!pool) {
        pool = { mesh: new THREE.Mesh(FX_GEO.pool, new THREE.MeshBasicMaterial({ color: 0x6abf2a, transparent: true, opacity: 0.55, depthWrite: false })), t: 0, life: 7, x: 0, z: 0, r: 1.5 };
        pool.mesh.frustumCulled = false;
        scene.add(pool.mesh);
        ACID_POOLS[acidPoolHead] = pool;
      }
      acidPoolHead = (acidPoolHead + 1) % ACID_POOL_N;
      pool.mesh.visible = true;
      pool.mesh.rotation.x = -HPI;
      pool.mesh.position.set(px, 0.02, pz);
      pool.mesh.scale.setScalar(1.5);
      pool.x = px; pool.z = pz; pool.r = 1.5; pool.t = 0;
      pool.mesh.material.opacity = 0.55;
      spawnBloodBurst(V3(px, 0.2, pz), 'acid', 6);
    }
  }
  for (let i = 0; i < ACID_POOLS.length; i++) {
    const a = ACID_POOLS[i];
    if (!a) continue;
    if (!a.mesh.visible) continue;
    a.t += dt;
    a.mesh.material.opacity = 0.55 * Math.max(0, 1 - a.t / a.life);
    if (a.t >= a.life) { a.mesh.visible = false; continue; }
    if (player.alive && Math.hypot(player.pos.x - a.x, player.pos.z - a.z) < a.r) {
      player.hp -= dt * 16;
      player.dmgTaken += dt * 16;
      if (Math.random() < dt * 3) dmgFlash = Math.min(1, dmgFlash + 0.05);
      if (player.hp <= 0) player.die(null, { limb: 'leg', cause: '酸液腐蚀' });
    }
  }
}

/* ---------------------------------------------------------------------
   伤害数字（DOM 投影）
   --------------------------------------------------------------------- */
function floatText(entity, text, color) {
  if (!flashLayer) return;
  const p = entity.pos ? V3(entity.pos.x, entity.pos.y + (entity.height || 1.8) * 0.95, entity.pos.z) : entity;
  const v = p.clone().project(camera);
  if (v.z > 1) return;
  const d = document.createElement('div');
  d.className = 'floatText';
  d.textContent = text;
  d.style.color = color || '#fff';
  d.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
  d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  flashLayer.appendChild(d);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 850);
}

/* ---------------------------------------------------------------------
   屏幕反馈
   --------------------------------------------------------------------- */
function flashScreen(strength, color) {
  if (!flashOv) return;
  flashOv.style.background = color || '#c81f1f';
  flashOv.style.opacity = String(clamp(strength, 0, 1));
  flashOv.style.transition = 'none';
  requestAnimationFrame(() => {
    flashOv.style.transition = 'opacity .45s ease-out';
    flashOv.style.opacity = '0';
  });
}
function addTrauma(v) { if (player) player.trauma = Math.min(1.4, (player.trauma || 0) + v * SETTINGS.shake); }
function addDirHit(angle) {
  if (!dirHitBox) return;
  const d = document.createElement('div');
  d.className = 'dirHit';
  d.style.transform = 'translate(-50%,-50%) rotate(' + (angle * 180 / PI + 180) + 'deg)';
  dirHitBox.appendChild(d);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 900);
}
function updateDmgFlash(dt) {
  if (dmgFlash > 0) {
    dmgFlash = Math.max(0, dmgFlash - dt * 1.8);
    if (flashOv) flashOv.style.opacity = String(dmgFlash * 0.55);
  }
}

/* ---------------------------------------------------------------------
   汇总更新 / 清空
   --------------------------------------------------------------------- */
function updateFX(dt) {
  updateTracers(dt);
  updateParts(dt);
  updateAcid(dt);
  updateDmgFlash(dt);
}

// 清空所有特效（重开一局用）—— 池子留着，只隐藏
function clearFX() {
  for (const t of TRACERS) if (t) { t.active = false; t.mesh.visible = false; }
  for (const d of DECALS) if (d) d.visible = false;
  for (const c of CORROSION) if (c) c.visible = false;
  for (const p of PARTS) { p.dead = true; p.mesh.visible = false; }
  for (const a of ACID_POOLS) if (a) { a.t = a.life; a.mesh.visible = false; }
  ACIDS.length = 0;
}

bootMark('fx');
