'use strict';
/* =====================================================================
   可操控实体收容物（173 / 096 / 939 / 106）+ 096 活跃化 验证
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8817;
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
  const ud = path.join(os.tmpdir(), 'scprx-pscp-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9363', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9363/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await ev('document.getElementById("deployGo").click()');
    await wait(5200);
    // MTF 队友现在要开局 1 分钟后才进场 —— 需要观察者的用例先把他们叫出来
    await ev('(function(){ if (!GAME.mtfDeployed) { GAME.elapsed = 61; checkMtfDeploy(); } })()');
    await wait(700);
  };

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    // 先把页面加载起来，脚本才有 rollRole 等全局函数
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3400);

    // 权重
    const w = await ev(`(function(){
      const cnt = {}; for (let i=0;i<20000;i++) { const k = rollRole(); cnt[k] = (cnt[k]||0)+1; }
      const pct = {}; for (const k in cnt) pct[k] = +(cnt[k]/200).toFixed(1);
      return { 百分比: pct, 权重: ROLE_ORDER.map(k => k + ':' + ROLE_DEFS[k].weight).join(' ') };
    })()`);
    console.log('权重:', JSON.stringify(w));

    // 四个附身角色逐个进入
    for (const r of ['p173', 'p096', 'p939', 'p106']) {
      await boot(r);
      const t = await ev(`(function(){
        const e = PSCP.ent;
        return { 角色: currentRole().name, isSCP: player.isSCP, 附身: e ? e.name : null,
                 被标记: !!(e && e.playerControlled), 眼高: +player.eyeH.toFixed(2),
                 面板: !document.getElementById('pscpPanel').classList.contains('hidden'),
                 状态行: (document.getElementById('pscpState')||{}).textContent,
                 攻击名: (document.getElementById('pscpAtk')||{}).textContent,
                 目标链: currentObjectives().map(o=>o.id), 人类: o79Humans(),
                 本体位置: [Math.round(e.pos.x), Math.round(e.pos.z)], 相机: [Math.round(player.pos.x), Math.round(player.pos.z)] };
      })()`);
      console.log('▶ ' + r + ':', JSON.stringify(t));

      // 攻击：把一个人搬到嘴边
      const atk = await ev(`(function(){
        const e = PSCP.ent;
        const h = scpHumans()[0];
        if (!h) return { err: '没有人' };
        h.pos.set(e.pos.x + 1.2, 0, e.pos.z);
        const before = PSCP.kills;
        PSCP.atkCd = 0;
        scpAttack();
        return { 目标: h.name || h.callsign, 死亡: !h.alive, 击杀数: PSCP.kills - before };
      })()`);
      console.log('   攻击:', JSON.stringify(atk));
    }

    // 173：被注视冻结
    await boot('p173');
    const f1 = await ev(`(function(){
      const e = PSCP.ent;
      const a = ALLY_LIST[0];
      if (a) { a.pos.set(e.pos.x + 5, 0, e.pos.z); a.blinkT = 0; a.blinkCd = 99; }
      PSCP.tune.frozenWhenSeen = true;
      return true;
    })()`);
    await wait(1200);      // 等 HUD 真的把状态刷出来
    const f1b = await ev(`({ 有人看着: PSCP.observed, 状态行: (document.getElementById('pscpState')||{}).textContent })`);
    const f2 = await ev(`(function(){
      const a = ALLY_LIST[0];
      if (a) { a.pos.set(999, 0, 999); }     // 把人挪走
      return true;
    })()`);
    await wait(1200);
    const f2b = await ev(`({ 有人看着: PSCP.observed, 状态行: (document.getElementById('pscpState')||{}).textContent })`);
    console.log('173 冻结:', JSON.stringify(f1b), '→', JSON.stringify(f2b));

    // 096：被人看到就暴走
    await boot('p096');
    const r1 = await ev(`(function(){
      const e = PSCP.ent;
      const a = ALLY_LIST[0];
      if (a) { a.pos.set(e.pos.x + 6, 0, e.pos.z); }
      e.enraged = false; PSCP.rageTold = false;
      return true;
    })()`);
    await wait(1200);
    const r1b = await ev(`({ 暴走: PSCP.ent.enraged, 状态行: (document.getElementById('pscpState')||{}).textContent })`);
    const r2 = await ev(`(function(){
      const a = ALLY_LIST[0];
      if (a) { a.pos.set(999, 0, 999); }
      const e = PSCP.ent;
      return { 暴走后速度: PSCP.tune.rageSpeed, 平时速度: PSCP.tune.speed };
    })()`);
    console.log("096 暴走:", JSON.stringify(r1b), JSON.stringify(r2));

    // 106：穿墙（不调用 collideMove）
    await boot('p106');
    const ph = await ev(`(function(){
      const e = PSCP.ent;
      const before = { x: e.pos.x, z: e.pos.z };
      // 直接推进一大段，看有没有被墙挡住
      const bx = e.pos.x, bz = e.pos.z;
      e.pos.x = bx + 30;
      const noCollide = PSCP.tune.phase === true;
      e.pos.x = bx;
      return { 相位: noCollide, 位置: [Math.round(before.x), Math.round(before.z)] };
    })()`);
    console.log('106 穿墙:', JSON.stringify(ph));

    // 939：声呐列表
    await boot('p939');
    await ev(`(function(){ const a = ALLY_LIST[0]; if (a) a.pos.set(PSCP.ent.pos.x + 8, 0, PSCP.ent.pos.z); })()`);
    await wait(1200);
    const sv = await ev(`({
      声呐条数: PSCP.soundList.length,
      面板文本: (document.getElementById('pscpSound')||{}).innerText?.replace(/\\s+/g,' ').slice(0,60) || '',
    })`);
    console.log('939 声呐:', JSON.stringify(sv));

    // 096 的 AI 活跃化：温顺时会自己走动
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);
    const w1 = await ev(`(function(){
      const s = SCP_LIST.find(v => v.key === '096');
      s.awake = true; s.enraged = false;
      s.wanderT = 0;                    // 直接触发一次游荡目标选取
      return { x: +s.pos.x.toFixed(1), z: +s.pos.z.toFixed(1) };
    })()`);
    await wait(22000);
    const w2 = await ev(`(function(){
      const s = SCP_LIST.find(v => v.key === '096');
      return { x: +s.pos.x.toFixed(1), z: +s.pos.z.toFixed(1),
               游荡目标: [Math.round(s.wanderX), Math.round(s.wanderZ)],
               移动了: +Math.hypot(s.pos.x - ${w1.x}, s.pos.z - ${w1.z}).toFixed(2) };
    })()`);
    console.log('096 AI 活跃化:', JSON.stringify(w1), '→', JSON.stringify(w2));

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
