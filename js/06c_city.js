'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  06c 市区地图（净化行动）
   MTF Beta-7「疯帽匠」被派进一座被异常疾病感染的市区：
   十字主街 + 纵横小巷 + 沿街高层，被感染的市民在街上游荡。

   和农场一样，整片区域在结构上都是"可走"的，
   只有街区那些格子保持封闭（= 楼房），由 collideMove 直接挡住。
   ===================================================================== */

const CITY = {
  spawnX: 0, spawnZ: 74,          // 竖街南端
  extractX: 0, extractZ: -76,     // 竖街北端
  buildings: [],
};

/* 街道网格（格坐标）—— 改这里就能改路网 */
const CITY_ROADS = {
  mainH: [28, 43],                // 横向主街（rows）
  mainV: [22, 37],                // 纵向主街（cols）
  alleysH: [[12, 14], [57, 59]],  // 横向小巷
  alleysV: [[11, 13], [46, 48]],  // 纵向小巷
};
/* 被路网切出来的街区（每个里面放一栋楼）*/
const CITY_BLOCKS = [];
function cityBuildBlocks() {
  if (CITY_BLOCKS.length) return CITY_BLOCKS;
  const cols = [[1, 10], [14, 21], [38, 45], [49, 58]];
  const rows = [[1, 11], [15, 27], [44, 56], [60, 70]];
  for (const [c0, c1] of cols) for (const [r0, r1] of rows) CITY_BLOCKS.push({ c0, c1, r0, r1 });
  return CITY_BLOCKS;
}

/* ---------------------------------------------------------------------
   主入口
   --------------------------------------------------------------------- */
function buildCity() {
  FAC.mode = 'city';
  FAC.rooms.length = 0; FAC.roomAt = {}; FAC.doors.length = 0; FAC.lights.length = 0;
  FAC.breakers.length = 0; FAC.props.length = 0;
  FAC.terminal = null; FAC.extract = null; FAC.nuke = null; FAC.coffee = null;
  PHOTOS.length = 0;
  CITY.buildings.length = 0;

  FAC.open = new Uint8Array(GW * GH);
  FAC.zone = new Array(GW * GH).fill('EZ');
  NAV_OPENINGS.length = 0;

  const R = CITY_ROADS;
  carveRect(1, 58, R.mainH[0], R.mainH[1], 'EZ');       // 横向主街
  carveRect(R.mainV[0], R.mainV[1], 1, 70, 'EZ');       // 纵向主街
  for (const [r0, r1] of R.alleysH) carveRect(1, 58, r0, r1, 'EZ');
  for (const [c0, c1] of R.alleysV) carveRect(c0, c1, 1, 70, 'EZ');

  applyEnvironment('city');

  buildOccupancyForProps();
  buildCityGround();
  buildCityBuildings();
  buildCityProps();
  buildCitySky();
  buildCityKeyPoints();

  buildNavGrid();
  buildSpatialIndex();
}

/* ---------------------------------------------------------------------
   地面：柏油路 + 车道线 + 人行道
   --------------------------------------------------------------------- */
function buildCityGround() {
  const span = 220;
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshStandardMaterial({ map: cloneTex(TEX.concrete, 34, 40), color: 0x4a4a52, roughness: 0.98 })
  );
  road.rotation.x = -HPI;
  scene.add(road);

  // 主街中央的黄虚线
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8c04a });
  for (let x = -68; x <= 68; x += 7) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 0.26), lineMat);
    d.position.set(x, 0.021, 0); scene.add(d);
  }
  for (let z = -82; z <= 82; z += 7) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 3.6), lineMat);
    d.position.set(0, 0.021, z); scene.add(d);
  }
  // 十字路口的斑马线
  const zebra = new THREE.MeshBasicMaterial({ color: 0xc8ccd2 });
  for (let i = 0; i < 7; i++) {
    const t = -14.4 + i * 4.8;
    for (const sz of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 1.1), zebra);
      s.position.set(t, 0.022, sz * 22.2); scene.add(s);
    }
    for (const sx of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 2.6), zebra);
      s.position.set(sx * 22.2, 0.022, t); scene.add(s);
    }
  }
  // 人行道（沿主街两侧的窄条）
  const walk = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.concrete, 20, 2), color: 0x8a8d94, roughness: 0.95 });
  for (const sz of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(150, 0.16, 3.2), walk);
    s.position.set(0, 0.08, sz * 21.0); scene.add(s);
  }
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 168), walk);
    s.position.set(sx * 21.0, 0.08, 0); scene.add(s);
  }
}

/* ---------------------------------------------------------------------
   沿街楼房：每块街区一栋，高度随机 —— 组成天际线
   --------------------------------------------------------------------- */
function buildCityBuildings() {
  const tints = [0x6e6a63, 0x5e6068, 0x726a5e, 0x646a70, 0x7a7068];
  for (const b of cityBuildBlocks()) {
    const w = (b.c1 - b.c0 + 1) * CELL - 0.8;
    const d = (b.r1 - b.r0 + 1) * CELL - 0.8;
    const cx = (cellX(b.c0) + cellX(b.c1)) / 2;
    const cz = (cellZ(b.r0) + cellZ(b.r1)) / 2;
    const h = rand(9, 26);
    const tint = tints[Math.floor(rand(0, tints.length)) % tints.length];

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ map: cloneTex(TEX.concrete, Math.round(w / 4), Math.round(h / 4)), color: tint, roughness: 0.94 })
    );
    body.position.set(cx, h / 2, cz);
    scene.add(body);

    // 楼顶水箱 / 天线，让天际线别太平
    if (Math.random() < 0.7) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.8, 10),
        new THREE.MeshStandardMaterial({ map: cloneTex(TEX.rust, 2, 2), color: 0x8a7a6a, roughness: 0.9 }));
      tank.position.set(cx + rand(-w / 4, w / 4), h + 0.9, cz + rand(-d / 4, d / 4));
      scene.add(tank);
    }
    if (Math.random() < 0.5) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, rand(3, 7), 5),
        new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.8 }));
      mast.position.set(cx + rand(-w / 3, w / 3), h + 2.4, cz + rand(-d / 3, d / 3));
      scene.add(mast);
    }
    // 一楼门面（稍微亮一点）
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 3.0, d + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.85 }));
    base.position.set(cx, 1.5, cz);
    scene.add(base);

    CITY.buildings.push({ x: cx, z: cz, w, d, h });
  }
}

/* ---------------------------------------------------------------------
   街景：路灯 / 废弃车辆 / 垃圾桶 / 路障
   --------------------------------------------------------------------- */
function makeStreetLamp(x, z) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.7, metalness: 0.3 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 6.4, 8), mat);
  pole.position.y = 3.2; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), mat);
  arm.position.set(0.75, 6.3, 0); g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, 0.42), mat);
  head.position.set(1.4, 6.2, 0); g.add(head);
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.32),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  bulb.position.set(1.4, 6.1, 0); g.add(bulb);
  g.position.set(x, 0, z);
  scene.add(g);
  registerLight(x + 1.4, 5.9, z, 0xffc98a, 1.3, 30, {});
  addBox(x, 3.2, z, 0.3, 6.4, 0.3, {});
}

function makeCityCar(x, z, ry, tint) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 4.4),
    new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6, metalness: 0.35 }));
  body.position.y = 0.75; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.4, metalness: 0.3 }));
  cab.position.set(0, 1.5, -0.2); g.add(cab);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181a1e, roughness: 0.95 });
  for (const [wx, wz] of [[-1.0, 1.5], [1.0, 1.5], [-1.0, -1.5], [1.0, -1.5]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10), wheelMat);
    w.rotation.z = HPI; w.position.set(wx, 0.42, wz); g.add(w);
  }
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
  addBox(x, 0.9, z, 2.2, 1.8, 4.6, { ry });
}

function buildCityProps() {
  // 路灯：沿两条主街布，十字路口空出来
  for (let z = -78; z <= 78; z += 16) {
    if (Math.abs(z) < 24) continue;
    makeStreetLamp(-22.5, z); makeStreetLamp(22.5, z);
  }
  for (let x = -66; x <= 66; x += 16) {
    if (Math.abs(x) < 24) continue;
    makeStreetLamp(x, -21.5); makeStreetLamp(x, 21.5);
  }
  // 废弃车辆：横七竖八地停在街上
  const carTints = [0x8a3a34, 0x3a5a7a, 0x6a6a70, 0x2e3a30, 0x9a8a5a, 0x4a4a52];
  const cars = [
    [-34, 6.5, 0.06], [-12, -8.2, 0.02], [14, 9.4, -0.05], [40, -5.6, 0.09],
    [58, 11.2, 0.03], [-56, -12.5, -0.04], [8, 42, HPI + 0.05], [-9, 62, HPI - 0.03],
    [11, -46, HPI + 0.08], [-6, -66, HPI + 0.02], [30, 52, 0.04], [-46, 40, -0.06],
    [52, -52, 0.07], [-30, -60, 0.01], [66, 30, HPI + 0.06],
  ];
  for (let i = 0; i < cars.length; i++) {
    const [x, z, ry] = cars[i];
    if (!openAtWorld(x, z, 0)) continue;
    makeCityCar(x, z, ry, carTints[i % carTints.length]);
  }
  // 垃圾桶 / 路障
  const propMat = new THREE.MeshStandardMaterial({ map: cloneTex(TEX.rust, 2, 2), color: 0x5a5e64, roughness: 0.92 });
  const bins = [[-24.5, -30], [24.5, 34], [-24.5, 48], [24.5, -52], [-52, 22.5], [56, -22.5]];
  for (const [x, z] of bins) {
    if (!openAtWorld(x, z, 0)) continue;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.4, 1.1, 10), propMat);
    b.position.set(x, 0.55, z); scene.add(b);
    addBox(x, 0.55, z, 0.95, 1.1, 0.95, {});
  }
  // 翻倒的路障（红白条）
  for (const [x, z, ry] of [[-18, 25, 0.2], [18, -25, -0.3], [-2, 34, HPI]]) {
    if (!openAtWorld(x, z, 0)) continue;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.8 }));
    bar.position.set(x, 0.9, z); bar.rotation.y = ry; scene.add(bar);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.14),
        new THREE.MeshStandardMaterial({ color: 0xc04030, roughness: 0.8 }));
      leg.position.set(x + Math.cos(ry) * sx * 1.2, 0.48, z - Math.sin(ry) * sx * 1.2);
      scene.add(leg);
    }
  }
}

/* ---------------------------------------------------------------------
   夜空 + 远景天际线剪影
   --------------------------------------------------------------------- */
function buildCitySky() {
  // 远处一圈楼影（只做剪影，不参与碰撞）
  const silMat = new THREE.MeshBasicMaterial({ color: 0x14141c, fog: false });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * TAU + rand(-0.04, 0.04);
    const r = rand(112, 150);
    const w = rand(10, 26), h = rand(18, 58);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), silMat);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    m.rotation.y = a;
    scene.add(m);
  }
}

/* ---------------------------------------------------------------------
   关键点：出生点 / 撤离点 / 感染源 / 补给
   --------------------------------------------------------------------- */
function buildCityKeyPoints() {
  FAC.spawn = { x: CITY.spawnX, z: CITY.spawnZ, yaw: 0 };     // 朝北（-Z）
  FAC.extract = makeHelicopter(CITY.extractX, CITY.extractZ, 'EZ');

  // 感染源：关掉之后感染不再扩散（复用断路器的交互机制）
  FAC.breakers.length = 0;
  const spots = [[-40, -40], [40, 30], [-40, 55]];
  for (let i = 0; i < spots.length; i++) {
    const [x, z] = spots[i];
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 14),
      new THREE.MeshStandardMaterial({ map: cloneTex(TEX.corrosion, 3, 3), color: 0x5a6a48, roughness: 0.95 }));
    slab.position.y = 0.25; g.add(slab);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1),
      new THREE.MeshStandardMaterial({ color: 0x8adf3a, emissive: 0x3a7a18, emissiveIntensity: 0.9, roughness: 0.6 }));
    core.position.y = 1.25; g.add(core);
    g.position.set(x, 0, z);
    scene.add(g);
    registerLight(x, 1.6, z, 0x8adf3a, 0.9, 16, {});
    addBox(x, 0.25, z, 3.4, 0.5, 3.4, {});
    FAC.breakers.push({
      id: String.fromCharCode(65 + i), x, z, done: false, range: 2.8, holdNeed: 2.4,
      isInfectionSource: true,
      mesh: g, core, name: '感染源 ' + String.fromCharCode(65 + i),
    });
  }

  // 补给：散在街上（弹匣 / 医疗 / 护甲板）
  const picks = [
    ['ammo_rifle', 0, 60], ['medkit', -14, 40], ['ammo_smg', 14, 20],
    ['bandage', -30, -10], ['armor_plate', 30, -30], ['ammo_rifle', -50, 0],
    ['medkit', 50, 10], ['bandage', 0, -50], ['ammo_smg', -12, -70],
    ['ammo_rifle', 44, 60], ['medkit', -44, -62], ['battery', 12, 66],
  ];
  for (const [t, x, z] of picks) {
    if (!openAtWorld(x, z, 0)) continue;
    spawnPickup(t, x, z);
  }
}

/* 关闭一处感染源（由 completeInteract 调用）*/
function onInfectionSourceDone(obj) {
  obj.done = true;
  if (obj.core) {
    obj.core.material.color.setHex(0x44503a);
    obj.core.material.emissiveIntensity = 0.05;
  }
  if (obj.mesh) obj.mesh.scale.setScalar(0.78);
  AudioSys.beep(true);
  const left = FAC.breakers.filter(b => !b.done).length;
  if (left <= 0) {
    broadcast('◤ 三处感染源已全部关闭 · 不会再有人被感染');
    subtitle('感染源已关闭', '把街上剩下的被感染者清干净', 5000);
    toast('感染停止扩散 · 还剩 ' + infectedLeft() + ' 个被感染者', 5200, 'good');
  } else {
    broadcast('◤ ' + obj.name + ' 已关闭 · 还剩 ' + left + ' 处');
    toast(obj.name + ' 已关闭 · 还剩 ' + left + ' 处感染源', 3800, 'good');
  }
  killfeed(obj.name + ' 已关闭', 'good');
}

/* =====================================================================
   被感染者 —— 市区行动专属敌人
   · 游荡时慢慢乱走；看到玩家（<26m 且有视线）就扑上来
   · 近战：碰到就抓一下（12 点伤害）
   · 只要还有感染源没关，就会不断有新的人被感染
   ===================================================================== */
const INFECTED = [];
const INFECTED_TOTAL_MAX = 24;        // 本局最多出现这么多（含初始）
const INFECTED_SPAWN_EVERY = 18;      // 每 18 秒扩散一批
const INFECTED_BATCH = 2;

const INFECTED_CLOTH = [0x6a5a48, 0x4a5a6a, 0x7a6a5a, 0x5a4a52, 0x6a6a5a, 0x8a7a68];

function infectedSpawnPos() {
  // 优先在"离玩家有点距离"的街上生成，免得贴脸刷怪
  for (let i = 0; i < 40; i++) {
    const c = Math.floor(rand(2, GW - 2)), r = Math.floor(rand(2, GH - 2));
    if (FAC.open[idxOf(c, r)] !== 1) continue;
    const x = cellX(c), z = cellZ(r);
    if (Math.hypot(x - player.pos.x, z - player.pos.z) < 28) continue;
    if (!openAtWorld(x, z, 0)) continue;
    return { x, z };
  }
  return { x: cellX(30), z: cellZ(10) };
}

function spawnInfected(x, z) {
  const cloth = INFECTED_CLOTH[Math.floor(rand(0, INFECTED_CLOTH.length)) % INFECTED_CLOTH.length];
  const rig = humanoidRig({
    skin: 0x9a9284, cloth,
    armW: 0.15, legW: 0.18, torsoW: 0.52, torsoH: 0.72, headR: 0.17,
  });
  rig.group.position.set(x, 0, z);
  scene.add(rig.group);
  const m = {
    pos: V3(x, 0, z), hp: 110, maxHp: 110, alive: true,
    rig, group: rig.group, yaw: rand(0, TAU), walkT: 0, atkCd: 0,
    radius: 0.36, height: 1.85, name: '被感染者', isInfected: true,
    wanderT: rand(0, 3), wx: x, wz: z, alerted: false,
    damage(amt, attacker, o) {
      this.hp -= amt;
      this.alerted = true;
      if (this.hp <= 0 && this.alive) {
        this.alive = false;
        scene.remove(this.group);
        player.kills++; GAME.kills++;
        AudioSys.killConfirm();
        floatText(this, '清除感染者', '#8ad8ff');
        spawnBloodBurst(V3(this.pos.x, 1.0, this.pos.z), 'blood', 5);
      }
    },
    die() { },
  };
  INFECTED.push(m);
  return m;
}

function spawnInitialInfected(n) {
  INFECTED.length = 0;
  let made = 0;
  for (let i = 0; i < 400 && made < n; i++) {
    const p = infectedSpawnPos();
    if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 24) continue;
    spawnInfected(p.x, p.z);
    made++;
  }
}

/* 扩散：只要还有感染源没关，就持续有人被感染 */
function updateInfectionSpread(dt) {
  // ⚠️ 只有净化行动才有"感染"这回事。别的行动里 FAC.breakers 是断路器，
  //    不判断的话落锤行动开场 18 秒后就会开始刷感染者。
  if (GAME.mission !== 'city') return;
  const G = GAME.cityState;
  if (!G) return;
  const sourcesLeft = FAC.breakers.filter(b => !b.done).length;
  if (sourcesLeft <= 0) return;                      // 源全关 → 停止扩散
  if (G.spawned >= INFECTED_TOTAL_MAX) return;
  G.spreadT -= dt;
  if (G.spreadT > 0) return;
  G.spreadT = INFECTED_SPAWN_EVERY;
  const n = Math.min(INFECTED_BATCH, INFECTED_TOTAL_MAX - G.spawned);
  for (let i = 0; i < n; i++) {
    const p = infectedSpawnPos();
    spawnInfected(p.x, p.z);
    G.spawned++;
  }
  broadcast('◤ 又有人被感染了 · 关闭感染源才能止住');
  toast('⚠ 感染在扩散 · 场上还有 ' + FAC.breakers.filter(b => !b.done).length + ' 处感染源', 3600, 'warn');
  AudioSys.alarm();
}

function updateInfected(dt) {
  if (GAME.mission !== 'city') return;      // 同上：只有净化行动有感染者
  for (let i = INFECTED.length - 1; i >= 0; i--) {
    const m = INFECTED[i];
    if (!m.alive) { INFECTED.splice(i, 1); continue; }
    m.atkCd = Math.max(0, m.atkCd - dt);

    const pd = player.alive ? Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z) : 1e9;
    const chase = player.alive && !player.isSCP && !player.isAI && (pd < 26 || m.alerted) && pd < 60;
    let tx, tz, speed;
    if (chase) {
      m.alerted = true;
      tx = player.pos.x; tz = player.pos.z;
      speed = 3.5;
      // 贴脸就抓
      if (pd < 1.9 && m.atkCd <= 0) {
        m.atkCd = 1.15;
        player.damage(12, m, { limb: Math.random() < 0.5 ? 'torso' : 'limb' });
        AudioSys.hurt();
      }
    } else {
      // 游荡
      m.wanderT -= dt;
      if (m.wanderT <= 0 || Math.hypot(m.wx - m.pos.x, m.wz - m.pos.z) < 1.2) {
        m.wanderT = rand(3, 7);
        const a = rand(0, TAU), r = rand(4, 14);
        const nx = m.pos.x + Math.cos(a) * r, nz = m.pos.z + Math.sin(a) * r;
        if (openAtWorld(nx, nz, 0)) { m.wx = nx; m.wz = nz; }
        else { m.wx = m.pos.x; m.wz = m.pos.z; }
      }
      tx = m.wx; tz = m.wz;
      speed = 1.1;
    }

    const dx = tx - m.pos.x, dz = tz - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.6 && speed > 0) {
      const nx = m.pos.x + dx / d * speed * dt, nz = m.pos.z + dz / d * speed * dt;
      const before = { x: m.pos.x, z: m.pos.z };
      m.pos.x = nx; m.pos.z = nz;
      collideMove(m.pos, m.radius, m.height, 0.5);
      m.pos.y = floorAt(m.pos.x, m.pos.z, m.pos.y + 0.3);
      // 卡住就换个游荡点，别贴着墙磨
      if (Math.hypot(m.pos.x - before.x, m.pos.z - before.z) < speed * dt * 0.25) m.wanderT = 0;
      m.yaw = angLerp(m.yaw, Math.atan2(-dx, -dz), clamp(dt * 6, 0, 1));
      m.walkT += speed * dt;
    }
    m.group.position.set(m.pos.x, m.pos.y, m.pos.z);
    m.group.rotation.y = m.yaw;
  }
}

/* 场上还剩多少感染者（目标面板 / 结算用） */
function infectedLeft() { return INFECTED.filter(m => m.alive).length; }
