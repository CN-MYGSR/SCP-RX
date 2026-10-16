'use strict';
/* =====================================================================
   SCP：5K 行动 验证
   ① 任务在菜单里、角色固定为 Nu-22
   ② SCP-1440 生成（有模型）且免疫伤害
   ③ 滞留计时：玩家在范围内推进 / 离开后回退
   ④ 1440 的异常影响只杀站点的人，Nu-22 免疫
   ⑤ 站点守备（保安）对玩家开火
   ⑥ 满 60 秒 → 胜利
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8831;
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
  const ud = path.join(os.tmpdir(), 'scprx-5k-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9377', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9377/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(500);

    // ① 任务卡存在 + 选中后角色固定
    const m1 = await ev(`(function(){
      const cards = Array.from(document.querySelectorAll('#missionRow .presetCard')).map(c => c.dataset.m);
      const fivek = document.querySelector('#missionRow .presetCard[data-m="fivek"]');
      return { 任务卡: cards, 有5K: !!fivek, 卡面文字: fivek ? fivek.innerText.replace(/\\s+/g,' ').slice(0,40) : '' };
    })()`);
    console.log('① 任务卡:', JSON.stringify(m1));
    await ev('document.querySelector(\'#missionRow .presetCard[data-m="fivek"]\').click()');
    await wait(600);
    const m2 = await ev(`({ 随机角色: currentRole().id, 显示名: roleView().name,
                            目标链: currentObjectives().map(o=>o.id),
                            简介: (document.getElementById('missionDesc')||{}).innerText?.replace(/\\s+/g,' ').slice(0,110) })`);
    console.log('   → 选中 5K:', JSON.stringify(m2));
    // 5K 里抽到 MTF 时应该换皮成 Nu-22
    const m3 = await ev(`(function(){
      const out = {};
      for (const r of ['mtf','guard','scientist','classd']) {
        GAME.role = r;
        out[r] = roleView().name;
      }
      GAME.role = 'mtf';
      return out;
    })()`);
    console.log('   → 5K 下的身份显示:', JSON.stringify(m3));

    // 进游戏
    await ev('document.getElementById("deployGo").click()');
    await wait(5500);

    const t1 = await ev(`(function(){
      const e = S1440.ent;
      let mesh = 0;
      if (e) e.group.traverse(o => { if (o.isMesh) mesh++; });
      return { 角色: currentRole().id, 显示名: roleView().name, '1440激活': S1440.active, '1440位置': e ? [Math.round(e.pos.x), Math.round(e.pos.z)] : null,
               '1440网格数': mesh, 滞留: +S1440.holdT.toFixed(1), 目标: S1440.holdNeed,
               在SCP_LIST里: SCP_LIST.some(s => s.key === '1440'),
               队友: ALLY_LIST.map(a => a.name),
               音乐: AudioSys.musicState(),
               站点人员: PERSONNEL_LIST.length, 敌对势力: FACTION_LIST.length,
               SCP数: SCP_LIST.length,
               目标链: currentObjectives().map(o=>o.id) };
    })()`);
    console.log('② 进场:', JSON.stringify(t1));

    // ③ 计时推进 / 回退
    await ev(`(function(){
      const e = S1440.ent;
      player.pos.set(e.pos.x + 5, 0, e.pos.z);   // 站到它旁边
      S1440.holdT = 10;
    })()`);
    await wait(9000);
    const t2 = await ev(`+S1440.holdT.toFixed(1)`);
    await ev(`(function(){ const e = S1440.ent; player.pos.set(e.pos.x + 60, 0, e.pos.z); })()`);
    await wait(9000);
    const t3 = await ev(`+S1440.holdT.toFixed(1)`);
    console.log('③ 滞留计时: 站旁边 10 → ' + t2 + '（应上升）→ 走远 → ' + t3 + '（应下降）');

    // ③b 靠近按 F 让 1440 跟随
    const f1 = await ev(`(function(){
      const e = S1440.ent;
      player.pos.set(e.pos.x + 2.0, 0, e.pos.z);   // 站到 3.8m 内
      player.scanInteract();
      const it = player.interact;
      return { 识别到1440: !!(it && (it.s1440Follow || it.s1440Release)),
               类型: it && it.s1440Follow ? '跟随' : (it && it.s1440Release ? '停下' : '无'),
               有holdNeed: !!(it && it.holdNeed > 0), 跟随中: S1440.follow };
    })()`);
    await wait(600);
    const f2 = await ev(`(function(){
      // 走完整的"按住 F"链路
      player.interactHold = 0;
      let frames = 0;
      while (frames < 80 && !S1440.follow) {
        frames++;
        player.interactHold += 0.05;
        if (player.interactHold >= player.interact.holdNeed) { completeInteract(player.interact); player.interactHold = 0; }
      }
      return { 按住帧数: frames, 跟随中: S1440.follow,
               提示文案: (document.getElementById('interactTxt')||{}).textContent };
    })()`);
    console.log('③b 按 F 让它跟随:', JSON.stringify(f1), '→', JSON.stringify(f2));
    // 跟随效果：玩家走开，1440 应该跟上来
    const f3 = await ev(`(function(){
      const e = S1440.ent;
      player.pos.set(e.pos.x + 14, 0, e.pos.z);   // 玩家走远
      return { 距离: +Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z).toFixed(1),
               '1440位置': [Math.round(e.pos.x), Math.round(e.pos.z)] };
    })()`);
    await wait(12000);
    const f4 = await ev(`(function(){
      const e = S1440.ent;
      return { 距离: +Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z).toFixed(1) };
    })()`);
    console.log('   → 玩家走远后:', JSON.stringify(f3), '→', JSON.stringify(f4),
      f4.距离 < f3.距离 ? '✅ 跟上来了' : '❌ 没跟');
    // 再按一次让它停下
    const f5 = await ev(`(function(){
      const e = S1440.ent;
      player.pos.set(e.pos.x + 2.0, 0, e.pos.z);
      player.scanInteract();
      const it = player.interact;
      player.interactHold = 0;
      let frames = 0;
      while (frames < 80 && S1440.follow) {
        frames++;
        player.interactHold += 0.05;
        if (player.interactHold >= player.interact.holdNeed) { completeInteract(player.interact); player.interactHold = 0; }
      }
      return { 识别类型: it && it.s1440Release ? '停下' : '其它', 按住帧数: frames, 跟随中: S1440.follow };
    })()`);
    console.log('   → 再按一次:', JSON.stringify(f5));

    // ④ 异常影响：只杀站点的人
    // 把保安钉在 1440 旁边（冻结它的游荡），玩家挪远免得被它开枪干扰读数
    const t4 = await ev(`(function(){
      const e = S1440.ent;
      S1440.follow = false;
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      const a = ALLY_LIST.find(x => x.alive);
      if (g) {
        g.pos.set(e.pos.x + 2, 0, e.pos.z);
        g.hp = 40;
        g.wanderT = 999; g.wanderX = g.pos.x; g.wanderZ = g.pos.z;
        g.homeX = g.pos.x; g.homeZ = g.pos.z;
      }
      if (a) { a.pos.set(e.pos.x - 2, 0, e.pos.z); }
      player.pos.set(e.pos.x + 40, 0, e.pos.z);      // 玩家走远，别被守备打
      return { 保安HP: g ? g.hp : null, 队友HP: a ? a.hp : 0, 玩家HP: player.hp };
    })()`);
    await wait(9000);
    const t4b = await ev(`(function(){
      const e = S1440.ent;
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard');
      const a = ALLY_LIST.find(x => x.alive);
      return { 保安HP: g ? Math.round(g.hp) : null, 队友HP: a ? a.hp : 0, 玩家HP: Math.round(player.hp),
               清理计数: S1440.curseKills };
    })()`);
    console.log('④ 异常影响:', JSON.stringify(t4), '→', JSON.stringify(t4b));

    // ⑤ 站点守备开火
    const t5 = await ev(`(function(){
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      if (!g) return { err: '没有保安' };
      player.pos.set(g.pos.x + 6, 0, g.pos.z);
      player.hp = player.maxHp;
      g.atkCd = 0;
      return { 保安: g.name, 距离: 6, 玩家HP: player.hp };
    })()`);
    await wait(4000);
    const t5b = await ev(`({ 玩家HP: Math.round(player.hp) })`);
    console.log('⑤ 守备开火:', JSON.stringify(t5), '→', JSON.stringify(t5b));

    // ⑥ 满 60 秒 → 胜利
    await ev(`(function(){
      const e = S1440.ent;
      player.pos.set(e.pos.x + 4, 0, e.pos.z);
      S1440.holdT = S1440.holdNeed - 0.6;
    })()`);
    await wait(6000);
    const t6 = await ev(`({ over: GAME.over, won: GAME.won, 标题: (document.getElementById('endTitle')||{}).textContent,
                           副标题: (document.getElementById('endSub')||{}).textContent,
                           统计: (document.getElementById('endStats')||{}).innerText?.replace(/\\s*\\n\\s*/g,' | ').slice(0,120) })`);
    console.log('⑥ 胜利判定:', JSON.stringify(t6));

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
