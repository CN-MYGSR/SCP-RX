'use strict';
/* =====================================================================
   净化行动（市区 · Beta-7）验证
   ① 行动已注册：MISSION_ORDER 里有 city，菜单能渲染出这张卡
   ② 角色固定：rollPoolFor('city') 只返回 beta7（不会混进 MTF / 保安）
   ③ 地图：FAC.mode === 'city'，楼房生成出来了，出生点 / 撤离点可走
   ④ 感染源：正好 3 处，带 isInfectionSource 标记，能交互关闭
   ⑤ 感染者：开局生成 8 个，能被打死
   ⑥ 扩散：感染源没关完时会持续生成；全关之后停止
   ⑦ 目标链：source → purge_infected → extract，撤离点按条件解锁
   ⑧ 全清 + 撤离 → 判定胜利

   ⚠️ 断言器自检：故意跑一条必然失败的断言，证明它能报红。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8841;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); pass++; }
  else { console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); fail++; }
}

(async () => {
  const server = http.createServer((req, rq) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end(); return; }
    rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(rq);
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const ud = path.join(os.tmpdir(), 'scprx-city-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9387', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9387/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
      const pg = list.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await wait(250);
  }
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map(); const events = [];
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) events.push(m); });
  const send = (mth, prm) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: mth, params: prm || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + mth)); } }, 90000); });
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

    // ---------- ① 行动注册 ----------
    console.log('\n① 行动注册');
    const reg = await ev(`(function(){
      renderMissions();
      return {
        在顺序表里: MISSION_ORDER.indexOf('city') >= 0,
        菜单有卡片: !!document.querySelector('#missionRow .presetCard[data-m="city"]'),
        名称: MISSIONS.city ? MISSIONS.city.name : null,
        地图: MISSIONS.city ? MISSIONS.city.map : null,
      };
    })()`);
    console.log('   ' + JSON.stringify(reg));
    check('city 已加入 MISSION_ORDER', reg.在顺序表里 === true);
    check('菜单渲染出了净化行动卡片', reg.菜单有卡片 === true, reg.名称);
    check('地图指向 city', reg.地图 === 'city', String(reg.地图));

    // ---------- ② 角色固定 ----------
    console.log('\n② 角色固定为 Beta-7');
    const pool = await ev(`(function(){
      const s = {};
      for (let i = 0; i < 20; i++) { const k = rollRole(); s[k] = (s[k] || 0) + 1; }
      return { 池子: rollPoolFor('city'), 其它行动池子大小: { breach: rollPoolFor('breach').length, fivek: rollPoolFor('fivek').length }, 抽20次: s };
    })()`);    console.log('   ' + JSON.stringify(pool));
    check('city 的随机池只有 beta7', pool.池子.length === 1 && pool.池子[0] === 'beta7', JSON.stringify(pool.池子));
    check('其它行动的池子没被影响', pool.其它行动池子大小.breach > 1 && pool.其它行动池子大小.fivek > 1,
      JSON.stringify(pool.其它行动池子大小));

    // ---------- 进游戏 ----------
    await ev(`(function(){ GAME.mission = 'city'; GAME.role = 'beta7'; GAME.roleRolled = true; })()`);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5500);

    // ---------- ③ 地图 ----------
    console.log('\n③ 市区地图');
    const map = await ev(`({
      模式: FAC.mode, 楼房数: CITY.buildings.length,
      感染源数: FAC.breakers.length,
      出生点: FAC.spawn ? [Math.round(FAC.spawn.x), Math.round(FAC.spawn.z)] : null,
      撤离点: FAC.extract ? [Math.round(FAC.extract.x), Math.round(FAC.extract.z)] : null,
      出生点可走: openAtWorld(FAC.spawn.x, FAC.spawn.z, 0),
      撤离点可走: openAtWorld(FAC.extract.x, FAC.extract.z, 0),
      玩家位置: [Math.round(player.pos.x), Math.round(player.pos.z)],
      身份: currentRole().id, 身份名: roleView().name,
      目标链: currentObjectives().map(o => o.id),
      人类队友: ALLY_LIST.length, 设施人员: PERSONNEL_LIST.length, 设施收容物: SCP_LIST.length,
    })`);
    console.log('   ' + JSON.stringify(map));
    check('地图切到了市区模式', map.模式 === 'city', map.模式);
    check('楼房生成出来了', map.楼房数 >= 12, map.楼房数 + ' 栋');
    check('出生点可走', map.出生点可走 === true, JSON.stringify(map.出生点));
    check('撤离点可走', map.撤离点可走 === true, JSON.stringify(map.撤离点));
    check('玩家落位在地图上', Math.abs(map.玩家位置[0]) < 90 && Math.abs(map.玩家位置[1]) < 90, JSON.stringify(map.玩家位置));
    check('身份是 Beta-7', map.身份 === 'beta7', map.身份名);
    check('目标链正确', JSON.stringify(map.目标链) === JSON.stringify(['source', 'purge_infected', 'extract']),
      JSON.stringify(map.目标链));
    check('市区里没有设施收容物 / 人员 / 队友',
      map.设施收容物 === 0 && map.设施人员 === 0 && map.人类队友 === 0,
      'SCP ' + map.设施收容物 + ' / 人员 ' + map.设施人员 + ' / 队友 ' + map.人类队友);

    // ---------- ④ 感染源 ----------
    console.log('\n④ 感染源');
    const src = await ev(`({
      数量: FAC.breakers.length,
      都是感染源: FAC.breakers.every(b => b.isInfectionSource === true),
      都未关闭: FAC.breakers.every(b => !b.done),
      有长按时长: FAC.breakers.every(b => (b.holdNeed || 0) > 0),
      名称: FAC.breakers.map(b => b.name),
    })`);
    console.log('   ' + JSON.stringify(src));
    check('正好 3 处感染源', src.数量 === 3, src.数量 + ' 处');
    check('都带 isInfectionSource 标记', src.都是感染源 === true);
    check('都能长按交互', src.有长按时长 === true);

    // ---------- ⑤ 感染者 ----------
    console.log('\n⑤ 被感染者');
    const inf = await ev(`({
      初始数量: INFECTED.length,
      全部存活: INFECTED.every(m => m.alive),
      有模型: INFECTED.every(m => m.group && m.group.parent),
      初始已生成计数: GAME.cityState.spawned,
    })`);
    console.log('   ' + JSON.stringify(inf));
    check('开局生成 8 个感染者', inf.初始数量 === 8, inf.初始数量 + ' 个');
    check('感染者都有模型', inf.有模型 === true);

    const kill1 = await ev(`(function(){
      const before = INFECTED.filter(m => m.alive).length, k0 = player.kills;
      const m = INFECTED.find(x => x.alive);
      m.damage(9999, player, { limb: 'torso' });
      updateInfected(0.016);
      return { 击杀前: before, 击杀后: INFECTED.filter(x => x.alive).length, 击杀数增量: player.kills - k0 };
    })()`);
    console.log('   击杀: ' + JSON.stringify(kill1));
    check('感染者能被打死', kill1.击杀后 === kill1.击杀前 - 1, kill1.击杀前 + ' → ' + kill1.击杀后);
    check('击杀计入战绩', kill1.击杀数增量 === 1);

    // ---------- ⑥ 扩散 ----------
    console.log('\n⑥ 感染扩散');
    const spreadOn = await ev(`(function(){
      const before = INFECTED.filter(m => m.alive).length;
      GAME.cityState.spreadT = 0.001;
      updateInfectionSpread(0.01);
      return { 源未关时前: before, 源未关时后: INFECTED.filter(m => m.alive).length,
               剩余源: FAC.breakers.filter(b => !b.done).length };
    })()`);
    console.log('   ' + JSON.stringify(spreadOn));
    check('感染源没关完时会继续扩散',
      spreadOn.源未关时后 > spreadOn.源未关时前,
      spreadOn.源未关时前 + ' → ' + spreadOn.源未关时后);

    const closeSrc = await ev(`(function(){
      for (const b of FAC.breakers) if (!b.done) onInfectionSourceDone(b);
      const before = INFECTED.filter(m => m.alive).length;
      GAME.cityState.spreadT = 0.001;
      updateInfectionSpread(0.01);
      return { 源全关: FAC.breakers.every(b => b.done),
               关闭后数量不变: INFECTED.filter(m => m.alive).length === before };
    })()`);
    console.log('   ' + JSON.stringify(closeSrc));
    check('感染源全部关闭', closeSrc.源全关 === true);
    check('源全关后不再扩散', closeSrc.关闭后数量不变 === true);

    // ---------- ⑦ 目标状态 ----------
    console.log('\n⑦ 目标与撤离条件');
    const st1 = await ev(`(function(){
      const st = objectiveStatus();
      return { source: st.source, purge: st.purge_infected, extract: st.extract,
               剩余源: st._sourcesLeft, 剩余感染者: st._infectedLeft,
               撤离就绪: extractReady() };
    })()`);
    console.log('   ' + JSON.stringify(st1));
    check('感染源目标已完成', st1.source === 'done', st1.source);
    check('还有感染者时清剿未完成', st1.purge === 'active', st1.purge);
    check('还有感染者时撤离未解锁', st1.撤离就绪 === false);

    const st2 = await ev(`(function(){
      for (const m of INFECTED) if (m.alive) m.damage(9999, player, { limb: 'torso' });
      updateInfected(0.016);
      const st = objectiveStatus();
      return { purge: st.purge_infected, extract: st.extract, 剩余感染者: st._infectedLeft,
               撤离就绪: extractReady() };
    })()`);
    console.log('   ' + JSON.stringify(st2));
    check('清空后清剿目标完成', st2.purge === 'done', st2.purge);
    check('清空后撤离解锁', st2.extract === 'active' && st2.撤离就绪 === true);

    // ---------- ⑧ 撤离 → 胜利 ----------
    console.log('\n⑧ 撤离结算');
    await ev(`(function(){
      GAME.extractCd = 0;
      onExtractionDone();
    })()`);
    await wait(900);
    const end = await ev(`({
      over: GAME.over, won: GAME.won,
      标题: (document.getElementById('endTitle') || {}).textContent,
      副标题: (document.getElementById('endSub') || {}).textContent,
      统计: (document.getElementById('endStats') || {}).textContent,
    })`);
    console.log('   ' + JSON.stringify(end));
    check('撤离后游戏结束', end.over === true);
    check('判定为胜利', end.won === true);
    check('标题是"疫区已清空"', String(end.标题).indexOf('疫') >= 0, String(end.标题));
    check('结算里有"关闭感染源"这一项', String(end.统计).indexOf('关闭感染源') >= 0);
    check('结算里有"清除被感染者"这一项', String(end.统计).indexOf('清除被感染者') >= 0);

    // ---------- ⑨ 回归：射线能打到感染者 / 别的行动不刷感染者 ----------
    console.log('\n⑨ 跨行动回归');
    const cross = await ev(`(function(){
      const out = {};
      GAME.mission = 'city';
      INFECTED.length = 0;
      const park = (list) => { for (const q of list) q.pos.set(9000, 0, 9000 + Math.random()); };
      park(SCP_LIST); park(ALLY_LIST); park(PERSONNEL_LIST); park(FACTION_LIST);
      const e = spawnInfected(player.pos.x, player.pos.z - 5);
      e.pos.set(player.pos.x, 0, player.pos.z - 5);
      player.alive = true; player.isSCP = false; player.isAI = false;
      const hit = raycastSCPs(V3(player.pos.x, player.pos.y + 1.2, player.pos.z), V3(0, 0, -1), 40);
      out.射线命中感染者 = !!(hit && hit.ent === e && hit.isHostile);
      out.命中谁 = hit ? (hit.ent === e ? '感染者' : '其它') : '无';
      // 打死它：确认伤害真的结算了
      const hp0 = e.hp;
      e.damage(30, player, { head: false });
      out.掉血 = Math.round(hp0 - e.hp);

      // 切到落锤行动：那边也有 3 个"未关闭的 breaker"，但不该刷感染者
      GAME.mission = 'breach';
      const n0 = INFECTED.length;
      GAME.cityState.spreadT = 0.001;
      updateInfectionSpread(0.01);
      out.落锤行动刷出 = INFECTED.length - n0;
      updateInfected(0.016);              // 也不该跑感染者逻辑
      out.落锤行动感染者数 = INFECTED.length;
      GAME.mission = 'city';
      return out;
    })()`);
    console.log('   ' + JSON.stringify(cross));
    check('★ 射线能选中被感染者', cross.射线命中感染者 === true, cross.命中谁);
    check('★ 打感染者会正常掉血', cross.掉血 === 30, '掉了 ' + cross.掉血);
    check('★ 非净化行动不会刷感染者', cross.落锤行动刷出 === 0,
      '落锤行动里刷出了 ' + cross.落锤行动刷出 + ' 个');

    const bright = await ev(`({ 太阳: ENV.city.sun[1], 半球: ENV.city.hemi[2], 雾近: ENV.city.fog[1] })`);
    console.log('   市区环境: ' + JSON.stringify(bright));
    check('市区亮度已上调（夜视仪才救得回来）', bright.太阳 >= 0.6 && bright.半球 >= 0.75,
      'sun=' + bright.太阳 + ' hemi=' + bright.半球);

    // ---------- 断言器自检 ----------
    console.log('\n⑩ 断言器自检');
    const fb = fail;
    check('[自检] 这条故意失败', false, '看到 ✅ 说明断言器坏了');
    check('断言器确实能报红', fail === fb + 1);
    fail = fb;

    collect();
  } catch (e) {
    console.error('测试异常:', e.message);
    errs.push('HARNESS: ' + e.message);
  } finally {
    ws.close(); chrome.kill(); server.close();
  }

  console.log('\n================ 结果 ================');
  console.log('断言 ' + pass + ' 通过 / ' + fail + ' 失败');
  if (!errs.length) console.log('✅ 控制台无错误');
  else [...new Set(errs)].slice(0, 20).forEach(e => console.log('  ❌ ' + e));
  process.exit((errs.length || fail) ? 1 : 0);
})();
