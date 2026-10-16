'use strict';
/* =====================================================================
   SCP 目标选择 + 人员自主撤离 验证
   ① SCP 选目标改成「最近的人」—— 玩家不再无条件被优先
      · 玩家很远 + 保安很近 → 打保安（修复前一定是打玩家）
      · 玩家最近 → 打玩家
      · 队友最近 → 打队友
      · 势力（CI）最近 → 打势力
      · 人员 / 势力确实进了候选名单
   ② 保安 / 研究员等够时间会自己往出口走
   ③ 自己走的 vs 玩家护送的：只有护送才结算伤害加成

   ⚠️ 断言器自检：故意跑一条必然失败的断言，证明它能报红。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8840;
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
  const ud = path.join(os.tmpdir(), 'scprx-tgt-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9386', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9386/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(300);
    await ev('document.getElementById("deployGo").click()');
    await wait(4200);

    // ---------- ① SCP 目标选择 ----------
    console.log('\n① SCP 选目标：最近优先');
    const tgt = await ev(`(function(){
      const out = {};
      const s = SCP_LIST.find(x => x.alive);
      if (!s) return { err: '场上没有 SCP' };
      if (!FACTION_LIST.some(a => a.alive)) { spawnFaction('ci', 3); spawnFaction('hand', 2); }
      // ⚠️ MTF 队友要开局 60 秒后才进场 —— 测试跑得太早 ALLY_LIST 还是空的，
      //    不补这一句，"队友最近"那一格会因为 a 是 undefined 而测不出东西。
      if (!ALLY_LIST.some(x => x.alive)) { GAME.elapsed = 61; checkMtfDeploy(); }
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      const a = ALLY_LIST.find(x => x.alive);
      const f = FACTION_LIST.find(x => x.alive);
      player.isAI = false; player.isSCP = false; player.alive = true;
      const who = () => (s.target === player ? '玩家'
        : (s.target === g ? '保安' : (s.target === a ? '队友' : (s.target === f ? '势力' : (s.target ? '其它' : '无')))));
      const park = () => {
        // ⚠️ 必须把**所有**候选挪远 —— 只挪几个特定对象的话，
        //    列表里剩下的某个 NPC 可能比"最近的那个"还近，测出来就是"其它"。
        let i = 0;
        player.pos.set(s.pos.x + 400, 0, s.pos.z);
        for (const x of ALLY_LIST) x.pos.set(s.pos.x + 400, 0, s.pos.z + 200 + (i++));
        for (const x of PERSONNEL_LIST) x.pos.set(s.pos.x + 400, 0, s.pos.z + 400 + (i++));
        for (const x of FACTION_LIST) x.pos.set(s.pos.x + 400, 0, s.pos.z + 600 + (i++));
        for (const x of SCP_LIST) if (x !== s) x.pos.set(s.pos.x + 800, 0, s.pos.z + 800 + (i++));
      };
      // A：玩家极远，保安很近 —— 修复前这里一定选玩家
      park(); if (g) g.pos.set(s.pos.x + 6, 0, s.pos.z);
      pickTarget(s); out.远玩家近保安 = who();
      // B：玩家最近
      park(); player.pos.set(s.pos.x + 3, 0, s.pos.z);
      pickTarget(s); out.玩家最近 = who();
      // C：队友最近
      park(); if (a) a.pos.set(s.pos.x + 4, 0, s.pos.z);
      pickTarget(s); out.队友最近 = who();
      // D：势力最近
      park(); if (f) f.pos.set(s.pos.x + 5, 0, s.pos.z);
      pickTarget(s); out.势力最近 = who();
      out.候选含人员 = !!(g && g.alive);
      out.候选含势力 = !!(f && f.alive);
      return out;
    })()`);
    console.log('   ' + JSON.stringify(tgt));
    check('★ 玩家很远 + 保安很近 → 打保安（不再死追玩家）', tgt.远玩家近保安 === '保安', tgt.远玩家近保安);
    check('玩家最近时仍然打玩家', tgt.玩家最近 === '玩家', tgt.玩家最近);
    check('队友最近时打队友', tgt.队友最近 === '队友', tgt.队友最近);
    check('势力最近时打势力（CI / 蛇之手 也在候选里）', tgt.势力最近 === '势力', tgt.势力最近);

    // ---------- ② 人员自主撤离 ----------
    console.log('\n② 保安 / 研究员自己往出口走');
    const evac = await ev(`(function(){
      // 清场：把 SCP 和势力挪远，免得他们进入"逃跑"状态而不是"撤离"
      for (const s of SCP_LIST) s.pos.set(9000, 0, 9000);
      for (const f of FACTION_LIST) f.pos.set(9100, 0, 9100);
      player.pos.set(9200, 0, 9200);
      GAME.elapsed = 300;            // 超过 SELF_EVAC_AT(240)
      GAME.selfEvacTold = false;
      const ez = escapeZonePos();
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      const sc = PERSONNEL_LIST.find(p => p.kind === 'scientist' && p.alive && !p.escaped);
      if (!g || !sc) return { err: '场上没有保安 / 研究员' };
      g.state = 'idle'; sc.state = 'idle';
      g.threat = null; g.threatD = 99; sc.threat = null; sc.threatD = 99;
      const d0 = [Math.hypot(ez.x - g.pos.x, ez.z - g.pos.z), Math.hypot(ez.x - sc.pos.x, ez.z - sc.pos.z)];
      for (let i = 0; i < 600; i++) {          // 10 秒
        g.threat = null; g.threatD = 99; sc.threat = null; sc.threatD = 99;
        updatePersonnel(1 / 60);
      }
      const d1 = [Math.hypot(ez.x - g.pos.x, ez.z - g.pos.z), Math.hypot(ez.x - sc.pos.x, ez.z - sc.pos.z)];
      return { 保安状态: g.state, 研究员状态: sc.state,
               保安靠近出口: +(d0[0] - d1[0]).toFixed(1), 研究员靠近出口: +(d0[1] - d1[1]).toFixed(1),
               播报过: GAME.selfEvacTold };
    })()`);
    console.log('   ' + JSON.stringify(evac));
    check('保安进入"自行撤离"状态', evac.保安状态 === 'evacuate', evac.保安状态);
    check('研究员进入"自行撤离"状态', evac.研究员状态 === 'evacuate', evac.研究员状态);
    check('保安在向出口移动', evac.保安靠近出口 > 3, '靠近 ' + evac.保安靠近出口 + ' 米');
    check('研究员在向出口移动', evac.研究员靠近出口 > 3, '靠近 ' + evac.研究员靠近出口 + ' 米');
    check('会播报一次"开始自行撤离"', evac.播报过 === true);

    // 时间没到时不应该自己撤
    const evacEarly = await ev(`(function(){
      GAME.elapsed = 60;             // 还没到 SELF_EVAC_AT
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      if (!g) return { err: 'no guard' };
      g.state = 'idle'; g.threat = null; g.threatD = 99;
      // ⚠️ 把"家"设在当前位置 —— 上一段测试已经把他挪到离 home 很远的地方了，
      //    不重置的话 idle 的"踱步回家"会被算成"在往出口走"。
      g.homeX = g.pos.x; g.homeZ = g.pos.z;
      const d0 = Math.hypot(escapeZonePos().x - g.pos.x, escapeZonePos().z - g.pos.z);
      for (let i = 0; i < 600; i++) { g.threat = null; g.threatD = 99; updatePersonnel(1 / 60); }
      const d1 = Math.hypot(escapeZonePos().x - g.pos.x, escapeZonePos().z - g.pos.z);
      return { 状态: g.state, 靠近出口: +(d0 - d1).toFixed(1) };
    })()`);
    console.log('   ' + JSON.stringify(evacEarly));
    check('时间没到时仍在原地待命（保留护送窗口）',
      evacEarly.状态 === 'idle' && evacEarly.靠近出口 < 3,
      evacEarly.状态 + ' / 靠近 ' + evacEarly.靠近出口 + ' 米');

    // ---------- ③ 护送 vs 自己走 ----------
    console.log('\n③ 只有玩家护送才结算加成');
    const bonus = await ev(`(function(){
      const out = {};
      GAME.rescued.scientist = 0;
      let s = PERSONNEL_LIST.find(p => p.kind === 'scientist' && p.alive && !p.escaped);
      if (!s) return { err: 'no scientist' };
      s.state = 'evacuate';
      personnelEscape(s, false);            // 自己走
      out.自己走的加成 = GAME.rescued.scientist;

      GAME.rescued.scientist = 0;
      s = PERSONNEL_LIST.find(p => p.kind === 'scientist' && p.alive && !p.escaped);
      if (!s) return Object.assign(out, { err: '研究员不够用了' });
      s.state = 'follow';
      personnelEscape(s, true);             // 玩家护送
      out.护送的加成 = GAME.rescued.scientist;
      out.对异常倍率 = GAME.bonusAnomaly;
      return out;
    })()`);
    console.log('   ' + JSON.stringify(bonus));
    check('自己走进出口 → 不结算加成', bonus.自己走的加成 === 0, '加成 ' + bonus.自己走的加成);
    check('玩家护送 → 正常结算加成', bonus.护送的加成 === 1, '加成 ' + bonus.护送的加成);

    // ---------- 断言器自检 ----------
    console.log('\n④ 断言器自检');
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
