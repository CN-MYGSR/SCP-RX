'use strict';
/* =====================================================================
   敌对势力验证：混沌分裂者 / 蛇之手
   ① 时间线：5 分钟前不出现 → 300s 出 CI → 360s 出蛇之手
   ② 入场音乐
   ③ CI 与玩家敌对（会开火）
   ④ 蛇之手按「威胁由低到高」放逐已收容异常
   ⑤ 入侵者存活时撤离被锁，肃清后解锁
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8803;
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
  const ud = path.join(os.tmpdir(), 'scprx-fac-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9349', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9349/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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

    // ① 时间线
    const t0 = await ev(`({
      已部署: factionsDeployed(), CI数: factionAlive('ci'), 蛇之手数: factionAlive('hand'),
      目标链_invaders: objectiveStatus().invaders, 计时: Math.round(GAME.elapsed),
    })`);
    console.log('① 开局（未到 5 分钟）:', JSON.stringify(t0));

    // 先把全部 9 只收容掉，好让蛇之手有东西可放
    await ev(`(function(){
      for (const s of SCP_LIST) {
        if (s.def && s.def.immortal) { if(!s.hooded) hoodSCP096(); continue; }
        s.enraged = true; s.observed = true; s.hp = 1;
        damageSCP(s, 9999, {byPlayer:true, head:true, from:player});
      }
      GAME.protocol = true;
      PHOTOS.forEach(p => { p.done = true; });
    })()`);
    const pre = await ev(`({ contained: Object.keys(GAME.contained).length, 撤离: extractReady() })`);
    console.log('   预置：已收容', JSON.stringify(pre));

    // ② 快进到 300 秒 → CI 突入
    await ev('GAME.elapsed = 301;');
    await wait(2200);
    const t1 = await ev(`({
      已部署: factionsDeployed(), CI数: factionAlive('ci'),
      蛇之手数: factionAlive('hand'),
      音乐: AudioSys.musicState(), 目标链_invaders: objectiveStatus().invaders,
      CI阵营: FACTION_LIST.filter(a=>a.kind==='ci').map(a=>a.name),
    })`);
    console.log('② 快进到 301 秒（CI 应突入）:', JSON.stringify(t1));

    // ③ CI 敌对：把玩家放到 CI 面前，看它是否开火
    const t2 = await ev(`(function(){
      const a = FACTION_LIST.find(x=>x.kind==='ci');
      player.pos.set(a.pos.x, 0, a.pos.z + 6);
      player.hp = player.maxHp;
      DEBUG.god = false;
      a.retargetT = 0; a.atkCd = 0;
      return { CI: a.name, 距离: +Math.hypot(a.pos.x-player.pos.x, a.pos.z-player.pos.z).toFixed(1),
               玩家HP: player.hp, CI的hp: a.hp };
    })()`);
    await wait(3000);
    const t2b = await ev(`(function(){
      const a = FACTION_LIST.find(x=>x.kind==='ci');
      return { 玩家HP: Math.round(player.hp), CI目标: a.target ? (a.target===player?'玩家':'队友') : '无' };
    })()`);
    console.log('③ CI 敌对性:', JSON.stringify(t2), '→', JSON.stringify(t2b));
    await ev('DEBUG.god = true; player.hp = player.maxHp;');

    // ④ 快进到 360 秒 → 蛇之手跟进
    await ev('GAME.elapsed = 361;');
    await wait(2200);
    const t3 = await ev(`({
      蛇之手数: factionAlive('hand'),
      蛇之手阵营: FACTION_LIST.filter(a=>a.kind==='hand').map(a=>a.name),
      音乐: AudioSys.musicState(), 目标链_invaders: objectiveStatus().invaders,
    })`);
    console.log('④ 快进到 361 秒（蛇之手应跟进）:', JSON.stringify(t3));

    // ⑤ 放逐顺序：连续调用选择器，确认威胁由低到高
    const t4 = await ev(`(function(){
      // 先复原成"全部已收容"
      for (const s of SCP_LIST) { if (s.alive) { s.alive=false; GAME.contained[s.key]=true; } }
      GAME.contained['096'] = true;
      const order = [];
      for (let i=0;i<9;i++) {
        const s = nextReleaseTarget();
        if (!s) break;
        order.push(s.key + '(威胁' + (SCP_THREAT[s.key]||5) + ')');
        delete GAME.contained[s.key];     // 模拟已被放逐
      }
      return { 放逐顺序: order.join(' → ') };
    })()`);
    console.log('⑤ 放逐顺序:', JSON.stringify(t4));

    // ⑥ 真实放逐一次（把蛇之手瞬移到目标旁边，等它走完 3 秒）
    const t5 = await ev(`(function(){
      // 重新变成"全部已收容"
      for (const s of SCP_LIST) { if (s.alive) { s.alive=false; s.model.group.parent && s.model.group.parent.remove(s.model.group); } GAME.contained[s.key]=true; }
      const h = FACTION_LIST.find(x=>x.kind==='hand' && x.alive);
      const target = nextReleaseTarget();
      h.pos.set(target.spawnX, 0, target.spawnZ + 1.5);
      h.releaseTarget = null; h.releaseT = 0; h.target = null;
      return { 执行者: h.name, 目标: target.name, 目标已收容: !!GAME.contained[target.key],
               放逐计数: FACTION_STATE.released, contained总数: Object.keys(GAME.contained).length };
    })()`);
    console.log('⑥ 放逐前:', JSON.stringify(t5));
    // 无头浏览器帧率极低（约 2.7fps，dt 被钳到 0.05），3 秒游戏时间要等很久
    await wait(40000);
    const t5b = await ev(`(function(){
      const alive = SCP_LIST.filter(s=>s.alive).map(s=>s.key);
      const h = FACTION_LIST.find(x=>x.kind==='hand');
      return { 重新存活的异常: alive.join(',') || '（无）',
               放逐计数: FACTION_STATE.released,
               contained总数: Object.keys(GAME.contained).length,
               放逐进度: h ? +h.releaseT.toFixed(2) : -1,
               撤离: extractReady() };
    })()`);
    console.log('   → 放逐后:', JSON.stringify(t5b));

    // ⑦ 撤离门控
    const t6 = await ev(`(function(){
      // 把异常重新全部收容，但入侵者还活着
      for (const s of SCP_LIST) { if (s.alive) { s.alive=false; GAME.contained[s.key]=true; } }
      const invadersAlive = FACTION_LIST.filter(a=>a.alive).length;
      const blocked = extractReady();
      // 肃清入侵者
      for (const a of FACTION_LIST) { a.alive = false; }
      return { 入侵者存活: invadersAlive, 有入侵者时撤离: blocked,
               肃清后撤离: extractReady(), 目标链_invaders: objectiveStatus().invaders };
    })()`);
    console.log('⑦ 撤离门控:', JSON.stringify(t6));

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
