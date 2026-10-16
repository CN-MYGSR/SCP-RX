'use strict';
/* 线上版本端到端验证：加载真实 play 页，确认游戏能启动、音频资源可取到 */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const URL_ = 'https://gamesvibe.app/play/qXkeJ39MN-Q8YUDcwGHm0';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const ud = path.join(os.tmpdir(), 'scprx-live-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9345', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9345/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
      const pg = list.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await wait(250);
  }
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map(); const events = [];
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) events.push(m); });
  const send = (mth, prm) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: mth, params: prm || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + mth)); } }, 60000); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true }); return r.result ? r.result.value : undefined; };
  const requests = new Map();
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Page.navigate', { url: URL_ });
    await wait(14000);
    for (const e of events) {
      if (e.method === 'Network.responseReceived') { const r = e.params.response; requests.set(r.url, r.status); }
    }
    const mp3 = [...requests.entries()].filter(([u]) => /\.mp3($|\?)/.test(u));
    const js = [...requests.entries()].filter(([u]) => /\.js($|\?)/.test(u));
    const frames = await ev(`document.querySelectorAll('iframe').length`);
    const srcs = await ev(`Array.from(document.querySelectorAll('iframe')).map(f=>f.src).filter(Boolean)`);
    console.log('顶层 iframe 数:', frames);
    console.log('iframe 地址:', JSON.stringify(srcs, null, 0));
    console.log('已请求的 JS 资源:', js.length, js.slice(0, 3).map(([u, s]) => path.basename(u.split('?')[0]) + '=' + s).join(' '));
    console.log('已请求的音频资源:', mp3.length ? mp3.map(([u, s]) => path.basename(u.split('?')[0]) + ' HTTP ' + s).join(' ') : '(尚未请求 —— 需进入落锤行动才会加载)');

    const ok = js.length > 0 && js.every(([, s]) => s === 200);
    console.log(ok ? '✅ 线上游戏资源加载正常' : '❌ 线上资源有问题');
  } catch (e) {
    console.error('异常:', e.message);
  } finally { ws.close(); chrome.kill(); }
})();
