'use strict';
/* =====================================================================
   设施保安的敌意矩阵验证
   规则：同阵营不打，敌对阵营才打。
   5K 里抽到 MTF = Nu-22（站点全员敌对）；抽到保安/科学家则同僚不开火。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8833;
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
  const ud = path.join(os.tmpdir(), 'scprx-hos-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9379', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9379/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await wait(3400);

    // 纯逻辑矩阵（不用真的进游戏）
    // ⚠️ 必须先让 player.alive = true —— 菜单里玩家还没部署，
    //    guardsHostileToPlayer() 第一行就会因为 !player.alive 直接返回 false。
    const m = await ev(`(function(){
      player.alive = true; player.isAI = false; player.isSCP = false;
      const out = {};
      for (const mission of ['breach', 'fivek']) {
        GAME.mission = mission;
        out[mission] = {};
        for (const r of ['mtf','guard','scientist','classd','ci','o79','p173']) {
          GAME.role = r;
          out[mission][r] = guardsHostileToPlayer();
        }
      }
      GAME.mission = 'breach'; GAME.role = 'mtf';
      return out;
    })()`);
    const tag = (b) => b ? '打' : '不打';
    console.log('设施保安对玩家的敌意（打 / 不打）:');
    console.log('  身份'.padEnd(12) + '落锤行动   5K 行动');
    for (const r of ['mtf', 'guard', 'scientist', 'classd', 'ci', 'o79', 'p173']) {
      console.log('  ' + r.padEnd(14) + tag(m.breach[r]).padEnd(10) + tag(m.fivek[r]));
    }
    console.log('');
    // 关键断言
    const checks = [
      ['5K · 保安玩家不被同僚打', m.fivek.guard === false],
      ['5K · 科学家玩家不被保安打', m.fivek.scientist === false],
      ['5K · Nu-22(MTF) 被站点打', m.fivek.mtf === true],
      ['5K · Class-D 被打', m.fivek.classd === true],
      ['落锤 · 保安玩家不被同僚打', m.breach.guard === false],
      ['落锤 · MTF 不被保安打', m.breach.mtf === false],
      ['落锤 · CI 玩家被保安打', m.breach.ci === true],
      ['收容物玩家被保安打', m.breach.p173 === true && m.fivek.p173 === true],
    ];
    let bad = 0;
    for (const [n, ok] of checks) { console.log('  ' + (ok ? '✅' : '❌') + ' ' + n); if (!ok) bad++; }

    // 实跑一次：5K 抽到保安，站到保安面前，不该掉血
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=guard' });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.querySelector(\'#missionRow .presetCard[data-m="fivek"]\').click()');
    await wait(400);
    await ev('GAME.role = "guard";');
    await ev('document.getElementById("deployGo").click()');
    await wait(5200);
    // 对称性：保安打不打你 ↔ 你能不能打保安 / 科学家
    // （这个坑踩过三次：射线目标范围写死了阵营假设，导致"他们打得到我、我打不到他们"）
    const sym = await ev(`(function(){
      player.alive = true; player.isAI = false; player.isSCP = false;
      const keepMission = GAME.mission, keepRole = GAME.role;   // 跑完要还回去
      const park = (list) => list.forEach((q, i) => q.pos.set(900, 0, 900 + i * 4));
      const out = {};
      for (const mission of ['breach','fivek']) {
        GAME.mission = mission;
        out[mission] = {};
        for (const r of ['mtf','guard','scientist','classd','ci','o79','p173']) {
          GAME.role = r;
          const canHit = {};
          for (const kind of ['scientist','guard','classd']) {
            const p = PERSONNEL_LIST.find(x => x.kind === kind && x.alive && !x.escaped);
            if (!p) { canHit[kind] = null; continue; }
            park(PERSONNEL_LIST); park(SCP_LIST);
            p.pos.set(player.pos.x, 0, player.pos.z - 5);
            const hit = raycastSCPs(V3(player.pos.x, player.pos.y + 1.2, player.pos.z), V3(0,0,-1), 40);
            canHit[kind] = !!(hit && hit.isHostile && hit.ent === p);
          }
          out[mission][r] = { 保安打我: guardsHostileToPlayer(),
                              能打保安: canHit.guard, 能打科学家: canHit.scientist, 能打D级: canHit.classd };
        }
      }
      GAME.mission = keepMission; GAME.role = keepRole;
      return out;
    })()`);
    console.log('');
    console.log('对称性（他们打我 ↔ 我能打他们）:');
    console.log('  身份'.padEnd(12) + '行动'.padEnd(8) + '保安打我  能打保安  能打科学家  能打D级');
    let asym = 0;
    for (const mission of ['breach', 'fivek']) {
      for (const r of ['mtf', 'guard', 'scientist', 'classd', 'ci', 'o79', 'p173']) {
        const v = sym[mission][r];
        const yn = (b) => b ? '是' : '否';
        const bad = v.保安打我 !== v.能打保安;   // 对称性：他对你开火，你就该能打他
        if (bad) asym++;
        console.log('  ' + r.padEnd(14) + mission.padEnd(10) + yn(v.保安打我).padEnd(10)
          + yn(v.能打保安).padEnd(10) + yn(v.能打科学家).padEnd(12) + yn(v.能打D级) + (bad ? '   ❌ 不对称' : ''));
      }
    }
    console.log(asym === 0 ? '  ✅ 保安的敌意与可射击性完全对称' : '  ❌ 有 ' + asym + ' 处不对称');
    // 5K 的 Nu-22 必须能打科学家和保安
    const nu22ok = sym.fivek.mtf.能打科学家 && sym.fivek.mtf.能打保安;
    console.log((nu22ok ? '  ✅' : '  ❌') + ' 5K · Nu-22 能攻击科学家与保安');

    const r1 = await ev(`(function(){
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      if (!g) return { err: '没有保安' };
      player.pos.set(g.pos.x + 5, 0, g.pos.z);
      player.hp = player.maxHp;
      g.atkCd = 0;
      return { 玩家身份: currentRole().id, 玩家HP: player.hp, 保安: g.name,
               敌意判定: guardsHostileToPlayer() };
    })()`);
    await wait(5000);
    const r1b = await ev(`({ 玩家HP: Math.round(player.hp) })`);
    console.log('');
    console.log('实跑（5K · 玩家是保安）:', JSON.stringify(r1), '→', JSON.stringify(r1b),
      r1b.玩家HP === r1.玩家HP ? '✅ 没掉血' : '❌ 掉血了');

    // 对照：5K 抽到 MTF（=Nu-22），应该被打
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.querySelector(\'#missionRow .presetCard[data-m="fivek"]\').click()');
    await wait(400);
    await ev('GAME.role = "mtf";');
    await ev('document.getElementById("deployGo").click()');
    await wait(5200);
    const r2 = await ev(`(function(){
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      if (!g) return { err: '没有保安' };
      player.pos.set(g.pos.x + 5, 0, g.pos.z);
      player.hp = player.maxHp;
      g.atkCd = 0;
      return { 玩家显示名: roleView().name, 玩家HP: player.hp, 敌意判定: guardsHostileToPlayer() };
    })()`);
    await wait(5000);
    const r2b = await ev(`({ 玩家HP: Math.round(player.hp) })`);
    console.log('对照（5K · 玩家是 Nu-22）:', JSON.stringify(r2), '→', JSON.stringify(r2b),
      r2b.玩家HP < r2.玩家HP ? '✅ 被打' : '❌ 没被打');

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
