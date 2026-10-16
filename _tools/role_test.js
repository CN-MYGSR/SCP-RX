'use strict';
/* =====================================================================
   开局随机角色（还原 RXSEND 的随机阵营机制）验证
   ① 权重抽取：4 个角色都能抽到，且权重比例正确
   ② 每个角色的配装 / 出生点 / 目标链 / 撤离条件都对
   ③ 空手角色（研究员 / D级）没有武器槽、不能开火、不会崩
   ④ 保安有手枪 + 轻甲；MTF 用玩家自选的配装
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8807;
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
  const ud = path.join(os.tmpdir(), 'scprx-role-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9353', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9353/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1' });
    await wait(3500);

    // ① 权重抽取（跑 20000 次）
    const t1 = await ev(`(function(){
      const cnt = { mtf:0, guard:0, scientist:0, classd:0, o79:0 };
      for (let i=0;i<20000;i++) cnt[rollRole()]++;
      const total = 20000;
      const pct = {}; for (const k in cnt) pct[k] = +(cnt[k]/total*100).toFixed(1);
      return { 次数: cnt, 百分比: pct,
               权重: { mtf: ROLE_DEFS.mtf.weight, guard: ROLE_DEFS.guard.weight, o79: ROLE_DEFS.o79.weight,
                       scientist: ROLE_DEFS.scientist.weight, classd: ROLE_DEFS.classd.weight } };
    })()`);
    console.log('① 权重抽取:', JSON.stringify(t1));

    // ② 逐个角色进游戏，检查配装 / 出生点 / 目标链 / 撤离条件
    const roles = ['mtf', 'guard', 'scientist', 'classd', 'o79', 'p173', 'p096', 'p939', 'p106'];
    for (const rk of roles) {
      await ev(`(function(){
        GAME.mission = 'breach'; GAME.role = '${rk}'; GAME.roleRolled = true;
        if (!GAME.over && GAME.phase === 'playing') { GAME.over = true; }
      })()`);
      await ev(`location.reload()`);
      await wait(3200);
      await ev(`(function(){ GAME.mission='breach'; GAME.role='${rk}'; GAME.roleRolled=true; })()`);
      await ev('document.querySelector("[data-p=mLoadout]").click()');
      await wait(300);
      await ev('document.getElementById("deployGo").click()');
      await wait(4500);
      const t = await ev(`(function(){
        const r = currentRole();
        const ez = FAC.roomAt[r.spawn] || null;
        const d = Math.hypot(player.pos.x - FAC.spawn.x, player.pos.z - FAC.spawn.z);
        return {
          角色: r.name, 阵营: r.faction,
          武器槽: player.slots.map(s => s.id),
          护甲: ARMOR_DEFS[player.armor].name,
          头戴: GEAR_DEFS[NVG.gear()] ? GEAR_DEFS[NVG.gear()].short : '-',
          出生点偏移: +d.toFixed(1),
          目标链: currentObjectives().map(o => o.id),
          撤离已解锁: extractReady(),
          VM有枪: !!VM.gun,
        };
      })()`);
      console.log('② ' + rk + ':', JSON.stringify(t));

      // ③ 空手角色不能开火
      if (rk === 'scientist' || rk === 'classd') {
        const t2 = await ev(`(function(){
          const before = player.shots;
          let threw = null;
          try { player.fireOnce(); } catch (e) { threw = String(e); }
          return { 开火前射击数: before, 开火后射击数: player.shots, 异常: threw };
        })()`);
        console.log('   → 空手开火:', JSON.stringify(t2));
      }
      // ④ 保安应有一把手枪
      if (rk === 'guard') {
        const t3 = await ev(`({ 武器槽: player.slots.map(s=>s.id), 护甲: ARMOR_DEFS[player.armor].name })`);
        console.log('   → 保安配装:', JSON.stringify(t3));
      }
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
