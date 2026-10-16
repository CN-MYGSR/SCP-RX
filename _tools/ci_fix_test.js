'use strict';
/* =====================================================================
   两个 bug 的验证
   ① 结算面板按身份显示各自的目标进度（不再一律套 MTF 那一套）
   ② 混沌分裂者可以攻击科学家 / 保安 / D 级
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8823;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg' };
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
  const ud = path.join(os.tmpdir(), 'scprx-ci-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9369', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9369/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
  const errs = [];
  const collect = () => {
    for (const e of events) {
      if (e.method === 'Runtime.exceptionThrown') { const d = e.params.exceptionDetails; errs.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text)); }
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') errs.push('ERROR: ' + e.params.args.map(a => a.value || a.description || a.type).join(' '));
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push('LOG: ' + e.params.entry.text);
    }
    events.length = 0;
  };
  const boot = async (role) => {
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=' + role });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("go") && 0; document.getElementById("deployGo").click()');
    await wait(5200);
    await ev('(function(){ if (!GAME.mtfDeployed) { GAME.elapsed = 61; checkMtfDeploy(); } })()');
    await wait(700);
  };
  // 触发失败结算并回读面板
  const failScreen = async () => ev(`(function(){
    GAME.over = false;
    endGame(false, '测试原因');
    const stats = (document.getElementById('endStats')||{}).innerText || '';
    return { 标题: (document.getElementById('endTitle')||{}).textContent,
             副标题: (document.getElementById('endSub')||{}).textContent,
             身份行: (document.getElementById('endRole')||{}).textContent,
             统计: stats.replace(/\\s*\\n\\s*/g, ' | ').slice(0, 200) };
  })()`);

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

    // ② CI 能不能打科学家
    await boot('ci');
    const t1 = await ev(`(function(){
      const out = {};
      // 每个目标摆到不同方向，避免互相挡住射线
      const dirs = { scientist: [0, -5], guard: [5, 0], classd: [-5, 0], mtf: [0, 5] };
      const targets = {};
      for (const kind of ['scientist', 'guard', 'classd']) {
        const p = PERSONNEL_LIST.find(x => x.kind === kind && x.alive && !x.escaped);
        if (p) targets[kind] = p;
      }
      const a = ALLY_LIST.find(x => x.alive);
      if (a) targets.mtf = a;
      // 先把所有人挪远，再逐个测
      for (const k in targets) targets[k].pos.set(999, 0, 999 + Object.keys(targets).indexOf(k) * 3);
      for (const k in targets) {
        const d = dirs[k] || [0, -5];
        const m = Math.max(0.001, Math.hypot(d[0], d[1]));
        const dx = d[0] / m, dz = d[1] / m;
        targets[k].pos.set(player.pos.x + dx * 5, 0, player.pos.z + dz * 5);
        const hit = raycastSCPs(V3(player.pos.x, player.pos.y + 1.2, player.pos.z), V3(dx, 0, dz), 40);
        out[k] = hit ? (hit.isHostile ? (hit.ent === targets[k] ? '✅ 可命中' : '命中了别人') : '命中了SCP') : '没打中';
        targets[k].pos.set(999, 0, 999 + Object.keys(targets).indexOf(k) * 3);   // 挪开再测下一个
      }
      return { 玩家阵营: currentRole().side, 命中: out };
    })()`);
    console.log('② CI 可攻击对象:', JSON.stringify(t1));

    // ① CI 的失败结算
    const t2 = await failScreen();
    console.log('① CI 失败结算:', JSON.stringify(t2));
    console.log('   含"收容进度"?', /收容进度/.test(t2.统计) ? '❌ 有（不该有）' : '✅ 没有');
    console.log('   含"清除基金会人员"?', /清除基金会人员/.test(t2.统计) ? '✅ 有' : '❌ 没有');

    // ① 其他身份的结算
    for (const r of ['mtf', 'guard', 'scientist', 'classd', 'p173']) {
      await boot(r);
      const t = await failScreen();
      console.log('① ' + r + ':', JSON.stringify({ 标题: t.标题, 副标题: t.副标题, 统计: t.统计.slice(0, 110) }));
    }

    collect();
  } catch (e) {
    console.error('测试异常:', e.message);
    errs.push('HARNESS: ' + e.message);
  } finally {
    ws.close(); chrome.kill(); server.close();
  }
  console.log('\n================ 控制台错误 ================');
  if (!errs.length) console.log('✅ 无错误');
  else [...new Set(errs)].slice(0, 20).forEach(e => console.log('  ❌ ' + e));
  process.exit(errs.length ? 1 : 0);
})();
