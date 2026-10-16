'use strict';
/* =====================================================================
   重生机制 验证
   ① 映射表：常规（异常→蛇之手 / Class-D→CI / 科学家保安→Nu-7 / MTF 保持）
   ② 映射表：5K（科学家→Nu-22 编制位 / 保安→反叛之狐，其余沿用）
   ③ 实际重生：Class-D 倒下 → 变成混沌分裂者，游戏不结束
   ④ 只重生一次：第二次倒下才是真结束
   ⑤ 保留进度：行动时间 / 目标状态 / 战绩统计都不清零
   ⑥ 新身份阵营判定：蛇之手与站点敌对，且能打到保安 / 科学家
   ⑦ 同阵营不互打：CI 玩家打不到 CI、蛇之手玩家打不到蛇之手
   ⑧ 重生后玩家状态干净：isAI / isSCP 清掉、满血、落位到新身份出生点
   ⑨ 5K 里蛇之手有目标链（hunt），不会卡在 Nu-22 的 hold/survive 上

   ⚠️ 断言器自检：故意跑一条必然失败的断言，证明它能报红。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8837;
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
  const ud = path.join(os.tmpdir(), 'scprx-rebirth-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9383', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9383/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=classd' });
    await wait(3400);

    // ---------- ① / ② 映射表 ----------
    console.log('\n① 常规映射表');
    const m1 = await ev(`(function(){
      const keep = GAME.mission;
      GAME.mission = 'breach';
      const out = {};
      for (const k of ['mtf','guard','scientist','classd','o79','p173','p096','p939','p106','ci','hand','mtf_spec'])
        out[k] = rebirthRoleFor(k);
      GAME.mission = keep;
      return out;
    })()`);
    console.log('   ' + JSON.stringify(m1));
    check('MTF 保持 MTF', m1.mtf === 'mtf', m1.mtf);
    check('保安 → Nu-7 突击兵', m1.guard === 'mtf_assault', m1.guard);
    check('科学家 → Nu-7 收容专家', m1.scientist === 'mtf_spec', m1.scientist);
    check('Class-D → CI', m1.classd === 'ci', m1.classd);
    check('异常全部 → 蛇之手',
      ['o79', 'p173', 'p096', 'p939', 'p106'].every(k => m1[k] === 'hand'),
      JSON.stringify(['o79', 'p173', 'p096', 'p939', 'p106'].map(k => m1[k])));
    // ⚠️ 复活无限次之后，映射表里没有的身份（第二身份）返回的是"它自己"，
    //    不再是 null —— 断言口径要跟着改。
    check('第二身份也能原地复活（CI → CI）', m1.ci === 'ci', String(m1.ci));
    check('蛇之手也能原地复活（hand → hand）', m1.hand === 'hand', String(m1.hand));
    check('Nu-7 收容专家也能原地复活（mtf_spec → mtf_spec）', m1.mtf_spec === 'mtf_spec', String(m1.mtf_spec));

    console.log('\n② 5K 映射表');
    const m2 = await ev(`(function(){
      const keep = GAME.mission;
      GAME.mission = 'fivek';
      const out = {};
      for (const k of ['mtf','guard','scientist','classd','p173','rebel']) out[k] = rebirthRoleFor(k);
      GAME.mission = keep;
      return out;
    })()`);
    console.log('   ' + JSON.stringify(m2));
    check('5K · 科学家 → Nu-22 编制位（mtf）', m2.scientist === 'mtf', m2.scientist);
    check('5K · 保安 → 反叛之狐', m2.guard === 'rebel', m2.guard);
    check('5K · 反叛之狐 → 保持反叛之狐（不能漏！）', m2.rebel === 'rebel', String(m2.rebel));
    check('5K · 异常沿用常规 → 蛇之手', m2.p173 === 'hand', m2.p173);
    check('5K · Class-D 沿用常规 → CI', m2.classd === 'ci', m2.classd);

    // ---------- 进游戏 ----------
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.querySelector(\'#missionRow .presetCard[data-m="breach"]\').click()');
    await wait(400);
    await ev('GAME.role = "classd";');
    await ev('document.getElementById("deployGo").click()');
    await wait(5500);

    // 先攒一点"进度"，等会儿验证重生没把它清掉
    const before = await ev(`(function(){
      GAME.elapsed = 137;                     // 假装已经打了 2 分 17 秒
      GAME.breakers.A = true; GAME.breakers.B = true;
      GAME.protocol = true;
      GAME.contained['173'] = true;
      GAME.rescued.scientist = 2;
      player.kills = 7; player.shots = 40; player.hits = 22; player.headshots = 5;
      player.dmgDealt = 640; player.dmgTaken = 210;
      return { 身份: currentRole().id, 已重生: GAME.rebirthUsed, over: GAME.over };
    })()`);
    console.log('\n③ 重生前的状态: ' + JSON.stringify(before));

    // ---------- ③ 杀死玩家 → 重生 ----------
    console.log('\n④ 倒下 → 重生');
    await ev(`player.die(null, { limb: 'torso', cause: '测试击杀' })`);
    await wait(3200);
    const after = await ev(`({
      身份: currentRole().id, 显示名: roleView().name,
      已重生: GAME.rebirthUsed, 重生次数: GAME.rebirthCount,
      over: GAME.over, phase: GAME.phase,
      alive: player.alive, hp: Math.round(player.hp), maxHp: player.maxHp,
      isAI: !!player.isAI, isSCP: !!player.isSCP,
      位置: [Math.round(player.pos.x), Math.round(player.pos.z)],
      出生房间: currentRole().spawn,
    })`);
    console.log('   ' + JSON.stringify(after));
    check('身份已换成混沌分裂者', after.身份 === 'ci', after.身份 + ' / ' + after.显示名);
    check('游戏没有结束（over=false）', after.over === false);
    check('玩家活着且满血', after.alive === true && after.hp === after.maxHp, after.hp + '/' + after.maxHp);
    check('重生标记已置位', after.已重生 === true && after.重生次数 === 1);
    check('isAI / isSCP 已清干净', after.isAI === false && after.isSCP === false);
    check('回到地面（不是在天上/地下）', Math.abs(after.位置[0]) < 500 && Math.abs(after.位置[1]) < 500, JSON.stringify(after.位置));

    // ---------- ⑤ 进度保留 ----------
    console.log('\n⑤ 进度是否保留');
    const prog = await ev(`({
      行动时间: Math.round(GAME.elapsed),
      断路器: GAME.breakers, 协议: GAME.protocol,
      已收容: Object.keys(GAME.contained),
      护送加成: GAME.rescued,
      击杀: player.kills, 射击: player.shots, 命中: player.hits, 爆头: player.headshots,
      造成伤害: Math.round(player.dmgDealt), 承受伤害: Math.round(player.dmgTaken),
    })`);
    console.log('   ' + JSON.stringify(prog));
    // ⚠️ 不能断言精确等于 137 —— 死亡到重生之间隔了 2.2 秒，
    //    主循环还在跑，elapsed 会自然往前涨（无头环境帧率低，涨多少不固定）。
    //    这里只验证"没被清零"。
    check('行动时间没被清零', prog.行动时间 >= 137 && prog.行动时间 < 200, prog.行动时间 + ' 秒（起点 137）');
    check('目标进度（断路器/协议）保留', prog.断路器.A === true && prog.断路器.B === true && prog.协议 === true);
    check('收容记录保留', prog.已收容.indexOf('173') >= 0, JSON.stringify(prog.已收容));
    check('护送加成保留', prog.护送加成.scientist === 2);
    check('战绩统计保留', prog.击杀 === 7 && prog.射击 === 40 && prog.命中 === 22 && prog.爆头 === 5,
      '击杀 ' + prog.击杀 + ' / 射击 ' + prog.射击 + ' / 命中 ' + prog.命中);
    check('伤害统计保留', prog.造成伤害 === 640 && prog.承受伤害 === 210,
      prog.造成伤害 + ' / ' + prog.承受伤害);

    // ---------- ⑥ 连续倒下 → 仍然复活（无限次）----------
    console.log('\n⑥ 连续倒下 = 无限复活');
    const seq = [];
    for (let i = 0; i < 3; i++) {
      await ev(`player.die(null, { limb: 'torso', cause: '第 ${i + 2} 次测试击杀' })`);
      await wait(3000);
      seq.push(await ev(`({ 次数: GAME.rebirthCount, over: GAME.over, 身份: currentRole().id,
                              alive: player.alive, hp: Math.round(player.hp), maxHp: player.maxHp })`));
    }
    console.log('   ' + JSON.stringify(seq));
    check('连续 3 次倒下都复活了（累计 4 次重生）',
      seq.every(s => s.over === false && s.alive === true),
      JSON.stringify(seq.map(s => '第' + s.次数 + '次 over=' + s.over)));
    check('重生次数持续累加', seq[2].次数 === 4, '实际 ' + seq[2].次数);
    check('身份保持 CI（映射表里没有 → 原地复活）',
      seq.every(s => s.身份 === 'ci'), JSON.stringify(seq.map(s => s.身份)));
    check('每次复活都是满血', seq.every(s => s.hp === s.maxHp && s.hp > 0),
      JSON.stringify(seq.map(s => s.hp + '/' + s.maxHp)));

    // ---------- ⑦ 蛇之手阵营判定 ----------
    console.log('\n⑦ 蛇之手身份：阵营与可攻击目标');
    const hand = await ev(`(function(){
      GAME.over = false; GAME.phase = 'playing';
      GAME.mission = 'breach'; GAME.role = 'hand';
      player.init(); player.alive = true;
      // 造一批势力单位出来
      if (!FACTION_LIST.length) { spawnFaction('ci', 3); spawnFaction('hand', 3); }
      const out = {
        身份: currentRole().id, side: currentRole().side, 显示名: roleView().name,
        与站点为敌: playerHostileToSite(),
        与队友为敌: alliesHostileToPlayer(),
        保安打我: guardsHostileToPlayer(),
      };
      // 射线：能不能打到保安 / 科学家
      player.alive = true;
      const park = (list) => list.forEach((q, i) => q.pos.set(900, 0, 900 + i * 4));
      const probe = (ent) => {
        park(PERSONNEL_LIST); park(SCP_LIST); park(ALLY_LIST); park(FACTION_LIST);
        ent.pos.set(player.pos.x, 0, player.pos.z - 5);
        const hit = raycastSCPs(V3(player.pos.x, player.pos.y + 1.2, player.pos.z), V3(0,0,-1), 40);
        return !!(hit && hit.isHostile && hit.ent === ent);
      };
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      const sc = PERSONNEL_LIST.find(p => p.kind === 'scientist' && p.alive && !p.escaped);
      if (g) out.能打保安 = probe(g);
      if (sc) out.能打科学家 = probe(sc);
      // 同阵营：蛇之手 NPC 不该是目标
      const sh = FACTION_LIST.find(a => a.kind === 'hand' && a.alive);
      if (sh) out.能打蛇之手同伙 = probe(sh);
      return out;
    })()`);
    console.log('   ' + JSON.stringify(hand));
    check('蛇之手与站点为敌', hand.与站点为敌 === true);
    check('MTF 队友视蛇之手为敌', hand.与队友为敌 === true);
    check('保安会打蛇之手', hand.保安打我 === true);
    check('能打到保安', hand.能打保安 === true);
    check('能打到科学家', hand.能打科学家 === true);
    check('打不到蛇之手同伙（同阵营）', hand.能打蛇之手同伙 === false, String(hand.能打蛇之手同伙));

    // ---------- ⑧ CI 身份：同阵营不互打 ----------
    console.log('\n⑧ CI 身份：打不到同伙');
    const ci = await ev(`(function(){
      GAME.mission = 'breach'; GAME.role = 'ci';
      player.init(); player.alive = true;
      if (!FACTION_LIST.some(a => a.kind === 'ci' && a.alive)) spawnFaction('ci', 3);
      const park = (list) => list.forEach((q, i) => q.pos.set(900, 0, 900 + i * 4));
      const probe = (ent) => {
        park(PERSONNEL_LIST); park(SCP_LIST); park(ALLY_LIST); park(FACTION_LIST);
        ent.pos.set(player.pos.x, 0, player.pos.z - 5);
        const hit = raycastSCPs(V3(player.pos.x, player.pos.y + 1.2, player.pos.z), V3(0,0,-1), 40);
        return !!(hit && hit.isHostile && hit.ent === ent);
      };
      const out = { 身份: currentRole().id, 与站点为敌: playerHostileToSite() };
      const c = FACTION_LIST.find(a => a.kind === 'ci' && a.alive);
      if (c) out.能打CI同伙 = probe(c);
      const g = PERSONNEL_LIST.find(p => p.kind === 'guard' && p.alive && !p.escaped);
      if (g) out.能打保安 = probe(g);
      const d = PERSONNEL_LIST.find(p => p.kind === 'classd' && p.alive && !p.escaped);
      if (d) out.能打ClassD = probe(d);
      return out;
    })()`);
    console.log('   ' + JSON.stringify(ci));
    check('CI 与站点为敌', ci.与站点为敌 === true);
    check('CI 打不到 CI 同伙', ci.能打CI同伙 === false, String(ci.能打CI同伙));
    check('CI 能打到保安', ci.能打保安 === true);
    check('CI 打不到同阵营的 Class-D', ci.能打ClassD === false, String(ci.能打ClassD));

    // ---------- ⑨ 5K 里蛇之手的目标链 ----------
    console.log('\n⑨ 5K 里蛇之手的目标链');
    const f5 = await ev(`(function(){
      GAME.mission = 'fivek'; GAME.role = 'hand';
      const st = objectiveStatus();
      const out = { 目标链: currentObjectives().map(o => o.id),
                    有hunt: st.hunt !== undefined, 有hold: st.hold !== undefined,
                    有kill1440: st.kill1440 !== undefined,
                    剩余基金会: st._foundationLeft };
      GAME.mission = 'breach';
      return out;
    })()`);
    console.log('   ' + JSON.stringify(f5));
    check('5K 蛇之手目标链只有 hunt（不挂做不了的撤离）',
      Array.isArray(f5.目标链) && f5.目标链.length === 1 && f5.目标链[0] === 'hunt',
      JSON.stringify(f5.目标链));
    check('5K 蛇之手有 hunt 目标', f5.有hunt === true);
    check('5K 蛇之手不会显示 Nu-22 的 hold 目标', f5.有hold === false);
    check('5K 蛇之手不会显示反叛之狐的处决目标', f5.有kill1440 === false);

    // ---------- ⑩ 5K 反叛之狐重生：绝不能被塞回待命屏 ----------
    console.log('\n⑩ 5K 反叛之狐重生（原 bug：死了只能结算 + 重开再等 60 秒）');
    await ev(`(function(){
      GAME.mission = 'fivek'; GAME.role = 'rebel';
      GAME.over = false; GAME.won = false; GAME.phase = 'playing';
      GAME.rebirthUsed = false; GAME.rebirthCount = 0;
      player.init(); player.alive = true;
      // 模拟"开局延迟部署"的待命状态
      GAME.staging.active = true; GAME.staging.total = 60; GAME.staging.t = 60;
      GAME.elapsed = 200;
      player.kills = 3;
    })()`);
    const rb1 = await ev(`({ 待命中: GAME.staging.active, 身份: currentRole().id, 已重生: GAME.rebirthUsed })`);
    await ev(`player.die(null, { limb: 'torso', cause: '测试击杀' })`);
    await wait(3200);
    const rb2 = await ev(`({
      身份: currentRole().id, 显示名: roleView().name,
      已重生: GAME.rebirthUsed, over: GAME.over,
      待命中: GAME.staging.active,
      待命屏可见: !document.getElementById('stagingScreen').classList.contains('hidden'),
      alive: player.alive, hp: Math.round(player.hp),
      行动时间: Math.round(GAME.elapsed), 击杀: player.kills,
    })`);
    console.log('   ' + JSON.stringify(rb1) + '\n   → ' + JSON.stringify(rb2));
    check('反叛之狐能重生（不再直接结算）', rb2.over === false && rb2.已重生 === true);
    check('重生后仍是反叛之狐', rb2.身份 === 'rebel', rb2.身份);
    check('★ 重生后不会被塞回 60 秒待命屏',
      rb2.待命中 === false && rb2.待命屏可见 === false,
      'staging=' + rb2.待命中 + ' / 屏=' + rb2.待命屏可见);
    check('重生后满血复活', rb2.alive === true && rb2.hp > 0, rb2.hp + ' HP');
    check('重生后进度保留（时间 / 击杀）', rb2.行动时间 >= 200 && rb2.击杀 === 3,
      rb2.行动时间 + ' 秒 / 击杀 ' + rb2.击杀);

    // ---------- ⑫ 主动放弃 = 跳过复活，真的结束 ----------
    console.log('\n⑫ 主动放弃行动（skipRebirth）');
    await ev(`endGame(false, '行动中止', true)`);
    await wait(800);
    const ab = await ev(`({ over: GAME.over, won: GAME.won,
                           标题: (document.getElementById('endTitle')||{}).textContent,
                           结算屏可见: !document.getElementById('endScreen').classList.contains('hidden') })`);
    console.log('   ' + JSON.stringify(ab));
    check('放弃行动会真正结束（不会被无限复活卡住）', ab.over === true);
    check('判为失败并弹出结算', ab.won === false && ab.结算屏可见 === true);

    // ---------- 断言器自检 ----------
    console.log('\n⑬ 断言器自检');
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
