'use strict';
/* =====================================================================
   本轮五项改动验证
   ① Class-D 时 MTF 敌对（会打你，你也能打他们）
   ② MTF 开局 1 分钟后才部署
   ③ 撤离后转第二身份（classd→ci / scientist→mtf_spec / guard→mtf_assault）
   ④ 随机角色不可重抽（菜单里没有重抽按钮）
   ⑤ 菜单不透露身份，局内才显示「你是 XXX」
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8815;
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
  const ud = path.join(os.tmpdir(), 'scprx-2nd-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9361', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9361/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
  };
  const deploy = async () => {
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);
  };

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

    // ④⑤ 菜单：不该出现重抽按钮，也不该写本次角色
    await boot('classd');
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(600);
    const menu = await ev(`({
      有重抽按钮: !!document.getElementById('roleReroll'),
      菜单文本: (document.getElementById('missionDesc').innerText || '').replace(/\\s+/g,' ').slice(0, 120),
      提到ClassD: /Class-D/.test(document.getElementById('missionDesc').innerText || ''),
      提到079: /079/.test(document.getElementById('missionDesc').innerText || ''),
      横幅隐藏: (document.getElementById('roleBanner')||{}).style?.display === 'none',
    })`);
    console.log('④⑤ 菜单不透露身份:', JSON.stringify(menu));

    // ② MTF 1 分钟后部署（开局时不该有队友）
    await ev('document.getElementById("deployGo").click()');
    await wait(4500);
    const early = await ev(`({
      时间: Math.round(GAME.elapsed), 队友数: ALLY_LIST.length,
      已部署标记: GAME.mtfDeployed, 身份: currentRole().name,
      身份行: (document.querySelector('#objList')||{}).innerText?.split('\\n')[0] || '',
    })`);
    console.log('② 开局(<60s):', JSON.stringify(early));
    await ev('GAME.elapsed = 61;');
    await wait(2000);
    const late = await ev(`({ 时间: Math.round(GAME.elapsed), 队友数: ALLY_LIST.length, 已部署标记: GAME.mtfDeployed })`);
    console.log('   快进到 61 秒:', JSON.stringify(late));

    // ① Class-D 时 MTF 敌对
    const hos = await ev(`(function(){
      const a = ALLY_LIST.find(x=>x.alive);
      if (!a) return { err: '没有队友' };
      player.hp = player.maxHp;
      a.retargetT = 0;
      a.pos.set(player.pos.x + 5, 0, player.pos.z);
      return { 玩家阵营: currentRole().side, 队友: a.callsign, 玩家HP: player.hp };
    })()`);
    console.log('① MTF 敌对性:', JSON.stringify(hos));
    await wait(2500);
    const hosB = await ev(`(function(){
      const a = ALLY_LIST.find(x=>x.alive);
      // 朝队友的真实方向打一发，确认射线把 MTF 也当成可命中目标
      const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z;
      const dd = Math.max(0.001, Math.hypot(dx, dz));
      const r = raycastSCPs(V3(player.pos.x, player.pos.y+1.2, player.pos.z), V3(dx/dd,0,dz/dd), 40);
      return { 玩家HP: Math.round(player.hp), 队友目标: a && a.target === player ? '玩家' : '其他',
               距离: +dd.toFixed(1),
               射线打队友: r ? (r.ent ? (r.ent.callsign || r.ent.name) : 'SCP') : '没打中',
               目标链: currentObjectives().map(o=>o.id) };
    })()`);
    console.log('   → 2.5 秒后:', JSON.stringify(hosB));

    // ③ 第二身份：classd → ci
    const sl = await ev(`(function(){
      GAME.extractCd = 0;
      const before = { 角色: currentRole().id, 武器: player.slots.map(s=>s.id) };
      onExtractionDone();
      return { 撤离前: before, 撤离后: { 角色: currentRole().id, 名称: currentRole().name,
               武器: player.slots.map(s=>s.id), 目标链: currentObjectives().map(o=>o.id),
               已用第二身份: GAME.secondLife, 游戏结束: GAME.over,
               阵营: currentRole().side, 撤离冷却: +GAME.extractCd.toFixed(1) } };
    })()`);
    console.log('③ Class-D 撤离 → CI:', JSON.stringify(sl));
    await wait(1200);
    const sl2 = await ev(`(function(){
      // 第二次撤离应该真的结束游戏
      GAME.extractCd = 0;
      GAME.contained = GAME.contained || {};
      for (const k in GAME.contained) delete GAME.contained[k];
      onExtractionDone();
      return { 结束: GAME.over, 胜利: GAME.won, 标题: (document.getElementById('endTitle')||{}).textContent };
    })()`);
    console.log('   → 第二身份再撤离:', JSON.stringify(sl2));

    // ③b 科学家 → mtf_spec
    await boot('scientist'); await deploy();
    const sl3 = await ev(`(function(){
      GAME.extractCd = 0; onExtractionDone();
      return { 角色: currentRole().id, 名称: currentRole().name, 武器: player.slots.map(s=>s.id),
               目标链: currentObjectives().map(o=>o.id), 护甲: ARMOR_DEFS[player.armor].name };
    })()`);
    console.log('③ 科学家撤离 →', JSON.stringify(sl3));

    // ③c 保安 → mtf_assault
    await boot('guard'); await deploy();
    const sl4 = await ev(`(function(){
      GAME.extractCd = 0; onExtractionDone();
      return { 角色: currentRole().id, 名称: currentRole().name, 武器: player.slots.map(s=>s.id),
               目标链: currentObjectives().map(o=>o.id), 护甲: ARMOR_DEFS[player.armor].name };
    })()`);
    console.log('③ 保安撤离 →', JSON.stringify(sl4));

    // ⑤ 局内身份显示
    await boot('scientist'); await deploy();
    const hud = await ev(`({
      身份行: (document.querySelector('#objList')||{}).innerText?.split('\\n')[0] || '',
      副标题: (document.getElementById('subtitleTitle')||{}).textContent || '',
      播报: (document.getElementById('broadcast')||{}).textContent || '',
    })`);
    console.log('⑤ 局内身份:', JSON.stringify(hud));

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
