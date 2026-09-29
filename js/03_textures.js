'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  03 程序化贴图
   全部用 Canvas 2D 现场绘制，零外部图片资源。
   ===================================================================== */
const TEX = {};

function mkCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d') };
}
function mkTex(w, h, draw, rx, ry, opts) {
  const { c, g } = mkCanvas(w, h);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx || 1, ry || 1);
  t.anisotropy = 4;
  if (!opts || opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// 噪声斑点叠加
function speckle(g, w, h, n, minA, maxA, size, hueFn) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = rand(0.4, size);
    g.globalAlpha = rand(minA, maxA);
    g.fillStyle = hueFn ? hueFn() : (Math.random() < 0.5 ? '#000' : '#fff');
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
}
// 污渍流痕
function streaks(g, w, h, n) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h * 0.4;
    const len = rand(h * 0.15, h * 0.7), wd = rand(1, 5);
    const gr = g.createLinearGradient(x, y, x, y + len);
    gr.addColorStop(0, 'rgba(0,0,0,0.20)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.07)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, wd, len);
  }
}

function buildTextures() {
  // ---------- 混凝土墙 ----------
  TEX.concrete = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5a5750'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, 0.02, 0.10, 3.2);
    // 浇筑接缝
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 128); g.lineTo(w, 128); g.stroke();
    g.beginPath(); g.moveTo(128, 0); g.lineTo(128, h); g.stroke();
    // 模板孔
    for (let i = 0; i < 4; i++) {
      const x = 32 + (i % 2) * 128, y = 32 + Math.floor(i / 2) * 128;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.arc(x, y, 3.4, 0, TAU); g.fill();
    }
    streaks(g, w, h, 22);
  }, 2, 2);

  // ---------- 混凝土地面 ----------
  TEX.concreteFloor = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4b4842'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 3200, 0.02, 0.11, 3.6);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.5;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
    }
    // 裂缝
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      g.beginPath(); let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rand(-24, 24); y += rand(-24, 24); g.lineTo(x, y); }
      g.stroke();
    }
  }, 3, 3);

  // ---------- 金属墙板 ----------
  TEX.metalWall = mkTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#4e545a'); gr.addColorStop(0.5, '#43484d'); gr.addColorStop(1, '#3a3f44');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // 面板分格
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
    g.beginPath(); g.moveTo(128, 0); g.lineTo(128, h); g.stroke();
    // 铆钉
    for (let ry = 0; ry < 4; ry++) for (let rx = 0; rx < 2; rx++) {
      for (const [ox, oy] of [[6, 6], [122, 6], [6, 58], [122, 58]]) {
        const x = rx * 128 + ox, y = ry * 64 + oy;
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(x - 0.6, y - 0.6, 2.1, 0, TAU); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(x + 0.5, y + 0.5, 1.9, 0, TAU); g.fill();
      }
    }
    speckle(g, w, h, 1400, 0.01, 0.06, 2.6);
    streaks(g, w, h, 14);
  }, 2, 2);

  // ---------- 金属花纹地面（防滑钢板） ----------
  TEX.metalFloor = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3c4045'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 3;
    for (let i = -8; i < 16; i++) {
      g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 64, h); g.stroke();
      g.beginPath(); g.moveTo(i * 32, h); g.lineTo(i * 32 + 64, 0); g.stroke();
    }
    speckle(g, w, h, 1600, 0.02, 0.10, 3);
    // 锈迹
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(6, 26);
      const rg = g.createRadialGradient(x, y, 1, x, y, r);
      rg.addColorStop(0, 'rgba(122,72,32,0.42)'); rg.addColorStop(1, 'rgba(122,72,32,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
  }, 3, 3);

  // ---------- 天花板 ----------
  TEX.ceiling = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#33373b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke();
    }
    speckle(g, w, h, 1200, 0.02, 0.08, 3);
  }, 2, 2);

  // ---------- 警示条 ----------
  TEX.hazard = mkTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9a227'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1a1a';
    for (let i = -4; i < 10; i++) {
      g.save(); g.translate(i * 24, 0); g.rotate(0.0);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(12, 0); g.lineTo(12 - h, h); g.lineTo(0 - h, h); g.closePath(); g.fill();
      g.restore();
    }
    speckle(g, w, h, 700, 0.03, 0.14, 3);
  }, 1, 1);

  // ---------- 白色瓷砖（实验室/医疗） ----------
  TEX.tile = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9aa0a0'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const s = 64;
      g.fillStyle = `rgb(${randi(206, 224)},${randi(208, 224)},${randi(202, 216)})`;
      g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
    }
    speckle(g, w, h, 900, 0.01, 0.06, 2.4);
    // 霉斑
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(8, 30);
      const rg = g.createRadialGradient(x, y, 1, x, y, r);
      rg.addColorStop(0, 'rgba(60,70,52,0.30)'); rg.addColorStop(1, 'rgba(60,70,52,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
  }, 3, 3);

  // ---------- 锈蚀金属（重收容区） ----------
  TEX.rust = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a3a2e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(4, 34);
      const rg = g.createRadialGradient(x, y, 1, x, y, r);
      const c = Math.random() < 0.5 ? '124,74,30' : '72,52,38';
      rg.addColorStop(0, `rgba(${c},0.5)`); rg.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2;
    for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(0, i * 85); g.lineTo(w, i * 85); g.stroke(); }
    speckle(g, w, h, 2000, 0.02, 0.14, 3.4);
  }, 2, 2);

  // ---------- 收容间内壁（带编号条） ----------
  TEX.cellWall = mkTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#3a3d40'); gr.addColorStop(1, '#26282b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2;
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(i * 51, 0); g.lineTo(i * 51, h); g.stroke(); }
    // 横向加强筋
    for (let i = 0; i < 3; i++) {
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 40 + i * 80, w, 5);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 45 + i * 80, w, 3);
    }
    speckle(g, w, h, 1600, 0.02, 0.10, 3);
  }, 2, 2);

  // ---------- 格栅地面 ----------
  TEX.grate = mkTex(128, 128, (g, w, h) => {
    g.fillStyle = '#2b2e31'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4a4f54'; g.lineWidth = 4;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * 16); g.lineTo(w, i * 16); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.fillRect(x * 16 + 5, y * 16 + 5, 6, 6);
  }, 4, 4);

  // ---------- 管道 ----------
  TEX.pipe = mkTex(64, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#2e3236'); gr.addColorStop(0.35, '#565c62'); gr.addColorStop(0.6, '#4a5055'); gr.addColorStop(1, '#24282b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, 0.02, 0.10, 2.4);
  }, 1, 1);

  // ---------- 血迹 ----------
  TEX.blood = mkTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = 64, cy = 64;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, r = rand(0, 46);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const rr = rand(4, 20);
      const rg = g.createRadialGradient(x, y, 0, x, y, rr);
      rg.addColorStop(0, 'rgba(78,10,10,0.85)'); rg.addColorStop(0.6, 'rgba(58,8,8,0.5)'); rg.addColorStop(1, 'rgba(40,4,4,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    // 溅射
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, r = rand(46, 62);
      g.fillStyle = 'rgba(64,8,8,0.7)';
      g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rand(1, 4), 0, TAU); g.fill();
    }
  }, 1, 1, { srgb: true });
  TEX.blood.wrapS = TEX.blood.wrapT = THREE.ClampToEdgeWrapping;

  // ---------- 弹孔 ----------
  TEX.bulletHole = mkTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const rg = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    rg.addColorStop(0, 'rgba(10,10,10,0.95)');
    rg.addColorStop(0.30, 'rgba(30,28,26,0.75)');
    rg.addColorStop(0.62, 'rgba(90,86,80,0.42)');
    rg.addColorStop(1, 'rgba(120,116,110,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * TAU, r = rand(12, 28);
      g.fillStyle = 'rgba(24,22,20,0.5)';
      g.beginPath(); g.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, rand(1, 3.2), 0, TAU); g.fill();
    }
  }, 1, 1);
  TEX.bulletHole.wrapS = TEX.bulletHole.wrapT = THREE.ClampToEdgeWrapping;

  // ---------- 106 腐蚀 ----------
  TEX.corrosion = mkTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * TAU, r = rand(0, 50);
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rr = rand(6, 24);
      const rg = g.createRadialGradient(x, y, 0, x, y, rr);
      rg.addColorStop(0, 'rgba(12,10,8,0.92)'); rg.addColorStop(0.65, 'rgba(28,20,10,0.55)'); rg.addColorStop(1, 'rgba(20,14,6,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
  }, 1, 1);
  TEX.corrosion.wrapS = TEX.corrosion.wrapT = THREE.ClampToEdgeWrapping;

  // ---------- 收容间编号牌 ----------
  TEX.signPlate = (label, sub, warn) => mkTex(512, 160, (g, w, h) => {
    g.fillStyle = warn ? '#7a1414' : '#1c2226'; g.fillRect(0, 0, w, h);
    g.strokeStyle = warn ? '#ffd23f' : '#c8c8c8'; g.lineWidth = 6;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = warn ? '#ffe9a8' : '#e8e8e8';
    g.font = 'bold 58px Consolas, monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label, 28, 56);
    g.fillStyle = warn ? '#ffd23f' : '#9aa0a4';
    g.font = '26px Consolas, monospace';
    g.fillText(sub || '', 30, 112);
  }, 1, 1);

  // ---------- 屏幕（终端） ----------
  TEX.screen = (text, color) => mkTex(256, 192, (g, w, h) => {
    g.fillStyle = '#05100a'; g.fillRect(0, 0, w, h);
    g.fillStyle = color || '#39ff8a';
    g.font = '15px Consolas, monospace'; g.textAlign = 'left'; g.textBaseline = 'top';
    const lines = String(text || 'SITE-19 // ONLINE').split('\n');
    lines.forEach((L, i) => { if (i < 11) g.fillText(L, 10, 12 + i * 16); });
    // 扫描线
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1.4);
  }, 1, 1);

  // ---------- 户外：草地 / 泥土 / 木板（加州农场） ----------
  TEX.grass = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3b4a2c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const t = Math.random();
      g.fillStyle = `rgba(${(52 + t * 46) | 0},${(66 + t * 52) | 0},${(34 + t * 30) | 0},0.85)`;
      g.fillRect(x, y, rand(1, 3), rand(2, 6));
    }
    // 枯草斑
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(8, 34);
      const rg = g.createRadialGradient(x, y, 1, x, y, r);
      rg.addColorStop(0, 'rgba(96,86,44,0.34)'); rg.addColorStop(1, 'rgba(96,86,44,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
  }, 10, 10);

  TEX.dirt = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a3f31'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4200, 0.02, 0.12, 3.6);
    // 车辙
    for (let i = 0; i < 5; i++) {
      const y = rand(0, h);
      g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = rand(3, 8);
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + rand(-14, 14)); g.stroke();
    }
  }, 8, 8);

  TEX.wood = mkTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5a4530'; g.fillRect(0, 0, w, h);
    // 木板条
    for (let i = 0; i < 6; i++) {
      const y = i * (h / 6);
      g.fillStyle = `rgb(${(78 + Math.random() * 26) | 0},${(58 + Math.random() * 20) | 0},${(38 + Math.random() * 16) | 0})`;
      g.fillRect(0, y + 1.5, w, h / 6 - 3);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, w, 2);
      // 木纹
      for (let k = 0; k < 18; k++) {
        g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 1;
        const yy = y + rand(4, h / 6 - 4);
        g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy + rand(-3, 3)); g.stroke();
      }
    }
    speckle(g, w, h, 900, 0.02, 0.08, 2.6);
  }, 2, 2);

  // ---------- 一张拍到 SCP-096 面部的照片（收容行动任务道具） ----------
  TEX.photo096 = mkTex(160, 120, (g, w, h) => {
    // 相纸
    g.fillStyle = '#e6e0d2'; g.fillRect(0, 0, w, h);
    // 画面区域
    const px = 10, py = 8, pw = w - 20, ph = h - 26;
    const sky = g.createLinearGradient(0, py, 0, py + ph);
    sky.addColorStop(0, '#8a9aa8'); sky.addColorStop(0.6, '#6a7684'); sky.addColorStop(1, '#4a545e');
    g.fillStyle = sky; g.fillRect(px, py, pw, ph);
    // 远处树林
    g.fillStyle = '#2e3a2a';
    for (let i = 0; i < 9; i++) {
      const tx = px + i * (pw / 8), th = 10 + Math.random() * 14;
      g.beginPath(); g.moveTo(tx, py + ph); g.lineTo(tx + 8, py + ph - th); g.lineTo(tx + 16, py + ph); g.closePath(); g.fill();
    }
    // 中央：SCP-096 的面部特写（过曝、发白）
    const cx = px + pw / 2, cy = py + ph * 0.46;
    const face = g.createRadialGradient(cx, cy, 3, cx, cy + 4, 30);
    face.addColorStop(0, '#fbf6ec'); face.addColorStop(0.5, '#e8dfd0'); face.addColorStop(1, '#b9ad99');
    g.fillStyle = face;
    g.beginPath(); g.ellipse(cx, cy, 17, 22, 0, 0, TAU); g.fill();
    // 拉长的下颌 / 张开的嘴
    g.fillStyle = '#2a1c17';
    g.beginPath(); g.ellipse(cx, cy + 13, 6.5, 10, 0, 0, TAU); g.fill();
    g.fillStyle = '#6a3a34';
    g.beginPath(); g.ellipse(cx, cy + 11, 4.5, 6, 0, 0, TAU); g.fill();
    // 极长的双臂（从两侧垂下）
    g.fillStyle = '#e4dbcb';
    g.fillRect(cx - 30, cy + 6, 5, 46);
    g.fillRect(cx + 25, cy + 6, 5, 46);
    // 过曝高光
    const gl = g.createRadialGradient(cx - 6, cy - 8, 1, cx - 6, cy - 8, 16);
    gl.addColorStop(0, 'rgba(255,255,255,0.75)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(px, py, pw, ph);
    // 老照片颗粒 + 折痕
    speckle(g, w, h, 1600, 0.02, 0.14, 1.6);
    g.strokeStyle = 'rgba(120,110,95,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px + 6, py); g.lineTo(px + pw - 10, py + ph); g.stroke();
    // 底部手写标注
    g.fillStyle = '#3a3630';
    g.font = 'italic 11px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CA · 09/26', w / 2, h - 12);
  }, 1, 1);
  TEX.photo096.wrapS = TEX.photo096.wrapT = THREE.ClampToEdgeWrapping;

  // ---------- Project SCRAMBLE 的面部打码贴图 ----------  // 在 SCP-096 头部位置贴一张"马赛克 + 锁定框"的公告板，模拟视觉干扰装置把脸糊掉
  TEX.scrambleFace = mkTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const N = 11, cs = w / N;
    // 肤色系随机马赛克块
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = Math.random();
      const r = (168 + t * 78) | 0, gg = (140 + t * 70) | 0, b = (122 + t * 62) | 0;
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x * cs, y * cs, cs + 1, cs + 1);
    }
    // 块间暗缝
    g.strokeStyle = 'rgba(10,10,10,0.45)'; g.lineWidth = 1.2;
    for (let i = 0; i <= N; i++) {
      g.beginPath(); g.moveTo(i * cs, 0); g.lineTo(i * cs, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * cs); g.lineTo(w, i * cs); g.stroke();
    }
    // 四周压暗（做成一块"贴片"的感觉）
    const vg = g.createRadialGradient(64, 64, 26, 64, 64, 66);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    // 锁定框 + 四角
    g.strokeStyle = 'rgba(96,224,255,0.92)'; g.lineWidth = 2.4;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.lineWidth = 3.6;
    const K = 16;
    for (const [cx, cy, dx, dy] of [[8, 8, 1, 1], [w - 8, 8, -1, 1], [8, h - 8, 1, -1], [w - 8, h - 8, -1, -1]]) {
      g.beginPath(); g.moveTo(cx + dx * K, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * K); g.stroke();
    }
    // 中心十字
    g.strokeStyle = 'rgba(96,224,255,0.7)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(64, 52); g.lineTo(64, 76); g.moveTo(52, 64); g.lineTo(76, 64); g.stroke();
  }, 1, 1);
  TEX.scrambleFace.wrapS = TEX.scrambleFace.wrapT = THREE.ClampToEdgeWrapping;
}

bootMark('textures');
