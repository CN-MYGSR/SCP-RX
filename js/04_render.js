'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  04 渲染底层
   渲染器 / 场景 / 相机 / 灯光池 / 雾 / 天空。
   室内设施为主，因此采用「少量动态点光 + 全局补光 + 自发光灯具」方案。
   ===================================================================== */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
// 阴影：设施里没有任何物体 receiveShadow（墙体/地板都是 InstancedMesh，默认不接收），
// 打开阴影只会白白多跑一整趟阴影 pass。所以直接关掉，纯赚帧率。
renderer.shadowMap.enabled = false;
if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;
renderer.domElement.className = 'game';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(SETTINGS.fov, innerWidth / innerHeight, 0.06, 400);
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.008, 12);

// 设施整体基调：昏暗、偏冷，重收容区更黑
const AMB = { hemiSky: 0x38414e, hemiGround: 0x16181c, hemiI: 0.58 };
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.Fog(0x05070a, 4, 46);

const hemi = new THREE.HemisphereLight(AMB.hemiSky, AMB.hemiGround, AMB.hemiI);
hemi.userData.persist = true;
scene.add(hemi);

// 补光（无阴影），跟随玩家 —— 模拟设施顶部整体漫射
const sun = new THREE.DirectionalLight(0xbfd0e0, 0.38);
sun.position.set(-30, 60, 20);
sun.castShadow = false;
sun.userData.persist = true;
scene.add(sun); scene.add(sun.target);

let SHADOW_RANGE = 26;
let QUALITY_FILTER = 'none';
// 画质档位：像素比上限 / 激活的动态点光数量
const QUALITY_TABLE = [
  { pr: 0.75, lights: 4, filter: 'none' },
  { pr: 1.15, lights: 7, filter: 'none' },
  { pr: 1.60, lights: 10, filter: 'saturate(1.08) contrast(1.05)' },
];

// 自适应分辨率：帧时间超标就降内部分辨率，富余就升回去。
// 这是"卡顿"体感最直接的解药 —— 比换渲染后端有效得多。
const PERF = { acc: 0, frames: 0, scale: 1, cooldown: 0, lastAvg: 16.7 };
let basePixelRatio = 1;
function applyPixelRatio() {
  const q = QUALITY_TABLE[SETTINGS.quality] || QUALITY_TABLE[1];
  basePixelRatio = Math.min(devicePixelRatio, q.pr);
  renderer.setPixelRatio(basePixelRatio * PERF.scale);
}
function applyQuality() {
  const q = QUALITY_TABLE[SETTINGS.quality] || QUALITY_TABLE[1];
  QUALITY_FILTER = q.filter;
  // 只保留前 q.lights 盏动态点光
  for (let i = 0; i < LIGHT_POOL.length; i++) LIGHT_POOL[i].userData.muted = i >= q.lights;
  applyPixelRatio();
  applyRenderFilter();
}
function updateAdaptive(dt) {
  if (!SETTINGS.adaptive) {
    if (PERF.scale !== 1) { PERF.scale = 1; applyPixelRatio(); }
    return;
  }
  PERF.acc += dt; PERF.frames++;
  if (PERF.frames < 45) return;
  const avg = (PERF.acc / PERF.frames) * 1000;
  PERF.lastAvg = avg;
  PERF.acc = 0; PERF.frames = 0;
  if (PERF.cooldown > 0) { PERF.cooldown--; return; }
  const target = 1000 / 60;
  if (avg > target * 1.5 && PERF.scale > 0.55) {
    PERF.scale = Math.max(0.55, PERF.scale - 0.10);
    applyPixelRatio(); PERF.cooldown = 2;
  } else if (avg < target * 0.85 && PERF.scale < 1) {
    PERF.scale = Math.min(1, PERF.scale + 0.06);
    applyPixelRatio(); PERF.cooldown = 3;
  }
}
function applyRenderFilter() {
  const nvg = NVG.on ? NVG.cssFilter() : '';
  renderer.domElement.style.filter = ((QUALITY_FILTER === 'none' ? '' : QUALITY_FILTER) + ' ' + nvg).trim() || 'none';
}

// ---------- 灯光池 ----------
// 设施里灯很多，但动态点光开太多会拖垮帧率。
// 这里固定创建 N 盏 PointLight，每帧把最近的 N 个灯具位置分配进去。
const LIGHT_POOL = [];
const LIGHT_SOURCES = [];   // {x,y,z,color,intensity,dist,flicker,on}
const _bestL = [];
const _bestD = [];
function initLightPool(n) {
  for (let i = 0; i < n; i++) {
    const L = new THREE.PointLight(0xffffff, 0, 12, 2);
    L.visible = false;
    L.userData.persist = true;
    scene.add(L);
    LIGHT_POOL.push(L);
    _bestL.push(null);
    _bestD.push(Infinity);
  }
}
function registerLight(x, y, z, color, intensity, dist, opt) {
  const s = Object.assign({ x, y, z, color: new THREE.Color(color), intensity, dist: dist || 12, flicker: 0, on: true, phase: Math.random() * 10 }, opt || {});
  LIGHT_SOURCES.push(s);
  return s;
}
// 找出最近的 n 个灯具：插入排序到定长小数组，避免对 250 个元素整体排序
function updateLightPool(px, py, pz) {
  const n = LIGHT_POOL.length;
  if (!n) return;
  let cnt = 0;
  for (let i = 0; i < LIGHT_SOURCES.length; i++) {
    const s = LIGHT_SOURCES[i];
    if (!s.on) continue;
    const dx = s.x - px, dy = s.y - py, dz = s.z - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    const reach = (s.dist || 12) * 1.35;
    if (d2 > reach * reach) continue;
    if (cnt < n) {
      let j = cnt++;
      while (j > 0 && _bestD[j - 1] > d2) { _bestD[j] = _bestD[j - 1]; _bestL[j] = _bestL[j - 1]; j--; }
      _bestD[j] = d2; _bestL[j] = s;
    } else if (d2 < _bestD[n - 1]) {
      let j = n - 1;
      while (j > 0 && _bestD[j - 1] > d2) { _bestD[j] = _bestD[j - 1]; _bestL[j] = _bestL[j - 1]; j--; }
      _bestD[j] = d2; _bestL[j] = s;
    }
  }
  const q = QUALITY_TABLE[SETTINGS.quality] || QUALITY_TABLE[1];
  const activeN = Math.min(n, q.lights);
  for (let i = 0; i < n; i++) {
    const L = LIGHT_POOL[i];
    if (i >= activeN) { L.visible = false; continue; }
    const s = _bestL[i];
    if (!s) { L.visible = false; continue; }
    L.visible = true;
    L.position.set(s.x, s.y, s.z);
    L.color.copy(s.color);
    L.distance = s.dist;
    let inten = s.intensity;
    if (s.flicker > 0) {
      const t = nowT * (6 + s.flicker * 12) + s.phase;
      inten *= 1 - s.flicker * (0.5 + 0.5 * Math.sin(t) * Math.sin(t * 2.7));
      if (Math.random() < s.flicker * 0.05) inten *= 0.25;
    }
    L.intensity = inten;
  }
}

// ---------- 天空盒（设施外可见部分 / 窗外） ----------
function buildSky() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#0a0e14');
  gr.addColorStop(0.5, '#141a22');
  gr.addColorStop(0.78, '#22282f');
  gr.addColorStop(1, '#0c0e11');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(340, 20, 14),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.frustumCulled = false;
  sky.userData.persist = true;
  scene.add(sky);
  return sky;
}
let SKY = null;

// ---------- 第一人称武器场景光照 ----------
vmScene.add(new THREE.HemisphereLight(0xb8c4d4, 0x30302c, 1.15));
{ const l = new THREE.DirectionalLight(0xffe8c8, 1.5); l.position.set(-0.8, 1.4, 0.9); vmScene.add(l); }
{ const l = new THREE.DirectionalLight(0x8090b0, 0.55); l.position.set(1.1, 0.4, -0.7); vmScene.add(l); }

// ---------- 环境（室内设施 / 户外夜间）----------
const ENV = {
  facility: { fog: [0x05070a, 4, 46], bg: 0x05070a, hemi: [0x38414e, 0x16181c, 0.58], sun: [0xbfd0e0, 0.38] },
  farm: { fog: [0x0a0e16, 12, 120], bg: 0x070a12, hemi: [0x33405c, 0x151610, 0.52], sun: [0xa8bce8, 0.62] },
};
function applyEnvironment(mode) {
  const e = ENV[mode] || ENV.facility;
  scene.fog = new THREE.Fog(e.fog[0], e.fog[1], e.fog[2]);
  scene.background = new THREE.Color(e.bg);
  hemi.color.setHex(e.hemi[0]); hemi.groundColor.setHex(e.hemi[1]); hemi.intensity = e.hemi[2];
  sun.color.setHex(e.sun[0]); sun.intensity = e.sun[1];
}

// ---------- 窗口尺寸 ----------
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  vmCamera.aspect = camera.aspect; vmCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

// 补光跟随玩家（已关闭阴影，只做方向跟随）
function updateSunShadow() {
  const cx = camera.position.x, cz = camera.position.z;
  sun.target.position.set(cx, 0, cz);
  sun.position.set(cx - 26, 52, cz + 16);
}

// ---------- 头戴视觉增强装置（夜视仪 / Project SCRAMBLE）----------
// 两者共用同一个槽位，功能重叠但侧重不同：
//   夜视仪  —— 纯粹的红外增强
//   SCRAMBLE —— 同样有夜视能力，额外对 SCP-096 的面部实时打码（免疫暴走）
const NVG = {
  on: false,
  battery: 100,
  filterEl: null,
  init() {
    this.filterEl = el('nvgOv');
  },
  gear() { return (typeof LOADOUT !== 'undefined' && LOADOUT.gear) || 'none'; },
  def() { return (typeof GEAR_DEFS !== 'undefined' && GEAR_DEFS[this.gear()]) || null; },
  label() { const d = this.def(); return d ? d.name : '视觉增强装置'; },
  shortLabel() { const d = this.def(); return d ? d.short : '—'; },

  cssFilter() {
    // SCRAMBLE 用和夜视仪**同一套亮度公式**，只把色相从绿换成青 ——
    // 之前用 desaturate + 低对比，在设施那种近乎全黑的环境里几乎什么都看不见。
    // 两者的区分靠色相 + 屏幕叠加的网格/边框图案，而不是靠"更暗"。
    if (this.gear() === 'scramble') return 'grayscale(1) sepia(1) hue-rotate(152deg) saturate(4.6) brightness(1.82) contrast(1.14)';
    if (SETTINGS.nvgMode === 'white') return 'grayscale(1) brightness(1.85) contrast(1.35)';
    if (SETTINGS.nvgMode === 'amber') return 'grayscale(1) sepia(1) hue-rotate(-14deg) saturate(5.5) brightness(1.45) contrast(1.22)';
    return 'grayscale(1) sepia(1) hue-rotate(58deg) saturate(6) brightness(1.5) contrast(1.28)';
  },
  // 是否正在提供 SCP-096 面部保护（必须戴着 + 开着 + 还有电）
  scrambleActive() {
    return this.gear() === 'scramble' && this.on && this.battery > 0;
  },
  toggle() {
    const g = this.gear();
    if (g === 'none') { toast('未携带头戴视觉增强装置', 1800, 'warn'); return; }
    if (this.battery <= 0) { toast(this.label() + ' 电量耗尽', 1800, 'warn'); return; }
    this.on = !this.on;
    AudioSys.beep(this.on);
    this.apply();
    if (!this.on) return;
    if (g === 'scramble') {
      subtitle('Project SCRAMBLE · 启动', '面部干扰已上线 —— SCP-096 无法识别你', 2400);
      toast('SCRAMBLE：直视 SCP-096 不再触发暴走', 3000, 'good');
    } else {
      subtitle('夜视仪 · 开启', 'SCP-966 在红外波段显形', 1800);
    }
  },
  apply() {
    const f = this.filterEl;
    if (f) {
      const g = this.gear();
      f.className = 'nvgOv' + (this.on ? ' on ' + (g === 'scramble' ? 'scram' : 'nvg-' + SETTINGS.nvgMode) : '');
    }
    applyRenderFilter();
  },
  update(dt) {
    if (this.on) {
      const d = this.def();
      this.battery = Math.max(0, this.battery - dt * ((d && d.drain) || 0.40));
      if (this.battery <= 0) {
        this.on = false;
        this.apply();
        const wasScramble = this.gear() === 'scramble';
        toast(this.label() + ' 电量耗尽', 2400, 'warn');
        if (wasScramble) {
          broadcast('◤ SCRAMBLE 已断电 · 面部干扰失效 · 立即回避 SCP-096');
          subtitle('SCRAMBLE 断电', '不要再直视 SCP-096 的脸', 3000);
          AudioSys.alarm();
        }
      }
      if (this.filterEl) this.filterEl.style.opacity = this.battery < 18 ? String(0.5 + 0.5 * Math.abs(Math.sin(nowT * 7))) : '';
    }
  },
  addBattery(n) { this.battery = clamp(this.battery + n, 0, 100); },
};

bootMark('render');
