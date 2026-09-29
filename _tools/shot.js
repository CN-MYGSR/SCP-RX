'use strict';
/* =====================================================================
   快速截图工具 —— 只做「加载 → 部署 → 按脚本摆姿势 → 截图」
   用法: node _tools/shot.js <名称> [setup表达式文件] [nopause]
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8791;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const NAME = process.argv[2] || 'shot';
const SETUP = process.argv[3] || '';
const OUT = path.join(ROOT, '_tools', 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

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

  const ud = path.join(os.tmpdir(), 'scprx-shot-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9335', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => {
        http.get('http://127.0.0.1:9335/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
      }));
      const pg = list.find(t => t.type === 'page');
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await new Promise(r => setTimeout(r, 250));
  }
  if (!wsUrl) { console.error('devtools 未就绪'); process.exit(1); }

  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 100 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 40000);
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1' });
  await new Promise(r => setTimeout(r, 3500));
  await ev('document.querySelector("[data-p=mLoadout]").click()');
  await new Promise(r => setTimeout(r, 300));
  // 可选：切换行动（--mission=contain096）
  const missionArg = process.argv.find(a => a.indexOf('--mission=') === 0);
  if (missionArg) {
    const mid = missionArg.split('=')[1];
    await ev(`(function(){
      const c = document.querySelector('#missionRow .presetCard[data-m="${mid}"]');
      if (c) c.click();
      return GAME.mission;
    })()`);
    await new Promise(r => setTimeout(r, 300));
    console.log('行动:', await ev('GAME.mission'));
  }
  await ev('document.getElementById("deployGo").click()');
  await new Promise(r => setTimeout(r, 4500));

  if (SETUP && fs.existsSync(SETUP)) {
    const code = fs.readFileSync(SETUP, 'utf8');
    await ev('(function(){' + code + '})()');
    await new Promise(r => setTimeout(r, 1400));
  }
  const st = await ev('JSON.stringify({phase:GAME.phase, calls:(window.__lastInfo||{}).calls, tris:(window.__lastInfo||{}).tris})');
  console.log('状态:', st);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, NAME + '.png'), Buffer.from(s.data, 'base64'));
  console.log('已保存 _tools/shots/' + NAME + '.png');

  ws.close(); chrome.kill(); server.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
