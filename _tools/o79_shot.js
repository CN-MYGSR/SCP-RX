'use strict';
/* SCP-079 视角截图：node _tools/o79_shot.js */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8813;
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
  const ud = path.join(os.tmpdir(), 'scprx-o79s-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9359', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9359/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
      const pg = list.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await wait(250);
  }
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  const send = (mth, prm) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: mth, params: prm || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + mth)); } }, 40000); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description); return r.result ? r.result.value : undefined; };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=o79' });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5200);
    // 摆个场面：跳到一条有门的走廊，锁门 + 升级 + 攒点 EXP
    await ev(`(function(){
      let idx = AI079.cams.findIndex(c => /仓库|武器库|办公|安保/.test(c.name) && FAC.doors.some(d => d.room && d.room.id === c.id));
      if (idx < 0) idx = 0;
      o79Goto(idx);
      AI079.tier = 3; AI079.exp = 40; AI079.ap = 96;
      AI079.teslaKills = 3;
      o79LockToggle();
      player.pitch = -0.16;
    })()`);
    await wait(1400);
    await ev('AI079.ap = 88; AI079.exp = 62;');
    await wait(400);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(ROOT, '_tools', 'shots', 'o79.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
    console.log('已保存 ' + out);
  } catch (e) { console.error('异常:', e.message); }
  finally { ws.close(); chrome.kill(); server.close(); }
})();
