'use strict';
/* =====================================================================
   平衡性修复 验证
   ① 地图：雷达与大地图都会画「设施人员 + CI / 蛇之手」
      （用替换 canvas.arc 计数的方式验证，不靠肉眼）
   ② 173：眨眼改成全体共享节拍 —— 窗口占比合理，且窗口内确实能移动
   ③ 096：造成击杀后进入长冷却（killCd），不再"来一个杀一个"
   ④ 重新部署：有无敌时间，期间免疫伤害，过期后恢复

   ⚠️ 断言器自检：故意跑一条必然失败的断言，证明它能报红。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8839;
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
  const ud = path.join(os.tmpdir(), 'scprx-bal2-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9385', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9385/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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

  const boot = async (role) => {
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=' + role });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(300);
    await ev('document.getElementById("deployGo").click()');
    await wait(4200);
  };

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await boot('mtf');

    // ---------- ① 地图会画人员与势力 ----------
    console.log('\n① 地图上的 NPC 覆盖');
    const map = await ev(`(function(){
      // 保证场上有人有势力
      if (!FACTION_LIST.some(a => a.alive)) { spawnFaction('ci', 3); spawnFaction('hand', 2); }
      const countArcs = (clear, fn) => {
        let n = 0;
        const ctx = fn === 'radar' ? radarCtx : bmCtx;
        const orig = ctx.arc;
        ctx.arc = function () { n++; return orig.apply(this, arguments); };
        const saveP = PERSONNEL_LIST.slice(), saveF = FACTION_LIST.slice();
        if (clear) { PERSONNEL_LIST.length = 0; FACTION_LIST.length = 0; }
        fn === 'radar' ? drawRadar() : drawBigMap();
        PERSONNEL_LIST.length = 0; for (const p of saveP) PERSONNEL_LIST.push(p);
        FACTION_LIST.length = 0; for (const f of saveF) FACTION_LIST.push(f);
        ctx.arc = orig;
        return n;
      };
      const liveP = PERSONNEL_LIST.filter(p => p.alive && !p.escaped).length;
      const liveF = FACTION_LIST.filter(f => f.alive).length;
      const radarOn = countArcs(false, 'radar'), radarOff = countArcs(true, 'radar');
      const mapOn = countArcs(false, 'map'), mapOff = countArcs(true, 'map');
      return { 存活人员: liveP, 存活势力: liveF,
               雷达增量: radarOn - radarOff, 大地图增量: mapOn - mapOff,
               雷达总数: [radarOff, radarOn], 大地图总数: [mapOff, mapOn] };
    })()`);
    console.log('   ' + JSON.stringify(map));
    check('场上有设施人员可画', map.存活人员 > 0, map.存活人员 + ' 人');
    check('场上有 CI / 蛇之手可画', map.存活势力 > 0, map.存活势力 + ' 人');
    check('雷达把人员 + 势力都画进去了',
      map.雷达增量 === map.存活人员 + map.存活势力,
      '增量 ' + map.雷达增量 + ' = 人员 ' + map.存活人员 + ' + 势力 ' + map.存活势力);
    check('大地图把人员 + 势力都画进去了',
      map.大地图增量 === map.存活人员 + map.存活势力,
      '增量 ' + map.大地图增量);

    // ---------- ② 173 的眨眼节拍 ----------
    console.log('\n② 173 眨眼（全体共享节拍）');
    await boot('p173');
    const blink = await ev(`(function(){
      let shut = 0, open = 0, runs = 0, inRun = false;
      const N = 1800;                                   // 30 秒
      for (let i = 0; i < N; i++) {
        tickNpcBlink(1 / 60);
        if (npcBlinkT > 0) { shut++; if (!inRun) { runs++; inRun = true; } }
        else { open++; inRun = false; }
      }
      return { 窗口占比: +(shut / N * 100).toFixed(1), 窗口次数: runs, 平均每次秒: +(shut / Math.max(1, runs) / 60).toFixed(2) };
    })()`);
    console.log('   ' + JSON.stringify(blink));
    check('眨眼窗口占比合理（15%~45%）', blink.窗口占比 >= 15 && blink.窗口占比 <= 45, blink.窗口占比 + '%');
    check('30 秒内出现多次窗口（不再几乎不动）', blink.窗口次数 >= 5, blink.窗口次数 + ' 次');
    check('每次窗口约 1 秒（够跑 8~10 米）', blink.平均每次秒 >= 0.7 && blink.平均每次秒 <= 1.4, blink.平均每次秒 + ' 秒');

    const canMove = await ev(`(function(){
      const e = PSCP.ent;
      // 把人放到正前方，确保"有人在看"
      const h = scpHumans()[0];
      if (h) { h.pos.set(e.pos.x, 0, e.pos.z - 4); h.yaw = 0; }
      npcBlinkT = 0;
      const observedWhenOpen = scpIsObserved(e);
      npcBlinkT = 0.8;
      const observedWhenShut = scpIsObserved(e);
      return { 睁眼时被看见: observedWhenOpen, 眨眼时被看见: observedWhenShut };
    })()`);
    console.log('   ' + JSON.stringify(canMove));
    check('睁眼时会被看见（173 冻结）', canMove.睁眼时被看见 === true);
    check('★ 眨眼窗口内不再被看见（173 能动）', canMove.眨眼时被看见 === false);

    // ---------- ③ 096 的击杀冷却 ----------
    console.log('\n③ 096 击杀后的冷却');
    await boot('p096');
    const kc = await ev(`(function(){
      const e = PSCP.ent;
      const out = { killCd配置: PSCP.tune.killCd, atkCd配置: PSCP.tune.atkCd };
      const h = scpHumans()[0];
      if (!h) return Object.assign(out, { err: '场上没有人' });
      h.pos.set(e.pos.x + 1.0, 0, e.pos.z);
      h.hp = h.maxHp;
      PSCP.atkCd = 0;
      scpAttack();
      out.击杀后atkCd = +PSCP.atkCd.toFixed(2);
      // 再试一次：冷却中应该打不出第二下
      const h2 = scpHumans()[1];
      if (h2) {
        h2.pos.set(e.pos.x + 1.0, 0, e.pos.z);
        h2.hp = h2.maxHp;
        const hp2 = h2.hp;
        scpAttack();
        out.冷却中还能打 = (h2.hp !== hp2);
      }
      return out;
    })()`);
    console.log('   ' + JSON.stringify(kc));
    check('096 配了比普通攻击长得多的击杀冷却', kc.killCd配置 >= 3.0, 'killCd=' + kc.killCd配置 + ' vs atkCd=' + kc.atkCd配置);
    check('击杀后确实进入长冷却', kc.击杀后atkCd >= 3.0, 'atkCd=' + kc.击杀后atkCd);
    check('冷却期间打不出第二下', kc.冷却中还能打 === false);

    // ---------- ④ 重新部署的无敌时间 ----------
    console.log('\n④ 重新部署的无敌时间');
    const inv = await ev(`(function(){
      const out = {};
      GAME.over = false; GAME.phase = 'playing';
      // ⚠️ 上一段测的是 096（附身收容物），player.isSCP 还是 true ——
      //    不摘掉的话 player.damage() 第一行就 return，根本测不出"无敌过期后恢复受伤"。
      if (typeof stopPlayableSCP === 'function') stopPlayableSCP();
      player.isSCP = false; player.isAI = false;
      GAME.spawnProtectT = 4.0;
      player.alive = true; player.hp = player.maxHp = 115;
      player.damage(60, null, { limb: 'torso' });
      out.无敌中掉血 = (player.hp !== 115);
      out.无敌中血量 = Math.round(player.hp);
      GAME.spawnProtectT = 0;
      player.damage(30, null, { limb: 'torso' });
      out.过期后掉血 = (player.hp < 115);
      out.过期后血量 = Math.round(player.hp);
      return out;
    })()`);
    console.log('   ' + JSON.stringify(inv));
    check('无敌期间免疫伤害', inv.无敌中掉血 === false, inv.无敌中血量 + ' HP');
    check('无敌结束后正常受伤', inv.过期后掉血 === true, inv.过期后血量 + ' HP');

    const rb = await ev(`(function(){
      GAME.rebirthUsed = false; GAME.rebirthCount = 0;
      GAME.mission = 'breach'; GAME.role = 'mtf';
      player.init(); player.alive = true;
      rebirthPlayer('mtf', '测试');
      return { 重生后保护: +GAME.spawnProtectT.toFixed(1), 撤离冷却: GAME.extractCd,
               身份: currentRole().id, alive: player.alive };
    })()`);
    console.log('   ' + JSON.stringify(rb));
    check('重生后自带无敌时间', rb.重生后保护 >= 3.0, rb.重生后保护 + ' 秒');
    check('重生流程本身没被破坏', rb.alive === true && rb.身份 === 'mtf');

    // ---------- 断言器自检 ----------
    console.log('\n⑤ 断言器自检');
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
