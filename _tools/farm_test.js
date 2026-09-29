'use strict';
/* =====================================================================
   收容行动（SCP-096 农场）专项验证
   用法: node _tools/farm_test.js [--shots]
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8797;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const SHOTS = process.argv.includes('--shots');
const OUT = path.join(ROOT, '_tools', 'shots');
if (SHOTS && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req, rq) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end(); return; }
    rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(rq);
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const ud = path.join(os.tmpdir(), 'scprx-farm-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9341', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9341/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
      const pg = list.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await wait(250);
  }
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map(); const events = [];
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) events.push(m); });
  const send = (mth, prm) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: mth, params: prm || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + mth)); } }, 60000); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async n => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(s.data, 'base64')); console.log('  📷 ' + n); };
  const errs = [];
  const collect = () => {
    for (const e of events) {
      if (e.method === 'Runtime.exceptionThrown') { const d = e.params.exceptionDetails; errs.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text)); }
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') errs.push('ERROR: ' + e.params.args.map(a => a.value || a.description || a.type).join(' '));
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push('LOG: ' + e.params.entry.text);
    }
    events.length = 0;
  };

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1' });
    await wait(3500);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    const missions = await ev('(function(){ return Array.from(document.querySelectorAll("#missionRow .presetCard")).map(c=>c.dataset.m); })()');
    console.log('可选行动:', JSON.stringify(missions));
    await ev(`document.querySelector('#missionRow .presetCard[data-m="contain096"]').click()`);
    await wait(300);
    console.log('当前行动:', await ev('GAME.mission'));
    if (SHOTS) await shot('farm-00-loadout');
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);
    // 测试期间免伤：SCP-096 暴走后会秒杀玩家，否则后续用例全部失真
    await ev('DEBUG.god = true; player.hp = player.maxHp;');

    const world = await ev(`({
      mode: FAC.mode, mission: GAME.mission,
      photos: PHOTOS.length, boxes: BOXES.length, cyls: CYLS.length,
      lights: LIGHT_SOURCES.length, navReady: NAV.ready,
      scps: SCP_LIST.length, scpKeys: SCP_LIST.map(s=>s.key),
      allies: ALLY_LIST.length, pickups: PICKUPS.length,
      spawn: [+FAC.spawn.x.toFixed(0), +FAC.spawn.z.toFixed(0)],
      extract: FAC.extract ? [+FAC.extract.x.toFixed(0), +FAC.extract.z.toFixed(0)] : null,
      rooms: FAC.rooms.map(r=>r.id),
      obj: objectiveStatus(), extractReady: extractReady(),
    })`);
    console.log('农场世界:', JSON.stringify(world));

    // ---- 导航连通性 ----
    const nav = await ev(`(function(){
      const N = NAV.N, grid = NAV.grid, off = NAV.off, res = NAV.res;
      const start = navIdx(FAC.spawn.x, FAC.spawn.z);
      if (grid[start] === 1) return { err: '出生点被阻挡' };
      const seen = new Uint8Array(N*N); const st = [start]; seen[start] = 1; let n = 1;
      const DX=[1,-1,0,0,1,1,-1,-1], DY=[0,0,1,-1,1,-1,1,-1];
      while (st.length) {
        const cur = st.pop(); const cx = cur % N, cy = (cur-cx)/N;
        for (let d=0; d<8; d++) {
          const nx = cx+DX[d], ny = cy+DY[d];
          if (nx<0||ny<0||nx>=N||ny>=N) continue;
          const ni = ny*N+nx;
          if (seen[ni] || grid[ni]===1) continue;
          if (d>=4 && (grid[cy*N+nx]===1 || grid[ny*N+cx]===1)) continue;
          seen[ni]=1; n++; st.push(ni);
        }
      }
      const checks = [];
      const chk = (name, x, z) => checks.push(name + (seen[navIdx(x,z)] ? '✓' : '✗'));
      chk('096', 0, -32);
      for (const p of PHOTOS) chk('照片' + p.idx, p.x, p.z);
      if (FAC.extract) chk('撤离', FAC.extract.x, FAC.extract.z);
      chk('农舍内', FARM.house.x, FARM.house.z);
      chk('谷仓内', FARM.barn.x, FARM.barn.z);
      let open = 0; for (let i=0;i<grid.length;i++) if (grid[i]===0) open++;
      return { reachable: n, open: open, checks: checks.join(' ') };
    })()`);
    console.log('导航连通性:', JSON.stringify(nav));

    // ---- 路径：从出生点走到 096 ----
    const pathTest = await ev(`(function(){
      const buf = makePathBuf();
      const ok = navPath(FAC.spawn.x, FAC.spawn.z, 0, -32, buf);
      const buf2 = makePathBuf();
      const ok2 = navPath(FAC.spawn.x, FAC.spawn.z, FAC.extract.x, FAC.extract.z, buf2);
      return { 到096: ok ? buf.n + ' 路点' : '失败', 到撤离点: ok2 ? buf2.n + ' 路点' : '失败' };
    })()`);
    console.log('寻路:', JSON.stringify(pathTest));

    // ---- 直视 096 会暴走 ----
    const look1 = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      player.pos.set(s.pos.x, 0, s.pos.z + 9);
      player.yaw = 0; player.pitch = 0.12;
      s.enraged = false; s.rageT = 0; s.hooded = false; s.awake = true;
      return { 距离: +Math.hypot(s.pos.x-player.pos.x, s.pos.z-player.pos.z).toFixed(1) };
    })()`);
    await wait(3500);
    const look2 = await ev(`(function(){ const s = SCP_LIST.find(v=>v.key==='096'); return { enraged: s.enraged, rageT: +s.rageT.toFixed(2) }; })()`);
    console.log('直视 SCP-096:', JSON.stringify(look1), '→', JSON.stringify(look2));

    // ---- 戴头套 ----
    const hood = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      s.enraged = false; s.rageT = 0; s.hooded = false;
      player.pos.set(s.pos.x, 0, s.pos.z + 2.2);
      player.yaw = 0;
      player.scanInteract();
      const found = !!(player.interact && player.interact.hood096);
      hoodSCP096();
      return { 交互识别到096: found, hooded: s.hooded, 头套可见: !!(s.model.hood && s.model.hood.visible), obj: objectiveStatus() };
    })()`);
    console.log('戴头套:', JSON.stringify(hood));
    if (SHOTS) await shot('farm-01-hooded');

    // 戴套之后再直视也不会暴走
    await ev(`(function(){ const s=SCP_LIST.find(v=>v.key==='096'); s.rageT=0.95; s.enraged=false; })()`);
    await wait(2000);
    const afterHood = await ev(`(function(){ const s=SCP_LIST.find(v=>v.key==='096'); return { enraged: s.enraged, rageT: +s.rageT.toFixed(2), state: s.state }; })()`);
    console.log('戴套后直视:', JSON.stringify(afterHood));

    // ---- 划照片：走完整的"按住 F"判定路径（不能直接调 destroyPhoto）----
    const photo = await ev(`(function(){
      const p = PHOTOS[0];
      player.pos.set(p.x, 0, p.z + 1.4);
      player.scanInteract();
      const it = player.interact;
      const found = !!(it && it.isPhoto);
      const hasHold = !!(it && typeof it.holdNeed === 'number' && it.holdNeed > 0);
      player.interactHold = 0;
      let frames = 0;
      while (frames < 80 && !p.done) {
        frames++;
        player.interactHold += 0.05;
        if (player.interactHold >= player.interact.holdNeed) {
          completeInteract(player.interact);
          player.interactHold = 0;
        }
      }
      return { 交互识别到照片: found, 有holdNeed: hasHold, 按住帧数: frames,
               done: p.done, 红叉可见: p.cross.visible, 剩余: PHOTOS.filter(q=>!q.done).length };
    })()`);
    console.log('划照片（按住F）:', JSON.stringify(photo));

    // ---- 撤离门控 ----
    const gate1 = await ev(`(function(){ return { 还有照片时: extractReady() }; })()`);
    const all = await ev(`(function(){
      for (const p of PHOTOS) if (!p.done) destroyPhoto(p);
      return { 全部销毁后: extractReady(), obj: objectiveStatus() };
    })()`);
    console.log('撤离门控:', JSON.stringify(gate1), '→', JSON.stringify(all));

    // ---- 撤离结算 ----
    const ex = await ev(`(function(){
      player.pos.set(FAC.extract.x, 0, FAC.extract.z + 3);
      player.scanInteract();
      const found = player.interact === FAC.extract;
      onExtractionDone();
      return { 识别到撤离点: found, over: GAME.over, won: GAME.won,
               endVisible: !document.getElementById('endScreen').classList.contains('hidden'),
               title: document.getElementById('endTitle').textContent };
    })()`);
    console.log('撤离:', JSON.stringify(ex));
    if (SHOTS) { await wait(600); await shot('farm-02-end'); }

    collect();
  } catch (e) {
    console.error('测试异常:', e.message);
    errs.push('HARNESS: ' + e.message);
  } finally {
    ws.close(); chrome.kill(); server.close();
  }
  console.log('\n================ 控制台错误 ================');
  if (!errs.length) console.log('✅ 无错误');
  else [...new Set(errs)].slice(0, 30).forEach(e => console.log('  ❌ ' + e));
  process.exit(errs.length ? 1 : 0);
})();
