'use strict';
/* 菜单界面截图：主菜单 / 简报 / 图鉴 / 设置 */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8793;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const OUT = path.join(ROOT, '_tools', 'shots'); if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
(async () => {
  const server = http.createServer((req, rq) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end(); return; }
    rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(rq);
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const ud = path.join(os.tmpdir(), 'scprx-menu-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9337', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9337/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
      const pg = list.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await new Promise(r => setTimeout(r, 250));
  }
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 100 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  const send = (mth, prm) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: mth, params: prm || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout')); } }, 30000); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description); return r.result.value; };
  const shot = async n => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(s.data, 'base64')); console.log('已保存', n); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await new Promise(r => setTimeout(r, 3500));
  await shot('menu-00-home');
  await ev('document.querySelector("[data-p=mBrief]").click()'); await new Promise(r => setTimeout(r, 400)); await shot('menu-01-brief');
  await ev('document.querySelectorAll(".backBtn")[0].click()'); await new Promise(r => setTimeout(r, 300));
  await ev('document.querySelector("[data-p=mCodex]").click()'); await new Promise(r => setTimeout(r, 400)); await shot('menu-02-codex');
  await ev('document.querySelectorAll(".backBtn")[0].click()'); await new Promise(r => setTimeout(r, 300));
  await ev('document.querySelector("[data-p=mSet]").click()'); await new Promise(r => setTimeout(r, 400)); await shot('menu-03-settings');
  await ev('document.querySelectorAll(".backBtn")[0].click()'); await new Promise(r => setTimeout(r, 300));
  await ev('document.querySelector("[data-p=mLoadout]").click()'); await new Promise(r => setTimeout(r, 500)); await shot('menu-04-loadout');
  ws.close(); chrome.kill(); server.close(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
