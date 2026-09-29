'use strict';
/* =====================================================================
   性能剖析 —— 无头 Chrome 里跑真实帧管线，分离 CPU 各子系统耗时与 GC 压力
   用法: node _tools/bench.js
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8795;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const N = 240;

(async () => {
  const server = http.createServer((req, rq) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end(); return; }
    rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(rq);
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const ud = path.join(os.tmpdir(), 'scprx-bench-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9339', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--js-flags=--expose-gc', '--enable-precise-memory-info',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9339/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
      const pg = list.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await new Promise(r => setTimeout(r, 250));
  }
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 100 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  const send = (mth, prm) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: mth, params: prm || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + mth)); } }, 180000); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true, awaitPromise: false });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1' });
  await new Promise(r => setTimeout(r, 3500));
  await ev('document.querySelector("[data-p=mLoadout]").click()');
  await new Promise(r => setTimeout(r, 300));
  await ev('document.getElementById("deployGo").click()');
  await new Promise(r => setTimeout(r, 4500));

  // 把所有 SCP / 队友拉到玩家附近，制造最坏负载
  await ev(`(function(){
    let i=0;
    for(const s of SCP_LIST){ s.awake=true; s.pos.set(player.pos.x + Math.cos(i*0.7)*14, 0, player.pos.z + Math.sin(i*0.7)*14); i++; }
    i=0;
    for(const a of ALLY_LIST){ a.pos.set(player.pos.x + Math.cos(i*1.3)*6, 0, player.pos.z + Math.sin(i*1.3)*6); i++; }
    for(let k=0;k<8;k++) spawnMinion(player.pos.x + Math.cos(k)*9, player.pos.z + Math.sin(k)*9);
    for(let k=0;k<40;k++) spawnPickup('ammo_rifle', player.pos.x + Math.cos(k)*8, player.pos.z + Math.sin(k)*8);
    GAME.protocol = true;
    return SCP_LIST.length + '/' + MINIONS.length + '/' + PICKUPS.length;
  })()`);
  await new Promise(r => setTimeout(r, 800));

  const res = await ev(`(function(){
    const N = ${N};
    const t = {};
    let t0;
    if (window.gc) { window.gc(); }
    const memOf = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);

    // ---- 1. 寻路（最大的可疑点：每次调用都新建两张全网格数组）----
    // 用真实房间中心做目标，避免目标落在墙里导致提前 return 的假快
    const buf = makePathBuf();
    const tg = [];
    for (const r of FAC.rooms) tg.push([r.cx, r.cz]);
    for (const c of LAYOUT.corridors) { const rc = c.rect; tg.push([cellX((rc[0]+rc[1])/2), cellZ((rc[2]+rc[3])/2)]); }
    let ok = 0, wpSum = 0;
    navDbgReset();
    if (window.gc) window.gc();
    let m0 = memOf();
    t0 = performance.now();
    for (let i = 0; i < 150; i++) {
      const a = tg[i % tg.length], b = tg[(i * 5 + 7) % tg.length];
      if (navPath(a[0], a[1], b[0], b[1], buf)) { ok++; wpSum += buf.n; }
    }
    t.navPath_ms_per_call = (performance.now() - t0) / 150;
    t.navPath_ok = ok + '/150';
    t.navPath_avg_waypoints = ok ? (wpSum / ok).toFixed(1) : 0;
    // 出生点为什么被挡？
    t.spawnBlockers = BOXES.filter(b => {
      if (b.noNav) return false;
      if (b.maxY < 0.5 || b.minY > 1.9) return false;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      return Math.abs(cx - FAC.spawn.x) < 4 && Math.abs(cz - FAC.spawn.z) < 4;
    }).map(b => ({
      cx: +((b.minX + b.maxX) / 2).toFixed(1), cz: +((b.minZ + b.maxZ) / 2).toFixed(1),
      w: +(b.maxX - b.minX).toFixed(1), h: +(b.maxY - b.minY).toFixed(1),
      d: +(b.maxZ - b.minZ).toFixed(1), wall: !!b.wall,
    }));
    t.spawnCellOpen = FAC.open[idxOf(
      Math.round(FAC.spawn.x / CELL + GW / 2 - 0.5),
      Math.round(FAC.spawn.z / CELL + GH / 2 - 0.5))] === 1;

    // ---- 把设施结构 + 导航网格打印出来（直接看 FAC.open，避免采样偏差）----
    t.navAscii = (function () {
      const dump = (r0, r1) => {
        let s = '';
        for (let r = r0; r <= r1; r++) {
          let line = String(r).padStart(2, '0') + ' ';
          for (let c = 0; c < GW; c++) {
            const open = FAC.open[idxOf(c, r)] === 1;
            const nav = navBlocked(cellX(c), cellZ(r));
            line += open ? (nav ? 'o' : '.') : '#';
          }
          s += line + String.fromCharCode(10);
        }
        return s;
      };
      const NL = String.fromCharCode(10);
      return '重收容区' + NL + dump(3, 33) + '轻收容区' + NL + dump(34, 49) + '办公区' + NL + dump(50, 70);
    })();
    t.repairLog = (NAV.repairLog && NAV.repairLog.log) ? NAV.repairLog.log : [];
    t.repairCleared = NAV.repairLog ? NAV.repairLog.cleared : -1;
    t.navDbg = JSON.parse(JSON.stringify(navPath.dbg));
    t.navGridOpen = (function () { let c = 0; for (let i = 0; i < NAV.grid.length; i++) if (NAV.grid[i] === 0) c++; return c; })();

    // ---- 连通性：从玩家出生点洪泛（8 向，与 A* 同规则），看能到达多少格 / 各房间是否可达 ----
    t.connectivity = (function () {
      const N = NAV.N, grid = NAV.grid;
      const start = navIdx(FAC.spawn.x, FAC.spawn.z);
      const seen = new Uint8Array(N * N);
      if (grid[start] === 1) return { err: '出生点被标记为阻挡' };
      const stack = [start]; seen[start] = 1;
      let n = 1;
      const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
      while (stack.length) {
        const cur = stack.pop();
        const cx = cur % N, cy = (cur - cx) / N;
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const ni = ny * N + nx;
          if (seen[ni] || grid[ni] === 1) continue;
          if (d >= 4 && (grid[cy * N + nx] === 1 || grid[ny * N + cx] === 1)) continue;
          seen[ni] = 1; n++; stack.push(ni);
        }
      }
      let roomsOk = 0, roomsBad = [];
      for (const rm of FAC.rooms) {
        if (seen[navIdx(rm.cx, rm.cz)]) roomsOk++;
        else roomsBad.push(rm.id);
      }
      const marks = [];
      if (FAC.terminal) marks.push(['ALPHA', seen[navIdx(FAC.terminal.x, FAC.terminal.z)]]);
      if (FAC.extract) marks.push(['EXIT', seen[navIdx(FAC.extract.x, FAC.extract.z)]]);
      for (const b of FAC.breakers) marks.push(['PWR-' + b.id, seen[navIdx(b.x, b.z)]]);
      return {
        reachable: n, open: t.navGridOpen,
        roomsReachable: roomsOk + '/' + FAC.rooms.length, badRooms: roomsBad.slice(0, 8),
        keyPoints: marks.map(m => m[0] + (m[1] ? '✓' : '✗')).join(' '),
        repaired: NAV.repairLog ? NAV.repairLog.length : 0,
      };
    })();
    let m1 = memOf();
    t.navPath_KB_per_call = (m1 - m0) / 1024 / 150;

    // ---- 2. 各子系统单独计时 ----
    const sub = (name, fn, n) => { const a = performance.now(); for (let i = 0; i < n; i++) fn(0.016); t[name] = (performance.now() - a) / n; };
    sub('updatePlayer', updatePlayer, N);
    sub('updateSCPs', updateSCPs, N);
    sub('updateAllies', updateAllies, N);
    sub('updateDoors', updateDoors, N);
    sub('updatePickups', updatePickups, N);
    sub('updateFX', updateFX, N);
    sub('updateLightPool', (dt) => updateLightPool(player.pos.x, 1.6, player.pos.z), N);
    sub('updateCamera', updateCamera, N);
    sub('updateHUD', updateHUD, N);
    sub('VM.update', (dt) => VM.update(dt, player), N);

    // ---- 3. 整条更新管线 + 内存增长 ----
    if (window.gc) window.gc();
    m0 = memOf();
    t0 = performance.now();
    for (let i = 0; i < N; i++) {
      updatePlayer(0.016); updateSCPs(0.016); updateAllies(0.016);
      updateDoors(0.016); updatePickups(0.016); updateFX(0.016);
      updateLightPool(player.pos.x, 1.6, player.pos.z);
      updateCamera(0.016); updateHUD(0.016); VM.update(0.016, player);
    }
    t.pipeline_total_ms = (performance.now() - t0) / N;
    m1 = memOf();
    t.pipeline_KB_per_frame = (m1 - m0) / 1024 / N;

    // ---- 4. 渲染 ----
    t0 = performance.now();
    for (let i = 0; i < 60; i++) renderFrame();
    t.render_ms = (performance.now() - t0) / 60;

    // ---- 5. 渲染负载 ----
    t.drawCalls = (window.__lastInfo||{}).calls;
    t.triangles = (window.__lastInfo||{}).tris;
    t.perfScale = PERF.scale;
    t.perfAvgMs = PERF.lastAvg;
    t.pixelRatio = renderer.getPixelRatio();
    t.lightsOn = LIGHT_POOL.filter(L => L.visible).length;
    t.shadowMap = renderer.shadowMap.enabled;
    t.objects = scene.children.length;
    t.scpCount = SCP_LIST.length;
    t.minions = MINIONS.length;
    t.lightSources = LIGHT_SOURCES.length;
    t.boxes = BOXES.length;
    t.navCells = NAV.N * NAV.N;
    return t;
  })()`);

  console.log('\n================ 性能剖析（每帧 16.7ms 预算）================');
  const fmt = (v, u) => (typeof v === 'number' ? v.toFixed(3) + ' ' + (u || 'ms') : v);
  const rows = [
    ['寻路 navPath（每次）', res.navPath_ms_per_call, 'ms'],
    ['寻路 navPath（成功率）', res.navPath_ok, ''],
    ['寻路 navPath（平均路点）', res.navPath_avg_waypoints, ''],
    ['寻路 navPath（每次内存）', res.navPath_KB_per_call, 'KB'],
    ['updatePlayer', res.updatePlayer, 'ms'],
    ['updateSCPs', res.updateSCPs, 'ms'],
    ['updateAllies', res.updateAllies, 'ms'],
    ['updateDoors', res.updateDoors, 'ms'],
    ['updatePickups', res.updatePickups, 'ms'],
    ['updateFX', res.updateFX, 'ms'],
    ['updateLightPool', res.updateLightPool, 'ms'],
    ['updateCamera', res.updateCamera, 'ms'],
    ['updateHUD', res.updateHUD, 'ms'],
    ['VM.update', res['VM.update'], 'ms'],
    ['─────────────────', null],
    ['更新管线合计', res.pipeline_total_ms, 'ms'],
    ['更新管线每帧垃圾', res.pipeline_KB_per_frame, 'KB'],
    ['渲染 renderFrame', res.render_ms, 'ms'],
  ];
  for (const [k, v, u] of rows) {
    if (v === null) { console.log('  ' + k); continue; }
    console.log('  ' + k.padEnd(26, '　') + ' ' + String(fmt(v, u)).padStart(12));
  }
  console.log('\n  出生点: 设施格开放=' + res.spawnCellOpen + ' · 附近挡路碰撞体=' + JSON.stringify(res.spawnBlockers));
  console.log('  寻路诊断: ' + JSON.stringify(res.navDbg));
  console.log('  连通性: ' + JSON.stringify(res.connectivity));
  console.log('  修复: cleared=' + res.repairCleared + ' · 记录=' + JSON.stringify(res.repairLog));
  console.log('\n  设施结构（# 岩层/墙 · . 可走 · o 结构可走但导航判定为阻挡）：\n' + res.navAscii);
  console.log('  导航网格可走格数: ' + res.navGridOpen + ' / ' + res.navCells);
  console.log('\n  负载：draw calls ' + res.drawCalls + ' · 三角面 ' + res.triangles +
    ' · 场景对象 ' + res.objects + ' · SCP ' + res.scpCount + ' · 小怪 ' + res.minions +
    ' · 光源 ' + res.lightSources + ' · 碰撞体 ' + res.boxes + ' · 导航格 ' + res.navCells);
  console.log('  渲染设置：像素比 ' + res.pixelRatio.toFixed(2) + ' · 自适应倍率 ' + res.perfScale.toFixed(2) +
    ' · 实测帧时 ' + res.perfAvgMs.toFixed(1) + 'ms · 激活点光 ' + res.lightsOn + ' 盏 · 阴影 ' + (res.shadowMap ? '开' : '关'));
  console.log('\n  注：无头 SwiftShader 是软件光栅化，renderFrame 的绝对值不代表真实显卡；');
  console.log('      但 JS 侧耗时与 GC 压力是真实的，卡顿基本来自这里。');

  ws.close(); chrome.kill(); server.close(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
