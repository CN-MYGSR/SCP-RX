'use strict';
/* =====================================================================
   设施存活人员 + 伤害加成 + 敌对可射性 + 3114 伪装 验证
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8805;
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
  const ud = path.join(os.tmpdir(), 'scprx-per-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9351', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9351/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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

    // ① 生成
    const t1 = await ev(`({
      总数: PERSONNEL_LIST.length,
      分类: { D级: personnelAlive('classd'), 研究员: personnelAlive('scientist'), 保安: personnelAlive('guard') },
      初始加成: { 异常: GAME.bonusAnomaly, 敌对: GAME.bonusHostile },
      房间: PERSONNEL_LIST.map(p => p.kind + '@' + Math.round(p.pos.x) + ',' + Math.round(p.pos.z)),
    })`);
    console.log('① 人员生成:', JSON.stringify(t1));

    // ② 玩家能不能打到敌对势力（射线必须包含 FACTION_LIST）
    const t2 = await ev(`(function(){
      GAME.elapsed = 301; checkFactionSchedule();
      const a = FACTION_LIST.find(x=>x.alive);
      const px = a.pos.x, pz = a.pos.z + 6;
      const hit = raycastSCPs(V3(px, 1.4, pz), V3(0,0,-1), 100);
      return { 敌对存在: !!a, 命中: hit ? (hit.isHostile ? '敌对单位' : 'SCP') : '没打中',
               命中对象: hit && hit.ent ? hit.ent.name : (hit && hit.scp ? hit.scp.name : '-') };
    })()`);
    console.log('② 射线命中敌对:', JSON.stringify(t2));

    // ③ 对敌对伤害加成生效
    const t3 = await ev(`(function(){
      const a = FACTION_LIST.find(x=>x.alive);
      GAME.bonusHostile = 1;
      a.hp = 1000;
      const before = a.hp;
      a.damage(100 * GAME.bonusHostile, player, {});
      const d1 = before - a.hp;
      GAME.bonusHostile = 4;
      a.hp = 1000;
      a.damage(100 * GAME.bonusHostile, player, {});
      const d4 = 1000 - a.hp;
      GAME.bonusHostile = 1;   // 复原，别污染后面的用例
      return { 无加成伤害: d1, 四倍加成伤害: d4 };
    })()`);
    console.log('③ 对敌对伤害加成:', JSON.stringify(t3));

    // ④ 研究员护送：靠近招募 → 送到入口大堂 → 撤离 + 加成 + 转职
    const t4 = await ev(`(function(){
      const p = PERSONNEL_LIST.find(x => x.kind === 'scientist' && x.alive);
      const ez = escapeZonePos();
      const alliesBefore = ALLY_LIST.length;
      player.pos.set(p.pos.x + 1.5, 0, p.pos.z);
      p.threatT = 0; p.state = 'idle';
      return { 研究员: p.name, 位置: [Math.round(p.pos.x), Math.round(p.pos.z)],
               大堂: [Math.round(ez.x), Math.round(ez.z)], 队友数: alliesBefore,
               加成前: GAME.bonusAnomaly };
    })()`);
    console.log('④ 护送前:', JSON.stringify(t4));
    await wait(2500);
    const t4b = await ev(`(function(){
      const p = PERSONNEL_LIST.find(x => x.kind === 'scientist' && x.alive);
      return { 状态: p ? p.state : '（已不在列表）', 已招募: p ? (p.state === 'follow') : null };
    })()`);
    console.log('   → 靠近后:', JSON.stringify(t4b));
    // 直接把研究员挪到大堂
    await ev(`(function(){
      const p = PERSONNEL_LIST.find(x => x.kind === 'scientist' && x.alive);
      const ez = escapeZonePos();
      if (p) { p.pos.set(ez.x, 0, ez.z); p.state = 'follow'; }
    })()`);
    await wait(2000);
    const t4c = await ev(`({
      加成后: { 异常: GAME.bonusAnomaly, 敌对: GAME.bonusHostile },
      已护送研究员: GAME.rescued.scientist,
      队友数: ALLY_LIST.length,
      剩余研究员: personnelAlive('scientist'),
    })`);
    console.log('   → 抵达大堂后:', JSON.stringify(t4c));

    // ⑤ 保安护送
    await ev(`(function(){
      const p = PERSONNEL_LIST.find(x => x.kind === 'guard' && x.alive);
      const ez = escapeZonePos();
      if (p) { p.pos.set(ez.x + 1, 0, ez.z); p.state = 'follow'; }
    })()`);
    await wait(2000);
    const t5 = await ev(`({
      加成: { 异常: GAME.bonusAnomaly, 敌对: GAME.bonusHostile },
      已护送保安: GAME.rescued.guard,
    })`);
    console.log('⑤ 保安护送后:', JSON.stringify(t5));

    // ⑥ D 级逃脱 → CI 提前
    const t6 = await ev(`(function(){
      const before = FACTION_SCHEDULE.ciAt;
      const p = PERSONNEL_LIST.find(x => x.kind === 'classd' && x.alive);
      const ez = escapeZonePos();
      if (p) { p.pos.set(ez.x - 1, 0, ez.z); p.state = 'escape'; }
      return { ciAt前: before, D级在场: personnelAlive('classd') };
    })()`);
    console.log('⑥ D 级逃脱前:', JSON.stringify(t6));
    await wait(2200);
    const t6b = await ev(`({
      ciAt后: FACTION_SCHEDULE.ciAt, 已逃脱D级: GAME.classdEscaped,
      D级在场: personnelAlive('classd'),
    })`);
    console.log('   → 逃脱后:', JSON.stringify(t6b));

    // ⑦ 异常伤害加成真的作用到 damageSCP
    const t7 = await ev(`(function(){
      const s = SCP_LIST.find(v => v.key === '682');   // 血厚、免疫少
      s.hp = 100000; s.enraged = true; s.observed = true;
      const keep = GAME.protocol;
      GAME.protocol = false;
      GAME.bonusAnomaly = 1;
      let h0 = s.hp; damageSCP(s, 100, { byPlayer: true, from: player }); const d1 = h0 - s.hp;
      GAME.bonusAnomaly = 8;
      h0 = s.hp; damageSCP(s, 100, { byPlayer: true, from: player }); const d8 = h0 - s.hp;
      GAME.bonusAnomaly = 8; GAME.protocol = keep;
      return { 一倍加成: d1, 八倍加成: d8, 比值: +(d8 / d1).toFixed(2) };
    })()`);
    console.log('⑦ 异常伤害加成:', JSON.stringify(t7));

    // ⑧ 3114 的伪装
    const t8 = await ev(`(function(){
      const s = SCP_LIST.find(v => v.key === '3114');
      if (!s) return { err: '没有 3114' };
      const before = { disguised: s.disguised, 伪装对象: s.disguiseName,
                       伪装模型: !!(s.disguise && s.disguise.group), 骨架可见: s.model.group.visible };
      // 把玩家放到它旁边，触发露馅
      player.pos.set(s.pos.x, 0, s.pos.z + 3);
      s.active = true;
      return before;
    })()`);
    console.log('⑧ 3114 伪装:', JSON.stringify(t8));
    await wait(2000);
    const t8b = await ev(`(function(){
      const s = SCP_LIST.find(v => v.key === '3114');
      return { disguised: s.disguised, 骨架可见: s.model.group.visible,
               伪装模型可见: !!(s.disguise && s.disguise.group.visible) };
    })()`);
    console.log('   → 靠近后:', JSON.stringify(t8b));

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
