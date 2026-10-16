'use strict';
/* =====================================================================
   平衡调整验证：SCP 削弱 / 人类阵营加强
   核心指标是「几下能打死一个」—— 直接算出 TTK，而不是只看单发数值。
   ===================================================================== */
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn } = require('child_process'); const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..'); const PORT = 8829;
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
  const ud = path.join(os.tmpdir(), 'scprx-bal-' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9375', '--user-data-dir=' + ud,
    '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = JSON.parse(await new Promise((res, rej) => { http.get('http://127.0.0.1:9375/json/list', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej); }));
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

    // 直接读数据表，算「几下打死」—— 不依赖实际交战
    const t = await ev(`(function(){
      const row = (k, v) => k + '=' + v;
      const scps = {};
      for (const k in SCP_DEFS) {
        const d = SCP_DEFS[k];
        scps[k] = { hp: d.hp, speed: d.speed, dmg: d.touchDmg, cd: d.atkCd,
                    dps: d.touchDmg >= 999 ? '秒杀' : +(d.touchDmg / d.atkCd).toFixed(1),
                    grab: d.grabDps || 0 };
      }
      // 目标血量
      const tgts = {
        玩家_无甲: 115,
        玩家_III级: Math.round(115 / (1 - ARMOR_DEFS[2].resist)),
        MTF队友: 170,
        混沌分裂者: 150,
        设施保安: 110,
        研究员: 65,
        D级人员: 60,
      };
      // 每个"靠伤害"的 SCP 对每个目标要几下
      const hits = {};
      for (const k of ['076','682','939','966','3114']) {
        const d = SCP_DEFS[k];
        hits[d.name] = {};
        for (const n in tgts) hits[d.name][n] = Math.ceil(tgts[n] / d.touchDmg);
      }
      return { 秒杀型: ['173','096','049','106'].map(k => SCP_DEFS[k].name + ' ' + SCP_DEFS[k].touchDmg),
               SCP: scps, 目标有效血量: tgts, 几下打死: hits,
               护甲: ARMOR_DEFS.map(a => a.name + ' 减伤' + Math.round(a.resist * 100) + '%'),
               玩家HP: 115, 队友HP: 170, CI_HP: 150,
               人员HP: PERSONNEL_DEFS.classd.hp + '/' + PERSONNEL_DEFS.scientist.hp + '/' + PERSONNEL_DEFS.guard.hp,
               队友伤害: '14~21', CI伤害: FACTION_DEFS.ci.dmgMin + '~' + FACTION_DEFS.ci.dmgMax };
    })()`);
    console.log('秒杀型 SCP:', JSON.stringify(t.秒杀型));
    console.log('');
    console.log('SCP 数值:');
    for (const k in t.SCP) console.log('  ' + t.SCP[k].hp.toString().padStart(5) + ' HP  ' +
      t.SCP[k].speed.toString().padStart(5) + ' 速  ' + t.SCP[k].dmg.toString().padStart(4) + ' 伤 / ' +
      t.SCP[k].cd + 's  → ' + String(t.SCP[k].dps).padStart(5) + ' DPS' + (t.SCP[k].grab ? '  +抓取 ' + t.SCP[k].grab + '/s' : '') + '   [' + k + ']');
    console.log('');
    console.log('目标有效血量:', JSON.stringify(t.目标有效血量));
    console.log('护甲:', JSON.stringify(t.护甲));
    console.log('');
    console.log('几下打死（伤害型 SCP）:');
    for (const s in t.几下打死) {
      const row = t.几下打死[s];
      console.log('  ' + s.padEnd(12) + Object.keys(row).map(n => n + ':' + row[n]).join('  '));
    }
    console.log('');
    console.log('人类阵营:', JSON.stringify({ 玩家HP: t.玩家HP, 队友HP: t.队友HP, CI_HP: t.CI_HP,
      人员HP_D级_研究员_保安: t.人员HP, 队友伤害: t.队友伤害, CI伤害: t.CI伤害 }));

    // 断言：939 不该一口咬死任何人类
    const oneShot = await ev(`(function(){
      const d = SCP_DEFS['939'];
      const bad = [];
      if (d.touchDmg >= PERSONNEL_DEFS.classd.hp) bad.push('D级人员');
      if (d.touchDmg >= PERSONNEL_DEFS.scientist.hp) bad.push('研究员');
      if (d.touchDmg >= PERSONNEL_DEFS.guard.hp) bad.push('设施保安');
      if (d.touchDmg >= 170) bad.push('MTF队友');
      if (d.touchDmg >= 115) bad.push('玩家(无甲)');
      return { 一口伤害: d.touchDmg, 能一口秒掉: bad };
    })()`);
    console.log('');
    console.log('939 一口秒杀检查:', JSON.stringify(oneShot), oneShot.能一口秒掉.length ? '❌ 仍能秒杀' : '✅ 谁都不能一口秒');

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
