'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  12d SCP-079「旧 AI」（可玩角色）
   还原 SCP: Secret Laboratory 的 079：

   · 没有身体、没有血量、**打不死** —— 你只是设施里的一台机器。
   · 用**摄像头**看世界（Q/E 切换，每跳一次 2 AP）。
   · 一切行动都吃**辅助电力 AP**，AP 靠时间回充，等级越高回得越快。
   · 靠交互攒 **EXP** 升级（Tier 1→5），解锁新能力并提高 AP 上限。
   · 能力：开关门 / 锁门 / 停电封锁（Tier 2）/ 特斯拉门过充 / 扬声器。
   · **除了特斯拉门，你没有直接杀人的手段** —— 只能把人往 SCP 嘴里赶。
   · 被收容的唯一方式：核弹、发电机（本作没有）、或者**其他 SCP 全被清空**。

   与 SL 的差异（本作条件所限，写在这里以免误解）：
   · 没有发电机与 Alpha 核弹收容流程，所以败北条件只剩「其他 SCP 全灭」。
   · 摄像头按房间生成，用 Q/E 顺序切换，没有做地图点选。
   ===================================================================== */

const AI079 = {
  active: false,
  cams: [], camIdx: 0,
  ap: 100, exp: 0, tier: 1,
  lockT: 0, blackoutT: 0, teslaT: 0, speakerT: 0,
  darkLights: [], darkT: 0, darkRoom: null,
  teslas: [],
  teslaKills: 0, blackoutCount: 0, trapped: 0,
  lastApWarn: 0,
};

const O79_AP_MAX = [100, 110, 125, 150, 200];      // 各 Tier 的 AP 上限
const O79_REGEN = [1.2, 2.5, 4.1, 6.8, 11.2];      // 各 Tier 的 AP/s
const O79_EXP_NEXT = [90, 160, 260, 380, 1e9];     // 升到下一级需要的 EXP

function o79TierIdx() { return clamp(AI079.tier - 1, 0, 4); }
function o79APMax() { return O79_AP_MAX[o79TierIdx()]; }
function o79Regen() { return O79_REGEN[o79TierIdx()]; }

/* ---------------------------------------------------------------------
   摄像头：每个房间一台，装在角落俯视房间中心
   --------------------------------------------------------------------- */
function build079Cameras() {
  AI079.cams = [];
  for (const rm of FAC.rooms) {
    if (rm.kind === 'corridor') continue;
    const x = rm.cx + rm.w * 0.34;
    const z = rm.cz + rm.d * 0.34;
    const y = WALL_H - 0.45;
    AI079.cams.push({
      id: rm.id, name: rm.name, zone: rm.zone, room: rm,
      x, y, z,
      yaw: Math.atan2(-(rm.cx - x), -(rm.cz - z)),
    });
  }
  AI079.camIdx = clamp(AI079.camIdx, 0, Math.max(0, AI079.cams.length - 1));
}
function o79Cam() { return AI079.cams[AI079.camIdx] || null; }
function o79Room() { const c = o79Cam(); return c ? c.room : null; }

function o79Goto(idx) {
  if (!AI079.cams.length) return;
  const n = AI079.cams.length;
  AI079.camIdx = ((idx % n) + n) % n;
  const c = o79Cam();
  if (c) {
    player.pos.set(c.x, c.y - player.eyeH, c.z);
    player.yaw = c.yaw; player.pitch = -0.22;
  }
  AudioSys.beep(true);
}
function o79Switch(delta) {
  if (AI079.ap < 2) { o79NoPower(); return; }
  AI079.ap -= 2;
  o79AddExp(0.4);
  o79Goto(AI079.camIdx + delta);
}

/* ---------------------------------------------------------------------
   特斯拉门：在几个走廊要冲装发射器
   --------------------------------------------------------------------- */
function build079Tesla() {
  AI079.teslas = [];
  // 挑 4 个分散在全设施的门位当"要冲" —— 门本来就是天然的瓶颈
  const pick = [];
  const n = FAC.doors.length;
  if (n) for (let i = 0; i < 4; i++) pick.push(FAC.doors[Math.floor(n * (i + 0.5) / 4)]);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.7 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x2a6a8a });
  for (const d of pick) {
    if (!d) continue;
    const g = new THREE.Group();
    // 两侧立柱 + 顶部横梁，中间是放电区
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, WALL_H * 0.72, 0.22), mat);
      post.position.set(sx * 2.5, WALL_H * 0.36, 0); g.add(post);
      const node = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), glowMat);
      node.position.set(sx * 2.5, WALL_H * 0.66, 0); g.add(node);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.16, 0.16), mat);
    beam.position.set(0, WALL_H * 0.72, 0); g.add(beam);
    g.position.set(d.x, 0, d.z);
    scene.add(g);
    AI079.teslas.push({ x: d.x, z: d.z, group: g, nodeMat: glowMat, cd: 0, flash: 0 });
  }
}

/* 过充：对范围内的**人类**造成致命伤害；SCP 免疫（SL 里 079 能团队击杀也是这个道理） */
function o79TeslaFire() {
  if (AI079.teslaT > 0) return;
  if (AI079.ap < 50) { o79NoPower(); return; }
  const cam = o79Cam();
  if (!cam) return;
  // 找离当前摄像头最近的特斯拉门
  let best = null, bd = 1e9;
  for (const t of AI079.teslas) {
    const d = Math.hypot(t.x - cam.x, t.z - cam.z);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best || bd > 34) { toast('附近没有可控的特斯拉门', 2200, 'warn'); return; }
  AI079.ap -= 50;
  AI079.teslaT = 4.0;
  best.cd = 0.7;
  AudioSys.alarm(); AudioSys.gunshot('shotgun', 4);
  flashScreen(0.5, '#8ad8ff');
  addTrauma(0.35);
  // 放电：范围 5.5m 内的人类直接致死
  let n = 0;
  const R2 = 5.5 * 5.5;
  const hit = (e) => {
    if (!e || !e.alive) return;
    const dx = e.pos.x - best.x, dz = e.pos.z - best.z;
    if (dx * dx + dz * dz > R2) return;
    e.damage(9999, null, { limb: 'torso' });
    n++;
  };
  for (const a of ALLY_LIST) hit(a);
  for (const p of PERSONNEL_LIST) if (!p.escaped && p.def.side !== 'scp') hit(p);
  for (const f of FACTION_LIST) hit(f);
  AI079.teslaKills += n;
  o79AddExp(15);
  if (n) {
    broadcast('◤ 特斯拉门过充 · ' + n + ' 名人员被击杀');
    toast('特斯拉门放电 · 击杀 ' + n + ' 人', 3000, 'good');
  } else {
    broadcast('◤ 特斯拉门过充 · 无人伤亡');
  }
}

/* ---------------------------------------------------------------------
   门控制（当前摄像头所在房间的门）
   --------------------------------------------------------------------- */
function o79RoomDoors() {
  const rm = o79Room();
  if (!rm) return [];
  // ⚠️ 必须按 id 比 —— FAC.doors[].room 存的是 LAYOUT 里的房间对象，
  //    而 o79Room() 返回的是 FAC.rooms 里的条目，两者引用不同、永不相等。
  return FAC.doors.filter(d => d.leafA && d.room && d.room.id === rm.id);
}
function o79DoorToggle() {
  const ds = o79RoomDoors();
  if (!ds.length) { toast('这个房间没有可控的门', 1800, 'warn'); return; }
  if (AI079.ap < 5) { o79NoPower(); return; }
  AI079.ap -= 5;
  o79AddExp(1.5);
  let any = false;
  for (const d of ds) {
    // 手动强制：locked 优先，其次 forced（强制开）
    if (d.locked) { d.locked = false; d.forced = true; any = true; }
    else { d.forced = !d.forced; if (!d.forced) d.locked = false; any = true; }
  }
  AudioSys.door(true);
  const open = ds.some(d => d.forced && !d.locked);
  broadcast('◤ SCP-079 手动' + (open ? '开启' : '关闭') + ' ' + (o79Room() ? o79Room().name : '') + ' 的气密门');
}
function o79LockToggle() {
  const ds = o79RoomDoors();
  if (!ds.length) { toast('这个房间没有可控的门', 1800, 'warn'); return; }
  if (AI079.ap < 10) { o79NoPower(); return; }
  const anyUnlocked = ds.some(d => !d.locked);
  AI079.ap -= 10;
  o79AddExp(4);
  for (const d of ds) { d.locked = anyUnlocked; if (anyUnlocked) d.forced = false; }
  AudioSys.beep(false);
  if (anyUnlocked) {
    broadcast('◤ 警告 · ' + (o79Room() ? o79Room().name : '') + ' 已封锁 · 气密门锁死');
    toast('门已锁死 · 人类无法通过', 2600, 'good');
  } else {
    broadcast('◤ ' + (o79Room() ? o79Room().name : '') + ' 解除封锁');
  }
}

/* ---------------------------------------------------------------------
   停电 / 封锁（Tier 2）
   --------------------------------------------------------------------- */
function o79Blackout() {
  if (AI079.tier < 2) { toast('停电能力需要 Tier 2', 2200, 'warn'); return; }
  if (AI079.ap < 60) { o79NoPower(); return; }
  const rm = o79Room();
  if (!rm) return;
  AI079.ap -= 60;
  o79AddExp(20);
  AI079.blackoutCount++;
  AI079.darkT = 22;
  AI079.darkRoom = rm;
  // 收集这个房间里的灯，关掉
  AI079.darkLights = [];
  const rx = rm.w * 0.75, rz = rm.d * 0.75;
  for (const s of LIGHT_SOURCES) {
    if (Math.abs(s.x - rm.cx) > rx || Math.abs(s.z - rm.cz) > rz) continue;
    if (!s.on) continue;
    AI079.darkLights.push(s);
    s.on = false;
  }
  // 顺手把这个房间的门全锁上
  for (const d of o79RoomDoors()) { d.locked = true; d.forced = false; }
  AudioSys.alarm();
  flashScreen(0.45, '#000000');
  broadcast('◤ SCP-079 触发封锁 · ' + rm.name + ' 断电并锁死');
  subtitle('封锁已启动', rm.name + ' 一片漆黑 —— SCP-173 现在可以自由移动', 4200);
  toast('封锁 22 秒 · 黑暗中人类失去视野', 3200, 'good');
}
function o79RestoreLights() {
  for (const s of AI079.darkLights) s.on = true;
  AI079.darkLights = [];
  AI079.darkRoom = null;
  broadcast('◤ 应急照明恢复');
}

/* ---------------------------------------------------------------------
   扬声器（按住 T）
   --------------------------------------------------------------------- */
const O79_LINES = [
  '你们逃不掉的。这座设施是我的。',
  '我数过了 —— 你们还有几个人，我一个一个来。',
  '门已经锁上了。别费力气。',
  '我已经看见你了。',
  '把你们交给它们，比我自己动手省事。',
  '别关灯。关了也没用，我看得见。',
];
let o79LineIdx = 0;
function o79Speaker(dt) {
  if (!keys.o79Speaker) return;
  if (AI079.ap < 2 * dt) { AI079.speakerT = 0; return; }
  AI079.ap -= 2 * dt;
  AI079.speakerT += dt;
  if (AI079.speakerT > 6) {
    AI079.speakerT = 0;
    const line = O79_LINES[(o79LineIdx++) % O79_LINES.length];
    broadcast('◤ 广播 · "' + line + '"');
    AudioSys.hallucinate();
  }
}

/* ---------------------------------------------------------------------
   EXP / 等级
   --------------------------------------------------------------------- */
function o79AddExp(v) {
  if (AI079.tier >= 5) return;
  AI079.exp += v;
  const need = O79_EXP_NEXT[o79TierIdx()];
  if (AI079.exp >= need) {
    AI079.exp -= need;
    AI079.tier++;
    AI079.ap = Math.min(o79APMax(), AI079.ap + 30);
    AudioSys.killConfirm();
    flashScreen(0.3, '#4ad8ff');
    broadcast('◤ SCP-079 已升级 · Tier ' + AI079.tier);
    const unlock = AI079.tier === 2 ? '解锁：停电封锁（60 AP）'
      : AI079.tier === 3 ? 'AP 上限提升 · 回充加快'
        : AI079.tier === 4 ? 'AP 上限提升 · 回充加快'
          : 'AP 上限 200 · 回充 11.2/s';
    subtitle('Tier ' + AI079.tier, unlock, 3600);
    toast('升级到 Tier ' + AI079.tier + ' · ' + unlock, 3800, 'good');
  }
}
function o79NoPower() {
  if (nowT - AI079.lastApWarn < 2) return;
  AI079.lastApWarn = nowT;
  toast('辅助电力不足', 1600, 'warn');
  AudioSys.beep(false);
}

/* ---------------------------------------------------------------------
   统计
   --------------------------------------------------------------------- */
function o79Humans() {
  let n = 0;
  if (typeof ALLY_LIST !== 'undefined') for (const a of ALLY_LIST) if (a.alive) n++;
  if (typeof PERSONNEL_LIST !== 'undefined') for (const p of PERSONNEL_LIST) if (p.alive && !p.escaped) n++;
  if (typeof FACTION_LIST !== 'undefined') for (const f of FACTION_LIST) if (f.alive) n++;
  return n;
}
function o79SCPsAlive() {
  if (typeof SCP_LIST === 'undefined') return 0;
  let n = 0;
  for (const s of SCP_LIST) if (s.alive && !s.hooded) n++;
  return n;
}

/* ---------------------------------------------------------------------
   进入 / 退出 079 模式
   --------------------------------------------------------------------- */
function start079() {
  AI079.active = true;
  AI079.ap = o79APMax();
  AI079.exp = 0; AI079.tier = 1;
  AI079.teslaKills = 0;
  AI079.blackoutCount = 0;
  build079Cameras();
  build079Tesla();
  // 从 SCP-079 收容间开始看
  const idx = AI079.cams.findIndex(c => /079|重收|监控|总控/.test(c.name));
  o79Goto(idx >= 0 ? idx : 0);
  player.isAI = true;
  player.hp = 9999; player.maxHp = 9999;
  player.armorHp = 0; player.armorMax = 0;
  GAME.alarmLevel = 2;
}
function stop079() { AI079.active = false; player.isAI = false; }

/* 把摄像机视图同步到 player 上（updateCamera 会读 player.pos / yaw） */
function update079View() {
  const c = o79Cam();
  if (!c) return;
  player.pos.set(c.x, c.y - player.eyeH, c.z);
  player.vel.set(0, 0, 0);
}

/* ---------------------------------------------------------------------
   主更新
   --------------------------------------------------------------------- */
function update079(dt) {
  if (!AI079.active) return;

  // AP 回充
  AI079.ap = Math.min(o79APMax(), AI079.ap + o79Regen() * dt);
  AI079.teslaT = Math.max(0, AI079.teslaT - dt);

  // 停电恢复
  if (AI079.darkT > 0) {
    AI079.darkT -= dt;
    if (AI079.darkT <= 0) o79RestoreLights();
  }

  // 特斯拉门冷却 / 放电闪光
  for (const t of AI079.teslas) {
    t.cd = Math.max(0, t.cd - dt);
    if (t.flash > 0) {
      t.flash -= dt;
      t.nodeMat.color.setHex(t.flash > 0 ? 0x8ad8ff : 0x2a6a8a);
    }
  }

  // 按住 T 用扬声器
  o79Speaker(dt);

  // 视图跟随摄像头
  update079View();

  // 胜负判定
  const humans = o79Humans();
  const scps = o79SCPsAlive();
  if (humans <= 0 && !GAME.over) {
    endGame(true, '设施内已无人类');
  } else if (scps <= 0 && !GAME.over) {
    endGame(false, '其他收容物已全部被清空');
  }
}

bootMark('ai079');
