'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  00 核心层
   全局工具 / 常量 / 运行状态。所有其它模块都依赖这里的符号，
   必须第一个加载。
   ===================================================================== */

// ---------- 数学与工具 ----------
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const TAU = Math.PI * 2, HPI = Math.PI / 2, PI = Math.PI;
// 帧率无关的指数逼近
const dampF = (cur, tgt, k, dt) => lerp(tgt, cur, Math.exp(-k * dt));
// 角度最短差
function angDiff(a, b) { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; }
const angLerp = (a, b, t) => a + angDiff(a, b) * t;

const el = (id) => document.getElementById(id);
const elc = (cls) => document.getElementsByClassName(cls);
function show(id) { const e = el(id); if (e) e.classList.remove('hidden'); }
function hide(id) { const e = el(id); if (e) e.classList.add('hidden'); }
function txt(id, s) { const e = el(id); if (e && e.textContent !== s) e.textContent = s; }
function html(id, s) { const e = el(id); if (e) e.innerHTML = s; }

// ---------- 设置 ----------
const SETTINGS = {
  quality: 1,            // 0 低 / 1 中 / 2 高
  sens: 1.0,
  vol: 0.75,
  fov: 76,
  invertY: false,
  nvgMode: 'green',      // green / white / amber
  shake: 1.0,
  adsToggle: false,
  adaptive: true,        // 自适应分辨率（帧率不够时自动降内部分辨率）
};
try {
  const q = localStorage.getItem('scprx_quality'); if (q !== null) SETTINGS.quality = clamp(parseInt(q, 10) || 0, 0, 2);
  const s = parseFloat(localStorage.getItem('scprx_sens')); if (isFinite(s)) SETTINGS.sens = clamp(s, 0.2, 3);
  const v = parseFloat(localStorage.getItem('scprx_vol')); if (isFinite(v)) SETTINGS.vol = clamp(v, 0, 1);
  const f = parseFloat(localStorage.getItem('scprx_fov')); if (isFinite(f)) SETTINGS.fov = clamp(f, 60, 110);
  const n = localStorage.getItem('scprx_nvg'); if (n) SETTINGS.nvgMode = n;
  const ads = localStorage.getItem('scprx_adsmode'); SETTINGS.adsToggle = ads === 'toggle';
  const ad = localStorage.getItem('scprx_adaptive'); if (ad !== null) SETTINGS.adaptive = ad !== '0';
} catch (e) { }

// ---------- 全局运行状态 ----------
const GAME = {
  phase: 'boot',        // boot / menu / loadout / playing / paused / over
  mission: 'breach',    // breach(落锤行动) / contain096(收容行动)
  paused: false,
  over: false,
  won: false,
  startT: 0,
  elapsed: 0,
  // 落锤行动进度
  breakers: { A: false, B: false, C: false },
  protocol: false,      // 收容协议是否已激活
  powerOn: false,
  contained: {},        // key -> true
  // 收容行动进度
  saw096: false,
  // 报警等级
  alarmLevel: 0,        // 0 静默 / 1 警戒 / 2 紧急
  // 统计
  kills: 0, shots: 0, hits: 0, headshots: 0, dmgTaken: 0, dmgDealt: 0,
  // 提示队列
  msgQueue: [],
};

// 玩家配装（在配装界面填充）
const LOADOUT = {
  preset: 'assault',    // assault / breacher / support
  primary: 'hk416',
  secondary: 'glock18',
  mods: { primary: {}, secondary: {} },   // 槽位 -> 改装件 id
  armor: 2,             // 护甲等级 0..3
  gear: 'scramble',     // 头戴视觉增强装置：none / nvg / scramble（Project SCRAMBLE）
};

// 场景中的"SCP-096 照片"道具（两个行动共用）
const PHOTOS = [];

// 常用 DOM 缓存
const UI = {};

// 调试开关（通过 URL 参数开启，正常游玩不生效）
//   ?nopause=1  失去指针锁定时不自动暂停（自动化测试用）
//   ?god=1      玩家免疫伤害
//   ?nohud=1    隐藏 HUD（截图用）
const DEBUG = (function () {
  const d = { noPause: false, god: false, noHud: false };
  try {
    const q = new URLSearchParams(location.search);
    d.noPause = q.get('nopause') === '1';
    d.god = q.get('god') === '1';
    d.noHud = q.get('nohud') === '1';
  } catch (e) { }
  return d;
})();

// ---------- 帧计时 ----------
let nowT = 0, lastT = performance.now() / 1000;
let fpsAcc = 0, fpsN = 0, fpsShow = 0;
let dtGlobal = 0.016;

// ---------- 小工具 ----------
// 圆角/锥体等常用几何缓存，减少 GC
const GEO_CACHE = {};
function geoCache(key, build) {
  if (!GEO_CACHE[key]) GEO_CACHE[key] = build();
  return GEO_CACHE[key];
}
// 世界坐标 → 屏幕坐标（用于 SCP 雷达/标记）
const _projV = new THREE.Vector3();
function worldToScreen(v3, cam, out) {
  _projV.copy(v3).project(cam);
  out.x = (_projV.x * 0.5 + 0.5) * innerWidth;
  out.y = (-_projV.y * 0.5 + 0.5) * innerHeight;
  out.visible = _projV.z < 1 && _projV.z > -1;
  return out;
}

// 屏幕中央消息
function toast(msg, ms, cls) {
  const box = el('toastBox'); if (!box) return;
  const d = document.createElement('div');
  d.className = 'toast ' + (cls || '');
  d.textContent = msg;
  box.appendChild(d);
  setTimeout(() => { d.classList.add('out'); }, ms || 2600);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, (ms || 2600) + 500);
}
// 大字幕（剧情/目标）
function subtitle(main, sub, ms) {
  const box = el('subtitle'); if (!box) return;
  box.innerHTML = '<div class="subMain">' + main + '</div>' + (sub ? '<div class="subSub">' + sub + '</div>' : '');
  box.classList.add('show');
  clearTimeout(subtitle._t);
  subtitle._t = setTimeout(() => box.classList.remove('show'), ms || 3600);
}
// 广播（设施广播系统）
function broadcast(text, ms) {
  const box = el('broadcast'); if (!box) return;
  box.innerHTML = '<span class="bcIcon">◤</span>' + text;
  box.classList.add('show');
  clearTimeout(broadcast._t);
  broadcast._t = setTimeout(() => box.classList.remove('show'), ms || 4200);
}

// 简易断言：脚本加载自检用
const BOOT_LOG = [];
function bootMark(s) { BOOT_LOG.push(s); }
