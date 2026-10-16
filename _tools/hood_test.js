'use strict';
/* =====================================================================
   落锤行动 · SCP-096 收容改造验证
   要点：① 打不死（免疫一切伤害）② 靠近长按 F 戴头套 = 收容
        ③ 戴套后不再暴走/攻击 ④ 计入清剿进度 ⑤ 暴走有平静兜底
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8801;
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
  const ud = path.join(os.tmpdir(), 'scprx-hood-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9347', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9347/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await wait(3500);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(300);
    await ev(`document.querySelector('#missionRow .presetCard[data-m="breach"]').click()`);
    await wait(200);
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);
    await ev('DEBUG.god = true; player.hp = player.maxHp;');

    // ① 打不死
    const t1 = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      s.enraged = true; s.rageT = 0.95;          // 连暴走状态下也免疫
      const before = s.hp, aliveBefore = s.alive;
      let total = 0;
      for (let i=0;i<60;i++) total += damageSCP(s, 500, { byPlayer: true, head: true });
      return { 定义immortal: !!s.def.immortal, 尝试总伤害: total,
               hp不变: s.hp === before, hp: s.hp, 仍然存活: s.alive === aliveBefore && s.alive,
               contained: !!GAME.contained['096'] };
    })()`);
    console.log('① 打不死:', JSON.stringify(t1));

    // ② 靠近识别 + 戴头套
    const t2 = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      s.enraged = false; s.rageT = 0; s.hooded = false;
      player.pos.set(s.pos.x, 0, s.pos.z + 2.2);
      player.yaw = 0;
      player.scanInteract();
      const it = player.interact;
      const found = !!(it && it.hood096);
      const hasHold = !!(it && it.holdNeed > 0);
      // 走完整的"按住 F"路径
      player.interactHold = 0;
      let frames = 0;
      while (frames < 120 && !s.hooded) {
        frames++;
        player.interactHold += 0.05;
        if (player.interactHold >= player.interact.holdNeed) { completeInteract(player.interact); player.interactHold = 0; }
      }
      return { 识别到096: found, 有holdNeed: hasHold, 按住帧数: frames,
               hooded: s.hooded, 头套可见: !!(s.model.hood && s.model.hood.visible),
               contained: !!GAME.contained['096'],
               清剿进度: Object.keys(GAME.contained).length + ' / ' + SCP_ORDER.length,
               击杀数: player.kills, 目标链: objectiveStatus().purge };
    })()`);
    console.log('② 按住F戴头套:', JSON.stringify(t2));

    // ③ 戴套后不再暴走 / 不攻击
    const t3 = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      s.enraged = false; s.rageT = 0.99; s.enrageT = 0;
      const hpBefore = player.hp;
      return { 强制顶满rageT: s.rageT, 玩家HP: hpBefore };
    })()`);
    await wait(2500);
    const t3b = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      return { enraged: s.enraged, rageT: +s.rageT.toFixed(2), state: s.state, 玩家HP: player.hp };
    })()`);
    console.log('③ 戴套后直视:', JSON.stringify(t3), '→', JSON.stringify(t3b));

    // ④ 暴走平静兜底（无头浏览器帧率极低，直接顶过阈值，只验判定本身）
    const t4 = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      s.hooded = false; GAME.contained['096'] = false;
      if (s.model.hood) s.model.hood.visible = false;
      s.enraged = true; s.state = 'enraged';
      s.target = player;
      s.def.calmAfter = 1.0;
      s.enrageT = 5;                    // 已远超 calmAfter
      return { 暴走中: s.enraged, enrageT: s.enrageT, calmAfter: s.def.calmAfter };
    })()`);
    await wait(2000);
    const t4b = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      const r = { enraged: s.enraged, state: s.state, enrageT: +(s.enrageT||0).toFixed(2), target: s.target ? 'still-set' : 'cleared' };
      s.def.calmAfter = 25;
      return r;
    })()`);
    console.log('④ 暴走平静兜底:', JSON.stringify(t4), '→', JSON.stringify(t4b));

    // ⑤ 农场的 096 同样打不死
    await ev('location.reload()');
    await wait(3500);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(300);
    await ev(`document.querySelector('#missionRow .presetCard[data-m="contain096"]').click()`);
    await wait(200);
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);
    const t5 = await ev(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      s.enraged = true; s.rageT = 0.95;
      const before = s.hp;
      let total = 0;
      for (let i=0;i<40;i++) total += damageSCP(s, 500, { byPlayer: true });
      return { mission: GAME.mission, 定义immortal: !!s.def.immortal, 尝试总伤害: total, hp不变: s.hp === before, 存活: s.alive };
    })()`);
    console.log('⑤ 农场 096:', JSON.stringify(t5));

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
