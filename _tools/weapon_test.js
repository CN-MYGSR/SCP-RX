'use strict';
/* =====================================================================
   UMP-45 / MP7 / Glock-17 掉落武器验证
   ① 三把枪在 WPN_DEFS 里，数值/槽位合法
   ② 掉落池里真的会刷出来，地上是枪模
   ③ Class-D / 科学家 / 保安 能捡并用
   ④ MTF / 第二身份 / 收容物 捡不了
   ⑤ 槽位替换正确（保安捡步枪不丢手枪）
   ⑥ Glock-17 是半自动：按住不放不会连发
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8821;
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
  const ud = path.join(os.tmpdir(), 'scprx-wpn-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9367', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9367/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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
  const boot = async (role) => {
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1&role=' + role });
    await wait(3400);
    await ev('document.querySelector("[data-p=mLoadout]").click()');
    await wait(400);
    await ev('document.getElementById("deployGo").click()');
    await wait(5200);
  };

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await boot('classd');

    // ① 定义
    const t1 = await ev(`(function(){
      const out = {};
      for (const id of ['ump45','mp7','glock17']) {
        const d = WPN_DEFS[id];
        const st = computeWeaponStats(id, {});
        out[id] = d ? { 名称: d.name, 口径: d.ammoType, 模式: d.modeName, 伤害: d.dmg, 弹匣: d.mag,
                         槽位: d.slots.join('/'), 算得出数值: !!st && st.dmg > 0, 手枪: !!d.pistol } : '缺失';
      }
      return out;
    })()`);
    console.log('① 武器定义:', JSON.stringify(t1));

    // ①b 枪模必须真的有几何体 —— buildGunModel 是按 wpnId 分支建的，
    //     新枪忘了加分支的话会返回一个空 Group（手上没枪、地上也看不见）
    const t1b = await ev(`(function(){
      const out = {};
      for (const id of ['hk416','mp5','m249','glock18','spas12','ump45','mp7','glock17']) {
        const m = buildGunModel(id, {}, { worldScale: true });
        let n = 0;
        m.group.traverse(o => { if (o.isMesh) n++; });
        out[id] = n;
      }
      return out;
    })()`);
    console.log('①b 枪模网格数:', JSON.stringify(t1b));
    const empty = Object.keys(t1b).filter(k => t1b[k] === 0);
    console.log(empty.length ? '   ❌ 空模型: ' + empty.join(',') : '   ✅ 全部有几何体');

    // ② 掉落池
    const t2 = await ev(`(function(){
      const pools = {};
      for (const k in PICK_POOLS) pools[k] = PICK_POOLS[k].filter(x => x.startsWith('wpn_') || x.startsWith('ammo_45') || x.startsWith('ammo_46'));
      const all = PICK_POOLS.default.concat(PICK_POOLS.armory);
      const spawnTest = ['wpn_ump45','wpn_mp7','wpn_glock17'].map(t => {
        const p = spawnPickup(t, player.pos.x + 40, player.pos.z + 40);
        return { 类型: t, 生成成功: !!p, 有模型: !!(p && p.mesh), 是组: !!(p && p.mesh && p.mesh.type === 'Group') };
      });
      return { 各池武器项: pools, 生成测试: spawnTest };
    })()`);
    console.log('② 掉落池与生成:', JSON.stringify(t2));

    // ③ Class-D 能捡能用
    const t3 = await ev(`(function(){
      player.slots = []; player.curSlot = 0;
      const before = { 槽位: player.slots.length, canPick: canPickWeapons() };
      const p = spawnPickup('wpn_ump45', player.pos.x + 0.5, player.pos.z);
      collectPickup(p);
      const afterUmp = player.slots.map(s => s.id);
      const p2 = spawnPickup('wpn_glock17', player.pos.x + 0.5, player.pos.z);
      collectPickup(p2);
      const afterAll = player.slots.map(s => ({ id: s.id, 副: s.isSecondary }));
      return { 前: before, 捡UMP后: afterUmp, 再捡G17后: afterAll, 当前手持: player.cur().id,
               有枪模: !!VM.gun };
    })()`);
    console.log('③ Class-D 拾取:', JSON.stringify(t3));

    // ⑥ Glock-17 半自动：按住不放只打一发
    const t4 = await ev(`(function(){
      const gi = player.slots.findIndex(s => s.id === 'glock17');
      player.curSlot = gi >= 0 ? gi : 0;
      const w = player.cur();
      w.mag = 17; w.reloading = false;
      player.fireT = 0; player.fireHeld = false;
      const shots0 = player.shots;
      keys.fire = true;
      for (let i = 0; i < 40; i++) { player.fireT = 0; player.tryFire(0.016); }
      const heldShots = player.shots - shots0;
      // 松手再按一次
      keys.fire = false; player.tryFire(0.016);
      keys.fire = true; player.fireT = 0; player.tryFire(0.016);
      const reShots = player.shots - shots0 - heldShots;
      keys.fire = false;
      return { 模式: w.stats.mode, 按住40帧发射: heldShots, 松手再按: reShots };
    })()`);
    console.log('⑥ Glock-17 半自动:', JSON.stringify(t4));

    // ⑥b 全自动对照：UMP-45 按住应该连发
    const t4b = await ev(`(function(){
      const ui = player.slots.findIndex(s => s.id === 'ump45');
      player.curSlot = ui >= 0 ? ui : 0;
      const w = player.cur();
      w.mag = 25; w.reloading = false;
      player.fireT = 0; player.fireHeld = false;
      const shots0 = player.shots;
      keys.fire = true;
      for (let i = 0; i < 40; i++) { player.fireT = 0; player.tryFire(0.016); }
      const n = player.shots - shots0;
      keys.fire = false;
      return { 模式: w.stats.mode, 按住40帧发射: n };
    })()`);
    console.log('⑥b UMP-45 全自动对照:', JSON.stringify(t4b));

    // ④ MTF 捡不了
    await boot('mtf');
    const t5 = await ev(`(function(){
      const before = player.slots.map(s => s.id);
      const p = spawnPickup('wpn_ump45', player.pos.x + 0.5, player.pos.z);
      collectPickup(p);
      return { canPick: canPickWeapons(), 拾取前: before, 拾取后: player.slots.map(s => s.id), 还在地上: !p.taken };
    })()`);
    console.log('④ MTF 捡不了:', JSON.stringify(t5));

    // ④b 收容物捡不了
    await boot('p173');
    const t5b = await ev(`({ canPick: canPickWeapons(), 槽位: player.slots.length })`);
    console.log('④b SCP 捡不了:', JSON.stringify(t5b));

    // ⑤ 保安捡步枪不丢手枪
    await boot('guard');
    const t6 = await ev(`(function(){
      const before = player.slots.map(s => ({ id: s.id, 副: s.isSecondary }));
      const p = spawnPickup('wpn_mp7', player.pos.x + 0.5, player.pos.z);
      collectPickup(p);
      const after = player.slots.map(s => ({ id: s.id, 副: s.isSecondary }));
      return { 拾取前: before, 拾取后: after, 手持: player.cur().id };
    })()`);
    console.log('⑤ 保安捡 MP7:', JSON.stringify(t6));

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
