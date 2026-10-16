'use strict';
/* =====================================================================
   行动音乐 + 全场警报 验证
   用法: node _tools/audio_test.js
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8799;
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
  const ud = path.join(os.tmpdir(), 'scprx-audio-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9343', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9343/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3500);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(300);

    // ---------- 落锤行动 ----------
    console.log('===== 落锤行动 =====');
    await ev(`document.querySelector('#missionRow .presetCard[data-m="breach"]').click()`);
    await wait(200);
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);
    const a1 = await ev(`({
      mission: GAME.mission, audioReady: AudioSys.ready(),
      ctxState: (function(){ try { return 'n/a'; } catch(e){ return 'err'; } })(),
      music: AudioSys.musicState(), alarm: AudioSys.alarmOn(),
    })`);
    console.log('开局 5 秒:', JSON.stringify(a1));

    await wait(6000);
    const a2 = await ev(`({ music: AudioSys.musicState(), alarm: AudioSys.alarmOn() })`);
    console.log('再等 6 秒:', JSON.stringify(a2));
    const advanced = a2.music.t > a1.music.t;
    console.log(advanced ? '  ✅ 音乐在推进（' + a1.music.t + 's → ' + a2.music.t + 's）' : '  ❌ 音乐没有推进');
    console.log(a2.alarm ? '  ✅ 警报在响' : '  ❌ 警报没响');

    // ---------- 暂停 ----------
    await ev('showPauseOverlay(true)');
    await wait(600);
    const a3 = await ev(`({ music: AudioSys.musicState(), alarm: AudioSys.alarmOn() })`);
    console.log('暂停后:', JSON.stringify(a3));
    console.log((!a3.alarm && a3.music.vol < a2.music.vol) ? '  ✅ 警报停、音乐压低' : '  ❌ 暂停处理不正确');
    await ev('showPauseOverlay(false)');
    await wait(600);
    const a4 = await ev(`({ music: AudioSys.musicState(), alarm: AudioSys.alarmOn() })`);
    console.log('恢复后:', JSON.stringify(a4));
    console.log((a4.alarm && Math.abs(a4.music.vol - a2.music.vol) < 0.02) ? '  ✅ 警报恢复、音量还原' : '  ❌ 恢复不正确');

    // ---------- 结算 ----------
    await ev('endGame(true, "test")');
    await wait(2600);
    const a5 = await ev(`({ music: AudioSys.musicState(), alarm: AudioSys.alarmOn() })`);
    console.log('结算后:', JSON.stringify(a5));
    console.log((!a5.alarm && a5.music.paused) ? '  ✅ 音乐已停、警报已停' : '  ❌ 结算后没有正确停止');

    // ---------- 收容行动（不应该有入场曲和警报）----------
    console.log('\n===== 收容行动 =====');
    await ev('location.reload()');
    await wait(3500);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(300);
    await ev(`document.querySelector('#missionRow .presetCard[data-m="contain096"]').click()`);
    await wait(200);
    await ev('document.getElementById("deployGo").click()');
    await wait(5500);
    const f1 = await ev(`({ mission: GAME.mission, music: AudioSys.musicState(), alarm: AudioSys.alarmOn() })`);
    console.log('农场开局:', JSON.stringify(f1));
    console.log((f1.mission === 'contain096' && !f1.alarm && !(f1.music.exists && !f1.music.paused)) ? '  ✅ 农场没有入场曲/警报' : '  ❌ 农场不应播放入场曲或警报');

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
