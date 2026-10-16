'use strict';
/* =====================================================================
   反叛之狐 验证
   ① 只出现在 5K 的随机池里（落锤行动抽不到）
   ② 与 Nu-22 敌对、与保安/科学家同阵营
   ③ 目标链 [kill1440, killNu22]
   ④ 长按 F 处决 SCP-1440（6 秒引导）
   ⑤ 处决 + 清除 Nu-22 → 胜利
   ⑥ 5K 不补人（MTF / CI / 蛇之手都不补）
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8835;
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
  const ud = path.join(os.tmpdir(), 'scprx-reb-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9381', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9381/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=rebel' });
    await wait(3400);

    // ① 随机池：反叛之狐只在 5K
    const p1 = await ev(`(function(){
      const out = {};
      for (const m of ['breach','contain096','fivek']) {
        GAME.mission = m;
        const pool = rollPoolFor(m);
        out[m] = { 池子: pool.join(','), 有反叛之狐: pool.indexOf('rebel') >= 0 };
      }
      // 抽 20000 次看 5K 里能不能抽到
      GAME.mission = 'fivek';
      let n = 0; for (let i=0;i<20000;i++) if (rollRole() === 'rebel') n++;
      out.fivek抽中率 = +(n/200).toFixed(1) + '%';
      GAME.mission = 'breach';
      let n2 = 0; for (let i=0;i<20000;i++) if (rollRole() === 'rebel') n2++;
      out.breach抽中次数 = n2;
      return out;
    })()`);
    console.log('① 随机池:', JSON.stringify(p1));

    // 进 5K 并锁定反叛之狐
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.querySelector(\'#missionRow .presetCard[data-m="fivek"]\').click()');
    await wait(400);
    await ev('GAME.role = "rebel";');
    await ev('document.getElementById("deployGo").click()');
    await wait(5500);

    // ⑦ 延迟部署（含玩家）
    const st1 = await ev(`(function(){
      const x = player.pos.x, z = player.pos.z;
      // ⚠️ 必须走 updatePlayer（真实的每帧入口），直接调 player.move() 会绕过待命冻结
      keys.fwd = true;
      for (let i = 0; i < 6; i++) updatePlayer(0.05);
      keys.fwd = false;
      return { 待命中: GAME.staging.active, 剩余秒: Math.round(GAME.staging.t),
               待命屏可见: !document.getElementById('stagingScreen').classList.contains('hidden'),
               倒计时文本: (document.getElementById('stagingN')||{}).textContent,
               移动被冻结: Math.abs(player.pos.x - x) < 0.01 && Math.abs(player.pos.z - z) < 0.01,
               受伤无效: (function(){ const h = player.hp; player.damage(50, null, {}); return player.hp === h; })() };
    })()`);
    console.log('⑦ 延迟部署:', JSON.stringify(st1));
    await ev('GAME.staging.t = 0.3;');
    await wait(7000);
    const st2 = await ev(`({
      待命中: GAME.staging.active,
      待命屏可见: !document.getElementById('stagingScreen').classList.contains('hidden'),
      音乐: AudioSys.musicState(),
    })`);
    console.log('   → 突入后:', JSON.stringify(st2));

    // ⑧ 复活点分离 + AI 的 Nu-22 会自己去推进净化
    const sp = await ev(`(function(){
      const a = ALLY_LIST.find(x => x.alive);
      const e = S1440.ent;
      return { 复活点房间: currentRole().spawn,
               玩家位置: [Math.round(player.pos.x), Math.round(player.pos.z)],
               队友位置: a ? [Math.round(a.pos.x), Math.round(a.pos.z)] : null,
               与队友距离: a ? +Math.hypot(player.pos.x - a.pos.x, player.pos.z - a.pos.z).toFixed(1) : -1,
               与1440距离: e ? +Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z).toFixed(1) : -1 };
    })()`);
    console.log('⑧ 复活点分离:', JSON.stringify(sp));
    console.log('   与队友距离 > 30m ?', sp.与队友距离 > 30 ? '✅ 分开了' : '❌ 还是挨着');

    // 玩家走远，只留 AI 的 Nu-22 在 1440 身边 —— 净化应该继续推进
    const ai1 = await ev(`(function(){
      const e = S1440.ent;
      ALLY_LIST.forEach((a, i) => { if (a.alive) a.pos.set(e.pos.x + 2 + i * 0.8, 0, e.pos.z + 1.5); });
      player.pos.set(e.pos.x + 80, 0, e.pos.z);      // 玩家远远走开
      S1440.holdT = 10;
      return { 玩家距离: 80, 队友数: ALLY_LIST.filter(a=>a.alive).length, 滞留起点: S1440.holdT };
    })()`);
    await wait(10000);
    const ai2 = await ev(`({ 滞留: +S1440.holdT.toFixed(1), 在推进: S1440.holding,
                               队友与1440距离: ALLY_LIST.filter(a=>a.alive).map(a => Math.round(Math.hypot(a.pos.x - S1440.ent.pos.x, a.pos.z - S1440.ent.pos.z))) })`);
    console.log('   → AI 推进净化:', JSON.stringify(ai1), '→', JSON.stringify(ai2),
      (ai2.滞留 > ai1.滞留起点 && ai2.在推进) ? '✅ AI 在推进' : '❌ 没推进');

    // ② 阵营关系
    const p2 = await ev(`({
      角色: currentRole().id, 显示名: roleView().name, 阵营: roleView().faction, side: currentRole().side,
      目标链: currentObjectives().map(o=>o.id),
      与站点为敌: playerHostileToSite(),
      与队友为敌: alliesHostileToPlayer(),
      保安打我: guardsHostileToPlayer(),
      队友: ALLY_LIST.map(a=>a.name),
    })`);
    console.log('② 阵营:', JSON.stringify(p2));

    // ③ 能不能打到 Nu-22 队友 / 保安 / 科学家
    const p3 = await ev(`(function(){
      player.alive = true;
      const park = (list) => list.forEach((q, i) => q.pos.set(900, 0, 900 + i * 4));
      const out = {};
      const probe = (ent) => {
        park(PERSONNEL_LIST); park(SCP_LIST); park(ALLY_LIST);
        ent.pos.set(player.pos.x, 0, player.pos.z - 5);
        const hit = raycastSCPs(V3(player.pos.x, player.pos.y + 1.2, player.pos.z), V3(0,0,-1), 40);
        return !!(hit && hit.isHostile && hit.ent === ent);
      };
      const a = ALLY_LIST.find(x => x.alive);
      if (a) out.能打Nu22 = probe(a);
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      if (g) out.能打保安 = probe(g);
      const sc = PERSONNEL_LIST.find(p => p.kind === 'scientist' && p.alive && !p.escaped);
      if (sc) out.能打科学家 = probe(sc);
      return out;
    })()`);
    console.log('③ 可攻击对象:', JSON.stringify(p3));

    // ④ 处决 SCP-1440
    const e1 = await ev(`(function(){
      const e = S1440.ent;
      player.pos.set(e.pos.x + 2.0, 0, e.pos.z);
      player.scanInteract();
      const it = player.interact;
      return { 识别到处决: !!(it && it.exec1440), 引导时长: it && it.exec1440 ? it.holdNeed : null,
               提示: (document.getElementById('interactTxt')||{}).textContent, 已处决: S1440.executed };
    })()`);
    await wait(500);
    const e2 = await ev(`(function(){
      player.interactHold = 0;
      let frames = 0;
      while (frames < 400 && !S1440.executed) {
        frames++;
        player.interactHold += 0.05;
        if (player.interactHold >= player.interact.holdNeed) { completeInteract(player.interact); player.interactHold = 0; }
      }
      return { 引导帧数: frames, 已处决: S1440.executed, '1440仍在场': S1440.active,
               目标状态: objectiveStatus().kill1440 };
    })()`);
    console.log('④ 处决:', JSON.stringify(e1), '→', JSON.stringify(e2));

    // ⑤ 清除 Nu-22 → 胜利
    const w1 = await ev(`({ 剩余Nu22: nu22Alive(), 已处决: S1440.executed, over: GAME.over })`);
    await ev('(function(){ for (const a of ALLY_LIST) a.alive = false; })()');
    await wait(1500);
    const w2 = await ev(`({ over: GAME.over, won: GAME.won, 标题: (document.getElementById('endTitle')||{}).textContent,
                           副标题: (document.getElementById('endSub')||{}).textContent })`);
    console.log('⑤ 胜利:', JSON.stringify(w1), '→', JSON.stringify(w2));

    // ⑥ 5K 不补人
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.querySelector(\'#missionRow .presetCard[data-m="fivek"]\').click()');
    await wait(400);
    await ev('GAME.role = "mtf";');
    await ev('document.getElementById("deployGo").click()');
    await wait(5200);
    const r1 = await ev(`(function(){
      const before = { 队友: ALLY_LIST.length, CI: FACTION_LIST.filter(a=>a.kind==='ci').length };
      // 把所有人清空，再把三个增援计时器都压到 0
      for (const a of ALLY_LIST) a.alive = false;
      for (const f of FACTION_LIST) f.alive = false;
      GAME.mtfReinforceT = 0.1;
      FACTION_STATE.ciReinforceT = 0.1; FACTION_STATE.handReinforceT = 0.1;
      GAME.mission = 'fivek';
      return before;
    })()`);
    await wait(12000);
    const r2 = await ev(`({ 存活队友: nu22Alive(), 存活CI: FACTION_LIST.filter(a=>a.alive && a.kind==='ci').length,
                           存活蛇手: FACTION_LIST.filter(a=>a.alive && a.kind==='hand').length })`);
    console.log('⑥ 5K 不补人:', JSON.stringify(r1), '→', JSON.stringify(r2),
      (r2.存活队友 === 0) ? '✅ 没补' : '❌ 补了');

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
