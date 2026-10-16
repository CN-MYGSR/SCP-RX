'use strict';
/* =====================================================================
   新增四只可玩收容物 验证（049 / 3114 / 076-2 / 682）
   ① 抽取权重：四只都能抽到，收容物总占比比改之前高
   ② 四只都能正常进入（isSCP / playerControlled / 面板 / 眼高）
   ③ 攻击结算：049 碰即死；076 / 682 / 3114 按伤害（不是一击秒）
   ④ 049 的 raiseDead：附近的尸体被拉起来变成 SCP-049-2
   ⑤ 682 的酸液：能喷出、带 byPlayer 标记、落点对 NPC 造成溅射伤害
   ⑥ 076-2 的自我复活：被 killSCP 后仍是 alive + state='down'
   ⑦ 3114 是全场地速最快的

   ⚠️ 断言器自检：故意跑一条必然失败的断言，证明它能报红。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8838;
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
  const ud = path.join(os.tmpdir(), 'scprx-pscp4-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9384', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9384/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=mtf' });
    await wait(3400);

    // ---------- ① 权重 ----------
    console.log('\n① 抽取权重');
    const w = await ev(`(function(){
      const cnt = {}; for (let i = 0; i < 40000; i++) { const k = rollRole(); cnt[k] = (cnt[k] || 0) + 1; }
      const pct = {}; for (const k in cnt) pct[k] = +(cnt[k] / 400).toFixed(2);
      const scpIds = ['o79','p173','p096','p939','p106','p049','p3114','p076','p682'];
      let scp = 0; for (const k of scpIds) scp += (pct[k] || 0);
      const neu = {}; for (const k of ['p049','p3114','p076','p682']) neu[k] = pct[k] || 0;
      return { 新四只: neu, 收容物合计: +scp.toFixed(2), 人类合计: +(100 - scp).toFixed(2),
               权重: ROLE_ORDER.map(k => k + ':' + ROLE_DEFS[k].weight).join(' ') };
    })()`);
    console.log('   ' + JSON.stringify(w));
    check('049 能抽到', w.新四只.p049 > 0, w.新四只.p049 + '%');
    check('3114 能抽到', w.新四只.p3114 > 0, w.新四只.p3114 + '%');
    check('076-2 能抽到', w.新四只.p076 > 0, w.新四只.p076 + '%');
    check('682 能抽到', w.新四只.p682 > 0, w.新四只.p682 + '%');
    check('收容物总占比已上调（> 25%）', w.收容物合计 > 25,
      w.收容物合计 + '%（改之前约 20.6%）');
    check('四只新角色都进了 ROLE_ORDER',
      ['p049', 'p3114', 'p076', 'p682'].every(k => w.权重.indexOf(k + ':') >= 0));

    // ---------- ② 四只逐个进入 ----------
    const EXPECT = { p049: { speed: 3.4, dmg: null }, p3114: { speed: 13.5, dmg: 26 }, p076: { speed: 8.6, dmg: 34 }, p682: { speed: 4.8, dmg: 52 } };
    for (const r of ['p049', 'p3114', 'p076', 'p682']) {
      console.log('\n② ' + r);
      await boot(r);
      const t = await ev(`(function(){
        const e = PSCP.ent;
        return { 角色: currentRole().name, isSCP: player.isSCP, 附身: e ? e.name : null,
                 被标记: !!(e && e.playerControlled), 眼高: +player.eyeH.toFixed(2),
                 面板: !document.getElementById('pscpPanel').classList.contains('hidden'),
                 状态行: (document.getElementById('pscpState')||{}).textContent,
                 速度: PSCP.tune.speed, 伤害: PSCP.tune.touchDmg || null,
                 人类: o79Humans(), 目标链: currentObjectives().map(o => o.id),
                 本体在场景里: !!(e && e.model.group.parent) };
      })()`);
      console.log('   ' + JSON.stringify(t));
      check(r + ' · 进入成功且 isSCP', t.isSCP === true && t.被标记 === true, t.角色);
      check(r + ' · 附身到正确的实体', t.附身 && t.附身.indexOf(r.slice(1)) >= 0, String(t.附身));
      check(r + ' · 面板已显示', t.面板 === true);
      check(r + ' · 速度符合预期', t.速度 === EXPECT[r].speed, t.速度 + ' vs ' + EXPECT[r].speed);
      check(r + ' · 伤害配置正确', t.伤害 === EXPECT[r].dmg, String(t.伤害));

      // ---------- ③ 攻击结算 ----------
      const atk = await ev(`(function(){
        const e = PSCP.ent;
        const h = scpHumans().find(x => (x.maxHp || 0) >= 150) || scpHumans()[0];
        if (!h) return { err: '场上没有人' };
        h.pos.set(e.pos.x + 1.0, 0, e.pos.z);
        h.hp = h.maxHp;
        const before = h.hp, aliveBefore = h.alive;
        PSCP.atkCd = 0;
        scpAttack();
        return { 目标: h.name || h.callsign, 打前: Math.round(before), 打后: Math.round(h.hp),
                 掉了: Math.round(before - h.hp), 死了: (aliveBefore && !h.alive) };
      })()`);
      console.log('   攻击: ' + JSON.stringify(atk));
      if (r === 'p049') {
        check('049 · 碰即死（一击必杀）', atk.死了 === true, '掉了 ' + atk.掉了);
      } else {
        check(r + ' · 按伤害结算（不是一击秒）', atk.掉了 === EXPECT[r].dmg,
          '掉了 ' + atk.掉了 + '（期望 ' + EXPECT[r].dmg + '）');
        check(r + ' · 高血量目标一下打不死', atk.死了 === false);
      }
    }

    // ---------- ④ 049 复活尸体 ----------
    console.log('\n④ 049 的 raiseDead');
    await boot('p049');
    const rd = await ev(`(function(){
      const e = PSCP.ent;
      CORPSES.length = 0; MINIONS.length = 0;
      CORPSES.push({ x: e.pos.x + 3, z: e.pos.z, revived: false });
      e.reviveT = 0.01;
      updateRaiseDead(e, 0.05);
      return { 尸体数: CORPSES.length, 已复活: CORPSES[0].revived, 小怪数: MINIONS.length,
               小怪名: MINIONS[0] ? MINIONS[0].name : null };
    })()`);
    console.log('   ' + JSON.stringify(rd));
    check('049 · 附近的尸体被拉起来', rd.已复活 === true && rd.小怪数 === 1, rd.小怪名);
    check('049 · 召唤的是 SCP-049-2', rd.小怪名 === 'SCP-049-2', String(rd.小怪名));

    // ---------- ⑤ 682 酸液 ----------
    console.log('\n⑤ 682 的酸液吐息');
    await boot('p682');
    const ac = await ev(`(function(){
      const e = PSCP.ent;
      const h = scpHumans()[0];
      if (!h) return { err: '场上没有人' };
      const fwd = V3(0, 0, -1).applyQuaternion(camera.quaternion);
      h.pos.set(e.pos.x + fwd.x * 10, 0, e.pos.z + fwd.z * 10);
      h.hp = h.maxHp;
      ACIDS.length = 0;
      e.acidT = 0.01;
      updatePlayableAcid(e, 0.05);
      return { 酸液数: ACIDS.length, byPlayer: ACIDS[0] ? ACIDS[0].byPlayer : null,
               目标: h.name || h.callsign, 目标HP: Math.round(h.hp) };
    })()`);
    console.log('   ' + JSON.stringify(ac));
    check('682 · 附近有人时会喷酸', ac.酸液数 === 1, '酸液数 ' + ac.酸液数);
    check('682 · 酸液带 byPlayer 标记（落点才会打 NPC）', ac.byPlayer === true, String(ac.byPlayer));

    const splash = await ev(`(function(){
      const a = ACIDS[0];
      const h = scpHumans()[0];
      h.hp = h.maxHp;
      const before = h.hp;
      a.t = a.life;                                     // 立刻落地
      a.mesh.position.set(h.pos.x, 1, h.pos.z);
      updateAcid(0.001);
      return { 打前: Math.round(before), 打后: Math.round(h.hp), 掉了: Math.round(before - h.hp) };
    })()`);
    console.log('   落点溅射: ' + JSON.stringify(splash));
    check('682 · 落点对 NPC 造成溅射伤害', splash.掉了 === 70, '掉了 ' + splash.掉了);

    // ---------- ⑥ 076-2 自我复活 ----------
    console.log('\n⑥ 076-2 的自我复活');
    await boot('p076');
    const rv = await ev(`(function(){
      const e = PSCP.ent;
      e.revived = false; e.state = 'hunt'; e.hp = e.maxHp;
      killSCP(e, {});
      return { alive: e.alive, hp: Math.round(e.hp), state: e.state, revived: e.revived };
    })()`);
    console.log('   ' + JSON.stringify(rv));
    check('076-2 · 被打倒后没有真正死掉', rv.alive === true);
    check('076-2 · 进入倒地状态等待起身', rv.state === 'down', rv.state);
    check('076-2 · 复活标记已置位', rv.revived === true);

    // ---------- ⑦ 3114 最快 ----------
    console.log('\n⑦ 速度对比');
    const spd = await ev(`(function(){
      const out = {}; for (const k in PSCP_TUNING) out[k] = PSCP_TUNING[k].speed;
      let fastest = null, mx = -1;
      for (const k in out) if (out[k] > mx) { mx = out[k]; fastest = k; }
      return { 各速: out, 最快: fastest, 最快速度: mx };
    })()`);
    console.log('   ' + JSON.stringify(spd));
    check('3114 是全场地速最快的收容物', spd.最快 === '3114', spd.最快 + ' @ ' + spd.最快速度);
    check('共 8 只可玩收容物', Object.keys(spd.各速).length === 8, Object.keys(spd.各速).join(','));

    // ---------- 断言器自检 ----------
    console.log('\n⑧ 断言器自检');
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
