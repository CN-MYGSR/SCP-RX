'use strict';
/* =====================================================================
   SCP：RX 自检 —— 无头 Chrome + CDP
   用法: node _tools/harness.js [--shots]
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8788;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
const SHOTS = process.argv.includes('--shots');
const OUTDIR = path.join(ROOT, '_tools', 'shots');
if (SHOTS && !fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function startServer() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end('404'); return; }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(rq);
    });
    s.listen(PORT, '127.0.0.1', () => res(s));
  });
}

function launchChrome() {
  const ud = path.join(require('os').tmpdir(), 'scprx-chrome-' + Date.now());
  const args = [
    '--headless=new',
    '--remote-debugging-port=9333',
    '--user-data-dir=' + ud,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=1280,720',
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return proc;
}

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}
async function waitForDevtools(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const txt = await httpGet('http://127.0.0.1:9333/json/list');
      const list = JSON.parse(txt);
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('devtools 未就绪');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const c = new CDP(ws);
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id);
        c.pending.delete(m.id);
        if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
      } else if (m.method) {
        c.events.push(m);
      }
    });
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 30000);
    });
  }
  async eval(expr, awaitPromise) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise, userGesture: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || JSON.stringify(r.exceptionDetails)));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

(async () => {
  const server = await startServer();
  console.log('静态服务已启动 http://127.0.0.1:' + PORT);
  const chrome = launchChrome();
  let cdp = null;
  const errors = [];
  try {
    const wsUrl = await waitForDevtools(20000);
    cdp = await CDP.connect(wsUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');

    const nav = await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?nopause=1' });
    await new Promise(r => setTimeout(r, 3500));

    // 收集控制台错误
    const collect = () => {
      for (const e of cdp.events) {
        if (e.method === 'Runtime.exceptionThrown') {
          const d = e.params.exceptionDetails;
          errors.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text));
        }
        if (e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'warning')) {
          errors.push(e.params.type.toUpperCase() + ': ' + e.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
        }
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
          errors.push('LOG: ' + e.params.entry.text);
        }
      }
      cdp.events.length = 0;
    };
    collect();

    const phase1 = await cdp.eval('({phase: GAME.phase, bootHidden: document.getElementById("bootScreen").classList.contains("hidden"), hasThree: typeof THREE!=="undefined", tex: Object.keys(TEX).length})');
    console.log('启动后状态:', JSON.stringify(phase1));

    // 进入配装界面
    await cdp.eval('document.querySelector("[data-p=mLoadout]").click()');
    await new Promise(r => setTimeout(r, 400));
    const lo = await cdp.eval('({presets: document.querySelectorAll(".presetCard").length, mods: document.querySelectorAll("#modList .modItem").length, armor: document.querySelectorAll(".armorBtn").length})');
    console.log('配装界面:', JSON.stringify(lo));
    if (SHOTS) {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUTDIR, '01-loadout.png'), Buffer.from(s.data, 'base64'));
    }

    // 切到 M249 配装并改装
    await cdp.eval('document.querySelectorAll(".presetCard")[2].click()');
    await new Promise(r => setTimeout(r, 200));
    await cdp.eval('document.querySelectorAll("#modList .modItem")[2].click()');
    await new Promise(r => setTimeout(r, 150));
    const modState = await cdp.eval('JSON.stringify(LOADOUT)');
    console.log('改装后配装:', modState);

    // 部署
    await cdp.eval('document.getElementById("deployGo").click()');
    await new Promise(r => setTimeout(r, 4000));

    const g1 = await cdp.eval(`({
      phase: GAME.phase,
      rooms: FAC.rooms.length,
      boxes: BOXES.length,
      cyls: CYLS.length,
      doors: FAC.doors.length,
      lights: LIGHT_SOURCES.length,
      navReady: NAV.ready,
      navN: NAV.N,
      scps: SCP_LIST.length,
      allies: ALLY_LIST.length,
      pickups: PICKUPS.length,
      corpses: CORPSES.length,
      playerAlive: player.alive,
      playerHp: player.hp,
      weapon: player.cur() && player.cur().stats.name,
      mag: player.cur() && player.cur().mag,
      spawn: [Math.round(player.pos.x), Math.round(player.pos.z)],
      sceneChildren: scene.children.length,
      breakerCount: FAC.breakers.length,
      hasTerminal: !!FAC.terminal,
      hasExtract: !!FAC.extract
    })`);
    console.log('部署后世界:', JSON.stringify(g1, null, 1));

    if (SHOTS) {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUTDIR, '02-ingame-spawn.png'), Buffer.from(s.data, 'base64'));
    }
    // 开镜截图
    await cdp.eval('player.ads = true; VM.adsBlend = 1;');
    await new Promise(r => setTimeout(r, 900));
    if (SHOTS) {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUTDIR, '03-ads.png'), Buffer.from(s.data, 'base64'));
    }
    await cdp.eval('player.ads = false; VM.adsBlend = 0;');
    await new Promise(r => setTimeout(r, 400));
    const camDiag = await cdp.eval(`(function(){
      const info = window.__lastInfo || {};
      const fwd = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
      const hit = raycastWorld(camera.position, fwd, 60);
      return {
        info: info,
        armor: [player.armor, player.armorMax, Math.round(player.armorHp)],
        fwd: [+fwd.x.toFixed(2), +fwd.y.toFixed(2), +fwd.z.toFixed(2)],
        hit: hit ? {d:+hit.dist.toFixed(2), kind:hit.kind} : null,
        canvas: [renderer.domElement.width, renderer.domElement.height],
        glLost: renderer.getContext().isContextLost(),
        instMeshes: scene.children.filter(o=>o.isInstancedMesh).map(o=>o.count)
      };
    })()`);
    console.log('渲染诊断:', JSON.stringify(camDiag));

    // 采样若干帧，检查主循环是否推进
    const t0 = await cdp.eval('GAME.elapsed');
    await new Promise(r => setTimeout(r, 1500));
    const t1 = await cdp.eval('GAME.elapsed');
    console.log('主循环推进: elapsed ' + t0.toFixed(2) + ' -> ' + t1.toFixed(2) + ' (dt=' + (t1 - t0).toFixed(2) + ')');

    // 模拟移动
    const before = await cdp.eval('[player.pos.x, player.pos.z]');
    await cdp.eval('keys.fwd = true');
    await new Promise(r => setTimeout(r, 1200));
    await cdp.eval('keys.fwd = false');
    const after = await cdp.eval('[player.pos.x, player.pos.z]');
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
    console.log('前进移动距离: ' + moved.toFixed(2) + ' m');

    // 模拟开火
    await cdp.eval('keys.fire = true');
    await new Promise(r => setTimeout(r, 500));
    await cdp.eval('keys.fire = false');
    const shoot = await cdp.eval('({shots: player.shots, mag: player.cur().mag, fx: TRACERS.length + DECALS.length})');
    console.log('开火测试:', JSON.stringify(shoot));

    // SCP 行为抽样
    await new Promise(r => setTimeout(r, 3000));
    const scpState = await cdp.eval('SCP_LIST.map(s=>({k:s.key, hp:Math.round(s.hp), alive:s.alive, state:s.state, x:Math.round(s.pos.x), z:Math.round(s.pos.z), obs:!!s.observed}))');
    console.log('SCP 状态:');
    for (const s of scpState) console.log('  ' + JSON.stringify(s));

    // 盟友状态
    const allyState = await cdp.eval('ALLY_LIST.map(a=>({n:a.name, hp:Math.round(a.hp), alive:a.alive, x:Math.round(a.pos.x), z:Math.round(a.pos.z)}))');
    console.log('队友状态:', JSON.stringify(allyState));

    // 把 173 挪到玩家面前的空旷大厅，测试观察冻结机制
    const test173 = await cdp.eval(`(function(){
      const s = SCP_LIST.find(v=>v.key==='173');
      if(!s) return {err:'no 173'};
      player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
      player.yaw = 0; player.pitch = 0;
      // 放在正前方（-Z）5.5 米处
      s.pos.set(player.pos.x, 0, player.pos.z - 5.5);
      s.pos.y = 0;
      return {px: +player.pos.x.toFixed(1), pz: +player.pos.z.toFixed(1), sx: +s.pos.x.toFixed(1), sz: +s.pos.z.toFixed(1)};
    })()`);
    console.log('173 测试布场:', JSON.stringify(test173));
    await new Promise(r => setTimeout(r, 1200));
    const obs = await cdp.eval(`(function(){
      const s = SCP_LIST.find(v=>v.key==='173');
      const hpBefore = s.hp;
      const dmg = damageSCP(s, 40, {byPlayer:true, head:false, from:player});
      return {observed: s.observed, state: s.state, blinking: player.blinking,
              hpBefore: Math.round(hpBefore), hpAfter: Math.round(s.hp), dmgApplied: Math.round(dmg)};
    })()`);
    console.log('SCP-173 观察冻结测试:', JSON.stringify(obs));
    // 未被观察时（把 173 挪到视野外）应完全免疫伤害
    const obs3 = await cdp.eval(`(function(){
      const s = SCP_LIST.find(v=>v.key==='173');
      s.pos.set(player.pos.x + 30, 0, player.pos.z + 30);   // 挪到视野外
      player.yaw = 0; player.pitch = 0;
      s.observed = false;                                    // 同一帧内直接判定，避免被 AI 覆盖
      const hpBefore = s.hp;
      const dmg = damageSCP(s, 40, {byPlayer:true, head:false, from:player});
      return {hpBefore: Math.round(hpBefore), hpAfter: Math.round(s.hp), dmgApplied: Math.round(dmg)};
    })()`);
    console.log('SCP-173 未被观察时（应免疫）:', JSON.stringify(obs3));

    // ---------- Project SCRAMBLE：直视 SCP-096 不触发暴走 ----------
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const sc1 = await cdp.eval(`(function(){
      DEBUG.god = true;                      // 测试期间免伤，免得被暴走的 096 秒杀影响后续用例
      player.hp = player.maxHp;
      const s = SCP_LIST.find(v=>v.key==='096');
      if(!s) return {err:'no 096'};
      player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
      player.yaw = 0; player.pitch = 0;
      s.enraged = false; s.rageT = 0; s.awake = true;
      // 相机是"上一帧"的状态，直接查视线会假阴性 —— 先强制同步一次相机
      if (typeof updateCamera === 'function') updateCamera(0.016);
      // 大厅里有随机道具，逐个距离试到"确实能看见它"为止，否则这个用例会假阴性
      let placed = null;
      for (const dz of [-5.5, -4.6, -6.4, -3.8, -7.2, -4.2]) {
        s.pos.set(player.pos.x, 0, player.pos.z + dz);
        if (playerLooksAt(s.pos.x, s.pos.y + s.height * 0.92, s.pos.z, 22)) { placed = dz; break; }
      }
      if (placed === null) { s.pos.set(player.pos.x, 0, player.pos.z - 5.5); }
      LOADOUT.gear = 'scramble'; NVG.battery = 100; NVG.on = true; NVG.apply();
      return {gear: NVG.gear(), on: NVG.on, active: NVG.scrambleActive(), placedAt: placed,
              losOk: playerLooksAt(s.pos.x, s.pos.y + s.height * 0.92, s.pos.z, 22)};
    })()`);
    console.log('SCRAMBLE 装备:', JSON.stringify(sc1));
    await wait(1600);
    // ---------- NPC 过门测试：玩家放远，门只能被 NPC 自己触发 ----------
    const doorSetup = await cdp.eval(`(function(){
      const d = FAC.doors.find(x => x.room && x.room.id === 'LCZ-LAB') || FAC.doors[0];
      DEBUG.god = true;
      // 把所有 SCP 送回各自收容间，排除"队友在躲怪"的干扰
      SCP_LIST.forEach(s => { s.pos.set(s.spawnX, 0, s.spawnZ); s.target = null; });
      const a = ALLY_LIST[0];
      a.pos.set(d.x, 0, d.z - 1.4); a.alive = true; a.target = null; a.retargetT = 0;
      ALLY_LIST.slice(1).forEach((x, i) => { x.pos.set(d.x - 3.5, 0, d.z - 6 - i * 2.5); x.target = null; x.retargetT = 0; });
      player.pos.set(d.x, 0, d.z + 7);   // 超出 5m 触发半径，门只能由队友打开
      player.yaw = 0; player.pitch = 0;
      return { door: d.room.id, doorX: +d.x.toFixed(1), doorZ: +d.z.toFixed(1),
               allyZ0: +a.pos.z.toFixed(1), playerZ: +player.pos.z.toFixed(1),
               队友距门: +Math.hypot(a.pos.x - d.x, a.pos.z - d.z).toFixed(1) };
    })()`);
    console.log('过门测试布场:', JSON.stringify(doorSetup));
    await wait(4000);
    const doorMid = await cdp.eval(`(function(){
      const d = FAC.doors.find(x => x.room && x.room.id === 'LCZ-LAB') || FAC.doors[0];
      const a = ALLY_LIST[0];
      return { 门开着: d.open, 门开度: +d.t.toFixed(2), 碰撞体已关: !!d.col.noClip, 队友_z: +a.pos.z.toFixed(1) };
    })()`);
    console.log('  → 中途', JSON.stringify(doorMid));
    await wait(3000);
    const doorAfter = await cdp.eval(`(function(){
      const d = FAC.doors.find(x => x.room && x.room.id === 'LCZ-LAB') || FAC.doors[0];
      const a = ALLY_LIST[0];
      // ---- 不依赖帧率的直推测试：把队友放在门口，硬推 5m，看门碰撞体放不放行 ----
      const savedZ = a.pos.z, savedX = a.pos.x;
      a.pos.set(d.x, 0, d.z - 1.6);
      const before = a.pos.z;
      for (let i = 0; i < 20; i++) { a.pos.z += 0.25; collideMove(a.pos, a.radius, a.height, 0.5); }
      const pushed = a.pos.z - before;
      a.pos.set(savedX, 0, savedZ);
      // ---- 对照：把门强行关上再推一次 ----
      const savedOpen = d.open, savedT = d.t;
      d.open = false; d.t = 0; d.col.noClip = false;
      a.pos.set(d.x, 0, d.z - 1.6);
      const before2 = a.pos.z;
      for (let i = 0; i < 20; i++) { a.pos.z += 0.25; collideMove(a.pos, a.radius, a.height, 0.5); }
      const pushedClosed = a.pos.z - before2;
      d.open = savedOpen; d.t = savedT;
      a.pos.set(savedX, 0, savedZ);
      return {
        门开着: d.open, 门开度: +d.t.toFixed(2),
        门开时推进: +pushed.toFixed(2) + 'm / 5m',
        门关时推进: +pushedClosed.toFixed(2) + 'm / 5m',
        门_z: +d.z.toFixed(1),
      };
    })()`);
    console.log('  →', JSON.stringify(doorAfter));
    await cdp.eval(`(function(){
      DEBUG.god = false;
      SCP_LIST.forEach(s => { s.pos.set(s.spawnX, 0, s.spawnZ); s.enraged = false; s.target = null; });
      ALLY_LIST.forEach((x, i) => { x.pos.set(FAC.spawn.x + i * 2 - 2, 0, FAC.spawn.z + i * 2 + 1); x.target = null; });
      player.pos.set(FAC.spawn.x, 0, FAC.spawn.z); player.hp = player.maxHp;
    })()`);


    // （不依赖帧率，headless 慢也能得到确定结论）
    // SCRAMBLE 决定性验证：把 rageT 直接顶到阈值之上，看会不会暴走
    // （不依赖帧率，headless 慢也能得到确定结论）
    const sc2 = await cdp.eval(`(function(){
      // 自包含布场：过门测试把 SCP 都送回收容间了，这里重新摆好
      DEBUG.god = true;
      player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
      player.yaw = 0; player.pitch = 0;
      const s = SCP_LIST.find(v=>v.key==='096');
      s.pos.set(player.pos.x, 0, player.pos.z - 5.5);
      s.enraged = false; s.rageT = 0.95;      // 已经超过 0.7 的暴走阈值
      LOADOUT.gear = 'scramble'; NVG.battery = 100; NVG.on = true; NVG.apply();
      if (typeof updateCamera === 'function') updateCamera(0.016);
      return {scrambleOn: NVG.scrambleActive(), rageT: s.rageT,
              los: playerLooksAt(s.pos.x, s.pos.y + s.height*0.92, s.pos.z, 22)};
    })()`);
    await wait(1500);
    const sc2b = await cdp.eval(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      return {'戴着SCRAMBLE直视': {enraged: s.enraged, rageT: +s.rageT.toFixed(2),
        scrambleHold: !!s.scrambleHold,
        quadVisible: !!(s.model.scrambleQuad && s.model.scrambleQuad.visible),
        hudInd: !document.getElementById('scramInd').classList.contains('hidden'),
        _diag: { los: playerLooksAt(s.pos.x, s.pos.y + s.height*0.92, s.pos.z, 22),
                 scram: NVG.scrambleActive(), gear: NVG.gear(), on: NVG.on,
                 batt: Math.round(NVG.battery), blinking: !!player.blinking,
                 py: +player.yaw.toFixed(2), cy: +camera.rotation.y.toFixed(2),
                 dist: +Math.hypot(s.pos.x-player.pos.x, s.pos.z-player.pos.z).toFixed(1) }}};
    })()`);
    console.log('SCRAMBLE 测试:', JSON.stringify(sc2), '→', JSON.stringify(sc2b));

    // 关掉 SCRAMBLE（模拟电量耗尽），同样条件应该立刻暴走
    const sc3 = await cdp.eval(`(function(){
      NVG.on = false; NVG.apply();
      const s = SCP_LIST.find(v=>v.key==='096');
      s.enraged = false; s.rageT = 0.95;
      return {scrambleActive: NVG.scrambleActive(), rageT: s.rageT};
    })()`);
    await wait(1500);
    const sc4 = await cdp.eval(`(function(){
      const s = SCP_LIST.find(v=>v.key==='096');
      return {'关掉后同样直视': {enraged: s.enraged, rageT: +s.rageT.toFixed(2)}};
    })()`);
    console.log('  →', JSON.stringify(sc3), JSON.stringify(sc4));
    // 复原，避免影响后面的清剿测试
    await cdp.eval(`(function(){ NVG.on = false; NVG.apply(); DEBUG.god = false;
      const s = SCP_LIST.find(v => v.key === '096');
      if (s) { s.enraged = false; s.rageT = 0; s.pos.set(s.spawnX, 0, s.spawnZ); }
      player.hp = player.maxHp;
    })()`);


    // 断路器交互测试
    const brk = await cdp.eval(`(function(){
      const b = FAC.breakers[0];
      player.pos.x = b.x; player.pos.z = b.z + 1.2;
      player.scanInteract();
      return {id: b.id, found: player.interact ? (player.interact.id||'terminal') : null};
    })()`);
    console.log('交互扫描:', JSON.stringify(brk));

    // 直接推进任务链（模拟完成）
    const flow = await cdp.eval(`(function(){
      for(const b of FAC.breakers){ b.done=true; onBreakerDone(b); }
      onProtocolDone();
      return {power: GAME.powerOn, protocol: GAME.protocol, st: objectiveStatus()};
    })()`);
    console.log('任务链推进:', JSON.stringify(flow));

    // ---------- 落锤行动 · 销毁收容档案照片 ----------
    const photo0 = await cdp.eval(`(function(){
      DEBUG.god = true;
      return { 照片总数: PHOTOS.length,
               分布: PHOTOS.map(p => p.where),
               坐标: PHOTOS.map(p => [Math.round(p.x), Math.round(p.z)]),
               全部可交互: PHOTOS.every(p => p.isPhoto && !p.done),
               初始未销毁: PHOTOS.filter(p => !p.done).length,
               照片目标状态: objectiveStatus().photos,
               撤离已解锁: extractReady() };
    })()`);
    console.log('照片任务:', JSON.stringify(photo0));
    if (photo0.照片总数 !== 6) console.log('  ⚠️ 期望 6 张照片，实际 ' + photo0.照片总数 + ' 张');

    // 逐张走过去按住 F 划掉 —— 必须走完整的 hold 判定路径，
    // 直接调 destroyPhoto() 会漏掉 holdNeed 之类的错误
    const photo1 = await cdp.eval(`(function(){
      const res = [];
      for (const p of PHOTOS) {
        player.pos.set(p.x, 0, p.z + 1.4);
        player.scanInteract();
        const it = player.interact;
        const found = !!(it && it.isPhoto);
        const hasHold = !!(it && typeof it.holdNeed === 'number' && it.holdNeed > 0);
        player.interactHold = 0;
        let frames = 0;
        while (frames < 80 && !p.done) {
          frames++;
          player.interactHold += 0.05;
          if (player.interactHold >= player.interact.holdNeed) {
            completeInteract(player.interact);
            player.interactHold = 0;
          }
        }
        res.push((found && hasHold && p.done ? '✓' : '✗') + p.where.split(' · ')[0] + '(' + frames + '帧)');
      }
      return { 按住F逐张划掉: res.join(' '),
               剩余: PHOTOS.filter(q => !q.done).length,
               照片目标状态: objectiveStatus().photos,
               全部红叉可见: PHOTOS.every(q => q.cross.visible) };
    })()`);
    console.log('  →', JSON.stringify(photo1));

    // 撤离门控：清剿没完成时仍然锁着
    const gate = await cdp.eval(`(function(){
      const st = objectiveStatus();
      return { 照片已清空: PHOTOS.every(p => p.done),
               清剿未完成: Object.keys(GAME.contained).length < SCP_ORDER.length,
               撤离已解锁: extractReady(), 目标链: st };
    })()`);
    console.log('  撤离门控（照片清空但未清剿）:', JSON.stringify(gate));

    // ---------- Project SCRAMBLE 也应该能挡照片里的脸 ----------
    const sp1 = await cdp.eval(`(function(){
      DEBUG.god = true;
      const s = SCP_LIST.find(v => v.key === '096');
      s.enraged = false; s.rageT = 0; s.hooded = false;
      const p = PHOTOS[0];
      p.done = false; p.viewT = 3.4; p.warned = false; p.cross.visible = false;
      player.pos.set(p.x, 0, p.z - 2.0); player.yaw = Math.PI; player.pitch = -0.2;
      LOADOUT.gear = 'scramble'; NVG.battery = 100; NVG.on = true; NVG.apply();
      return { scrambleActive: NVG.scrambleActive(), 照片视线内: playerLooksAt(p.x, p.y + 0.05, p.z, 26),
               viewT: p.viewT };
    })()`);
    await wait(1600);
    const sp2 = await cdp.eval(`(function(){
      const s = SCP_LIST.find(v => v.key === '096');
      return { 戴着SCRAMBLE盯照片: { enraged: s.enraged, viewT: +PHOTOS[0].viewT.toFixed(2) } };
    })()`);
    // 关掉 SCRAMBLE，同样条件应该立刻暴走
    const sp3 = await cdp.eval(`(function(){
      NVG.on = false; NVG.apply();
      const s = SCP_LIST.find(v => v.key === '096');
      s.enraged = false; PHOTOS[0].viewT = 3.4;
      return { scrambleActive: NVG.scrambleActive() };
    })()`);
    await wait(1600);
    const sp4 = await cdp.eval(`(function(){
      const s = SCP_LIST.find(v => v.key === '096');
      return { 关掉后同样盯照片: { enraged: s.enraged } };
    })()`);
    console.log('SCRAMBLE 防照片:', JSON.stringify(sp1), '→', JSON.stringify(sp2));
    console.log('  →', JSON.stringify(sp3), JSON.stringify(sp4));
    await cdp.eval(`(function(){
      DEBUG.god = false; NVG.on = false; NVG.apply();
      const s = SCP_LIST.find(v => v.key === '096');
      if (s) { s.enraged = false; s.rageT = 0; s.pos.set(s.spawnX, 0, s.spawnZ); }
      PHOTOS.forEach(p => { p.viewT = 0; p.done = true; });
      player.hp = player.maxHp;
    })()`);

    // 击杀所有 SCP，检查结算路径（173 需先置为"被观察"，076 需二次击杀）
    const kill = await cdp.eval(`(function(){
      let n=0;
      for(let pass=0; pass<3; pass++){
        for(const s of SCP_LIST){
          if(!s.alive) continue;
          s.enraged=true; s.observed=true; s.hp=1;
          damageSCP(s, 9999, {byPlayer:true, head:true, from:player});
          n++;
        }
      }
      return {attempts:n, contained:Object.keys(GAME.contained).length, st:objectiveStatus()};
    })()`);
    console.log('清剿测试:', JSON.stringify(kill));

    if (SHOTS) {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUTDIR, '02-ingame.png'), Buffer.from(s.data, 'base64'));
    }

    await new Promise(r => setTimeout(r, 1500));
    collect();

    // 撤离测试
    const ext = await cdp.eval(`(function(){
      player.pos.set(FAC.extract.x, 0, FAC.extract.z + 2.0);
      player.scanInteract();
      const found = player.interact === FAC.extract;
      onExtractionDone();
      return {found: found, over: GAME.over, won: GAME.won, phase: GAME.phase,
              endVisible: !document.getElementById('endScreen').classList.contains('hidden'),
              title: document.getElementById('endTitle').textContent};
    })()`);
    console.log('撤离测试:', JSON.stringify(ext));
    if (SHOTS) {
      await new Promise(r => setTimeout(r, 600));
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUTDIR, '04-end.png'), Buffer.from(s.data, 'base64'));
    }
    collect();

    // 渲染器统计
    const rinfo = await cdp.eval('({calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geo: renderer.info.memory.geometries, tex: renderer.info.memory.textures, fps: fpsShow})');
    console.log('渲染统计:', JSON.stringify(rinfo));

    const final = await cdp.eval('({phase: GAME.phase, over: GAME.over, won: GAME.won})');
    console.log('最终状态:', JSON.stringify(final));

  } catch (e) {
    console.error('自检异常:', e.message);
    errors.push('HARNESS: ' + e.message);
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill(); } catch (e) { }
    server.close();
  }

  console.log('\n================ 控制台错误汇总 ================');
  if (!errors.length) console.log('✅ 无错误');
  else { const uniq = [...new Set(errors)]; uniq.slice(0, 40).forEach(e => console.log('  ❌ ' + e)); console.log('共 ' + uniq.length + ' 条'); }
  process.exit(errors.length ? 1 : 0);
})();
