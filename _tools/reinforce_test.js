'use strict';
/* =====================================================================
   三支势力的增援验证：首次部署后每 30 秒补充
   ① CI 首次部署后 30 秒补人
   ② 蛇之手首次部署后 30 秒补人
   ③ MTF 首次部署后 30 秒补人
   ④ 上限生效（补到上限就不再补）
   ⑤ 补出来的人有独立编号
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8827;
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
  const ud = path.join(os.tmpdir(), 'scprx-rf-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9373', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9373/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);

    // ① MTF 增援（开局 60 秒部署，之后再等 30 秒补人）
    const m0 = await ev(`({ 时间: Math.round(GAME.elapsed), 队友: ALLY_LIST.length, 已部署: GAME.mtfDeployed })`);
    await ev('GAME.elapsed = 61;');
    await wait(1200);
    const m1 = await ev(`({ 时间: Math.round(GAME.elapsed), 队友: ALLY_LIST.length, 倒计时: +GAME.mtfReinforceT.toFixed(1) })`);
    console.log('③ MTF:', JSON.stringify(m0), '→ 61秒:', JSON.stringify(m1));
    // 杀掉两个队友，快进 31 秒
    await ev(`(function(){ let n=0; for (const a of ALLY_LIST) { if (a.alive && n<2) { a.alive=false; n++; } } return n; })()`);
    const before = await ev('ALLY_LIST.filter(a=>a.alive).length');
    await ev('GAME.mtfReinforceT = 0.5;');
    await wait(14000);
    const after = await ev(`({ 存活: ALLY_LIST.filter(a=>a.alive).length, 编号: ALLY_LIST.map(a=>a.name),
                               倒计时: +GAME.mtfReinforceT.toFixed(1) })`);
    console.log('   → 清掉两个后补人:', before, '→', JSON.stringify(after));

    // ② CI / 蛇之手 增援
    await ev('GAME.elapsed = 301;');
    await wait(1500);
    const c0 = await ev(`({ CI: factionAlive('ci'), 蛇手: factionAlive('hand'), ci倒计时: +FACTION_STATE.ciReinforceT.toFixed(1) })`);
    await ev('GAME.elapsed = 361;');
    await wait(1500);
    const c1 = await ev(`({ CI: factionAlive('ci'), 蛇手: factionAlive('hand'),
                            ci倒计时: +FACTION_STATE.ciReinforceT.toFixed(1),
                            蛇手倒计时: +FACTION_STATE.handReinforceT.toFixed(1) })`);
    console.log('① 首波:', JSON.stringify(c0), '→ 蛇手也到位:', JSON.stringify(c1));
    // 把 CI 杀到只剩 1 个，快进
    await ev(`(function(){ let n=0; for (const a of FACTION_LIST) { if (a.kind==='ci' && a.alive) { if (n>=1) a.alive=false; n++; } } return n; })()`);
    await ev('FACTION_STATE.ciReinforceT = 0.5; FACTION_STATE.handReinforceT = 0.5;');
    await wait(14000);
    const c2 = await ev(`({ CI: factionAlive('ci'), 蛇手: factionAlive('hand'),
                            CI名字: FACTION_LIST.filter(a=>a.kind==='ci').map(a=>a.name).join(','),
                            蛇手名字: FACTION_LIST.filter(a=>a.kind==='hand').map(a=>a.name).join(','),
                            CI波次: FACTION_STATE.ciWaves, 蛇手波次: FACTION_STATE.handWaves })`);
    console.log('   → 补人后:', JSON.stringify(c2));

    // ④ 上限：把所有人复活到上限，再触发一次，不该再补
    const cap = await ev(`(function(){
      for (const a of FACTION_LIST) a.alive = true;
      const ci = factionAlive('ci'), hand = factionAlive('hand');
      FACTION_STATE.ciReinforceT = 0.2; FACTION_STATE.handReinforceT = 0.2;
      return { 补前CI: ci, 补前蛇手: hand, 上限CI: FACTION_REINFORCE.ci.max, 上限蛇手: FACTION_REINFORCE.hand.max };
    })()`);
    await wait(12000);
    const cap2 = await ev(`({ 补后CI: factionAlive('ci'), 补后蛇手: factionAlive('hand') })`);
    console.log('④ 上限:', JSON.stringify(cap), '→', JSON.stringify(cap2));

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
