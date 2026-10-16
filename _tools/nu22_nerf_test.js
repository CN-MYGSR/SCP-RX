'use strict';
/* =====================================================================
   Nu-22 火力削弱 验证
   ① NU22_ENEMY_FIRE 常量就位（四项系数）
   ② 5K + 反叛之狐（敌对）→ 小队 DPS 落在削弱区间
   ③ 落锤 + CI（敌对但非 5K）→ 保持原火力
   ④ 两者比值 ≈ 削弱幅度（说明只有 5K 敌对时才生效）
   ⑤ 5K + Nu-22（玩家自己就是 Nu-22）→ 不敌对，也就不会被削弱
   ⑥ 首次识别玩家时有一段抬枪反应时间（不是落地即开火）

   ⚠️ 断言器自检：本脚本会故意跑一条必然失败的断言，
      用来证明"能报红"，避免出现"永远全绿"的假测试。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8836;
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
  const ud = path.join(os.tmpdir(), 'scprx-nerf-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9382', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9382/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
      const pg = list.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { }
    if (!wsUrl) await wait(250);
  }
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
  await new Promise(r => ws.once('open', r));
  let id = 0; const pend = new Map(); const events = [];
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) events.push(m); });
  const send = (mth, prm) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: mth, params: prm || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + mth)); } }, 120000); });
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

  /* 在页面里跑的测量函数：固定玩家与 3 名队员的位置，跑 N 帧 updateAllies，
     统计玩家累计承受的伤害 → 换算小队 DPS。 */
  const MEASURE = `(function(N){
    player.alive = true; player.isAI = false; player.isSCP = false;
    player.hp = player.maxHp = 1e6;
    GAME.over = false;
    if (GAME.staging) GAME.staging.active = false;
    GAME.mtfDeployed = true;
    GAME.mtfReinforceT = 9999;
    GAME.nu22Volley = 0;

    // 清场：异常 / 小怪 / 人员 / 势力全部挪走，避免被 AI 当成别的目标
    for (const s of SCP_LIST) s.pos.set(600, 0, 600);
    for (const m of MINIONS) m.pos.set(620, 0, 620);
    if (typeof PERSONNEL_LIST !== 'undefined') for (const p of PERSONNEL_LIST) p.pos.set(640, 0, 640);
    if (typeof FACTION_LIST !== 'undefined') for (const f of FACTION_LIST) f.pos.set(660, 0, 660);

    const X = FAC.spawn.x, Z = FAC.spawn.z;
    player.pos.set(X, 0, Z);
    const live = ALLY_LIST.filter(a => a.alive);
    live.forEach((a, i) => {
      a.pos.set(X + (i - 1) * 1.6, 0, Z + 5);
      a.target = null; a.atkCd = 0; a.hostileTold = false; a.retargetT = 0;
    });

    // 静音，免得 N 帧里刷爆音频节点
    const _g = AudioSys.gunshot, _h = AudioSys.hurt;
    AudioSys.gunshot = function () { }; AudioSys.hurt = function () { };

    const t0 = player.dmgTaken;
    let firstAtkCd = [], shots = 0;
    const _dt = 1 / 60;
    for (let i = 0; i < N; i++) {
      live.forEach((a, k) => { if (a.alive) a.pos.set(X + (k - 1) * 1.6, 0, Z + 5); });
      updateAllies(_dt);
      if (i === 0) firstAtkCd = live.map(a => +a.atkCd.toFixed(2));
    }
    const dealt = player.dmgTaken - t0;
    AudioSys.gunshot = _g; AudioSys.hurt = _h;
    return {
      队员数: live.length,
      模拟秒: N / 60,
      总伤害: +dealt.toFixed(1),
      小队DPS: +(dealt / (N / 60)).toFixed(1),
      首帧atkCd: firstAtkCd,
      剩余hp: Math.round(player.hp),
    };
  })`;

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=rebel' });
    await wait(3400);

    // ---- ① 常量就位 ----
    console.log('\n① NU22_ENEMY_FIRE 常量');
    const c1 = await ev(`({
      存在: typeof NU22_ENEMY_FIRE === 'object' && NU22_ENEMY_FIRE !== null,
      伤害系数: NU22_ENEMY_FIRE.dmgMul,
      间隔系数: NU22_ENEMY_FIRE.cdMul,
      散布: NU22_ENEMY_FIRE.spread,
      小队节流: NU22_ENEMY_FIRE.volleyGap,
    })`);
    console.log('   ' + JSON.stringify(c1));
    check('常量存在', c1.存在 === true);
    check('伤害系数在 (0,1) 区间', c1.伤害系数 > 0 && c1.伤害系数 < 1, 'dmgMul=' + c1.伤害系数);
    check('间隔系数 > 1（射得更慢）', c1.间隔系数 > 1, 'cdMul=' + c1.间隔系数);
    check('小队节流 > 0', c1.小队节流 > 0, 'volleyGap=' + c1.小队节流);

    // ---- 进 5K 并部署 ----
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.querySelector(\'#missionRow .presetCard[data-m="fivek"]\').click()');
    await wait(400);
    await ev('GAME.role = "rebel";');
    await ev('document.getElementById("deployGo").click()');
    await wait(5500);
    // 跳过反叛之狐的延迟部署待命
    await ev('GAME.staging.t = 0.2;');
    await wait(3000);
    const stg = await ev('({ 待命中: GAME.staging.active, 队友数: ALLY_LIST.length })');
    console.log('\n   突入完成: ' + JSON.stringify(stg));

    // ---- ② 5K + 反叛之狐（敌对）→ 削弱后 ----
    console.log('\n② 5K + 反叛之狐（Nu-22 敌对）');
    const enemy = await ev(`(function(){
      GAME.mission = 'fivek'; GAME.role = 'rebel';
      const info = { 敌对: alliesHostileToPlayer(), 角色: currentRole().id };
      const m = ${MEASURE}(900);
      return Object.assign(info, m);
    })()`);
    console.log('   ' + JSON.stringify(enemy));
    check('Nu-22 与反叛之狐敌对', enemy.敌对 === true);
    check('3 名 Nu-22 在场', enemy.队员数 === 3, '实际 ' + enemy.队员数);
    check('小队 DPS 已削弱（< 60）', enemy.小队DPS < 60, 'DPS=' + enemy.小队DPS);
    check('小队 DPS 不是形同虚设（> 8）', enemy.小队DPS > 8, 'DPS=' + enemy.小队DPS);
    check('首次开火有反应延迟（首帧 atkCd ≥ 0.5）',
      Array.isArray(enemy.首帧atkCd) && enemy.首帧atkCd.every(v => v >= 0.5), JSON.stringify(enemy.首帧atkCd));

    // ---- ③ 落锤 + CI（敌对但非 5K）→ 原火力 ----
    console.log('\n③ 落锤 + 混沌分裂者（敌对，但非 5K）');
    const normal = await ev(`(function(){
      GAME.mission = 'breach'; GAME.role = 'ci';
      const info = { 敌对: alliesHostileToPlayer(), 角色: currentRole().id };
      const m = ${MEASURE}(900);
      return Object.assign(info, m);
    })()`);
    console.log('   ' + JSON.stringify(normal));
    check('MTF 与 CI 敌对', normal.敌对 === true);
    check('原火力未被动到（DPS > 100）', normal.小队DPS > 100, 'DPS=' + normal.小队DPS);
    check('削弱幅度显著（原/削 ≥ 3 倍）', normal.小队DPS / Math.max(0.01, enemy.小队DPS) >= 3,
      '原 ' + normal.小队DPS + ' / 削 ' + enemy.小队DPS + ' = ' + (normal.小队DPS / Math.max(0.01, enemy.小队DPS)).toFixed(2) + '×');

    // ---- ④ 5K + Nu-22（玩家自己就是 Nu-22）→ 不敌对 ----
    console.log('\n④ 5K + 玩家自己抽到 Nu-22 编制位');
    const own = await ev(`(function(){
      GAME.mission = 'fivek'; GAME.role = 'mtf';
      return { 显示名: roleView().name, 与队友敌对: alliesHostileToPlayer(),
               队员名: ALLY_LIST.map(a => a.name) };
    })()`);
    console.log('   ' + JSON.stringify(own));
    check('玩家身份显示为 Nu-22', own.显示名.indexOf('Nu-22') >= 0, own.显示名);
    check('玩家是 Nu-22 时不与队友敌对（→ 不会触发削弱）', own.与队友敌对 === false);
    check('AI 队友是 Nu-22 编制', own.队员名.every(n => n.indexOf('Nu-22') === 0), own.队员名.join(','));

    // ---- ⑤ 玩家存活时间估算 ----
    console.log('\n⑤ 玩家生存时间（按 100 HP 折算）');
    const survive = 100 / Math.max(0.01, enemy.小队DPS);
    const surviveOld = 100 / Math.max(0.01, normal.小队DPS);
    console.log('   削弱前 ≈ ' + surviveOld.toFixed(2) + ' 秒 → 削弱后 ≈ ' + survive.toFixed(2) + ' 秒');
    check('反叛之狐能撑过 2.5 秒（有处决/反击窗口）', survive >= 2.5, survive.toFixed(2) + ' 秒');

    // ---- 断言器自检（必须报红）----
    console.log('\n⑥ 断言器自检');
    const before = fail;
    check('[自检] 这条故意失败', false, '如果你看到这行是 ✅，说明断言器坏了');
    check('断言器确实能报红', fail === before + 1);
    fail = before;   // 自检不计入最终失败数

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
