'use strict';
/* =====================================================================
   SCP-079「旧 AI」可玩角色验证
   ① 进入：isAI、摄像头、特斯拉门、HUD 面板、无武器
   ② AP 回充 + EXP/升级
   ③ 开关门 / 锁门（真的会挡住人）
   ④ 停电封锁（Tier 2 门槛 + 灯真的灭）
   ⑤ 特斯拉门过充：杀人不杀 SCP
   ⑥ 打不死 + SCP 不追它
   ⑦ 胜负判定：人类清零 = 胜；其他 SCP 清零 = 败
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8811;
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
  const ud = path.join(os.tmpdir(), 'scprx-o79-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9357', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9357/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=o79' });
    await wait(3500);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5500);

    // ① 进入状态
    const t1 = await ev(`({
      角色: currentRole().name, isAI: player.isAI, AI激活: AI079.active,
      摄像头数: AI079.cams.length, 特斯拉门数: AI079.teslas.length,
      武器槽: player.slots.length, HUD可见: !document.getElementById('o79Panel').classList.contains('hidden'),
      生命体征隐藏: document.getElementById('vitals').style.display === 'none',
      目标链: currentObjectives().map(o=>o.id),
      人类: o79Humans(), 收容物: o79SCPsAlive(),
      相机位置: [Math.round(player.pos.x), +player.pos.y.toFixed(1), Math.round(player.pos.z)],
    })`);
    console.log('① 进入 079:', JSON.stringify(t1));

    // ② AP 回充（先抽干，否则一直是满的看不出回充）
    await ev('AI079.ap = 10;');
    const a1 = await ev('+AI079.ap.toFixed(1)');
    await wait(4000);
    const a2 = await ev('+AI079.ap.toFixed(1)');
    console.log('② AP 回充:', a1, '→', a2, a2 > a1 ? '✅ 在回' : '❌ 没回');

    // ③ 开关门 / 锁门
    const t3 = await ev(`(function(){
      // 跳到一扇有门的房间
      let idx = AI079.cams.findIndex(c => FAC.doors.some(d => d.room && d.room.id === c.id && d.leafA));
      if (idx < 0) return { err: '没有带门的房间' };
      o79Goto(idx);
      AI079.ap = 200;
      const ds = o79RoomDoors();
      const before = ds.map(d => ({ locked: !!d.locked, forced: !!d.forced, open: d.open }));
      o79LockToggle();
      const after = ds.map(d => ({ locked: !!d.locked, forced: !!d.forced }));
      return { 房间: o79Room().name, 门数: ds.length, 锁前: before, 锁后: after,
               碰撞已挡住: ds[0].col.noClip === false || ds[0].t < 0.3 };
    })()`);
    console.log('③ 锁门:', JSON.stringify(t3));
    await wait(1500);
    const t3b = await ev(`(function(){
      const ds = o79RoomDoors();
      return { 门板位置: ds.map(d=>+d.t.toFixed(2)), 碰撞noClip: ds.map(d=>!!d.col.noClip) };
    })()`);
    console.log('   → 1.5 秒后:', JSON.stringify(t3b));

    // ④ 停电封锁（先测 Tier 门槛）
    const t4 = await ev(`(function(){
      AI079.tier = 1; AI079.ap = 200;
      const before = AI079.darkT;
      o79Blackout();
      const blocked = AI079.darkT === before;
      AI079.tier = 2;
      const room = o79Room();
      const lightsBefore = LIGHT_SOURCES.filter(s => s.on && Math.abs(s.x-room.cx) < room.w*0.75 && Math.abs(s.z-room.cz) < room.d*0.75).length;
      o79Blackout();
      const lightsAfter = LIGHT_SOURCES.filter(s => s.on && Math.abs(s.x-room.cx) < room.w*0.75 && Math.abs(s.z-room.cz) < room.d*0.75).length;
      return { Tier1时被拦: blocked, 房间: room.name, 关灯前: lightsBefore, 关灯后: lightsAfter,
               停电计时: +AI079.darkT.toFixed(1), 记录灯数: AI079.darkLights.length };
    })()`);
    console.log('④ 停电封锁:', JSON.stringify(t4));

    // ⑤ 特斯拉过充：杀人不杀 SCP
    const t5 = await ev(`(function(){
      AI079.tier = 3; AI079.ap = 200; AI079.teslaT = 0;
      // 把一个队友和一个 SCP 都挪到第一台特斯拉门旁边
      const t = AI079.teslas[0];
      const ally = ALLY_LIST.find(a => a.alive);
      const scp = SCP_LIST.find(s => s.alive);
      if (ally) ally.pos.set(t.x + 1.5, 0, t.z);
      if (scp) scp.pos.set(t.x - 1.5, 0, t.z);
      const scpHpBefore = scp ? scp.hp : -1;
      // 把摄像头挪到那台门附近才能触发（34m 内）
      let best = 0, bd = 1e9;
      AI079.cams.forEach((c, i) => { const d = Math.hypot(c.x - t.x, c.z - t.z); if (d < bd) { bd = d; best = i; } });
      o79Goto(best);
      const apBefore = AI079.ap;
      o79TeslaFire();
      return { 队友存活: ally ? ally.alive : null, SCP存活: scp ? scp.alive : null,
               SCP血量不变: scp ? scp.hp === scpHpBefore : null,
               AP消耗: +(apBefore - AI079.ap).toFixed(0), 击杀数: AI079.teslaKills };
    })()`);
    console.log('⑤ 特斯拉过充:', JSON.stringify(t5));

    // ⑥ 打不死 + SCP 不追
    const t6 = await ev(`(function(){
      const hp0 = player.hp;
      player.damage(9999, null, {});
      const scp = SCP_LIST.find(s => s.alive);
      if (scp) { scp.target = null; pickTarget(scp); }
      return { 受伤后HP: player.hp, 未被伤害: player.hp === hp0,
               SCP目标: scp ? (scp.target === player ? '玩家（不该）' : (scp.target ? '队友/其他' : '无')) : '无存活SCP' };
    })()`);
    console.log('⑥ 打不死:', JSON.stringify(t6));

    // ⑦ 升级
    const t7 = await ev(`(function(){
      AI079.tier = 1; AI079.exp = 0;
      const need = O79_EXP_NEXT[0];
      o79AddExp(need + 1);
      return { 升级后Tier: AI079.tier, AP上限: o79APMax(), 回充速率: o79Regen() };
    })()`);
    console.log('⑦ 升级:', JSON.stringify(t7));

    // ⑧ 胜负判定
    const t8 = await ev(`(function(){
      // 先测败北：把其他 SCP 全清掉
      for (const s of SCP_LIST) { s.alive = false; }
      return { 存活SCP: o79SCPsAlive() };
    })()`);
    await wait(1500);
    const t8b = await ev(`({ over: GAME.over, won: GAME.won, title: (document.getElementById('endTitle')||{}).textContent })`);
    console.log('⑧ 败北判定:', JSON.stringify(t8), '→', JSON.stringify(t8b));

    // ⑨ 胜利判定：人类清零
    await ev('location.reload()');
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5000);
    const t9 = await ev(`(function(){
      // 把所有人类抹掉（队友 + 人员 + 入侵势力）
      for (const a of ALLY_LIST) a.alive = false;
      for (const p of PERSONNEL_LIST) p.alive = false;
      for (const f of FACTION_LIST) f.alive = false;
      return { 人类: o79Humans(), 收容物: o79SCPsAlive() };
    })()`);
    await wait(1600);
    const t9b = await ev(`({ over: GAME.over, won: GAME.won, title: (document.getElementById('endTitle')||{}).textContent })`);
    console.log('⑨ 胜利判定:', JSON.stringify(t9), '→', JSON.stringify(t9b));

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
