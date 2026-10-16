'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  15 主循环 / 任务链 / 启动
   ===================================================================== */

/* ---------------------------------------------------------------------
   任务状态
   --------------------------------------------------------------------- */
function objectiveStatus() {
  const st = {};
  const left = PHOTOS.filter(p => !p.done).length;
  const total = PHOTOS.length;
  st._photosLeft = left; st._photosTotal = total;
  // 净化行动（市区）：关掉三处感染源 → 清空全部被感染者 → 撤离
  if (GAME.mission === 'city') {
    const srcLeft = FAC.breakers.filter(b => !b.done).length;
    const infLeft = (typeof infectedLeft === 'function') ? infectedLeft() : 0;
    const clear = srcLeft <= 0 && infLeft <= 0;
    st.source = srcLeft <= 0 ? 'done' : 'active';
    st.purge_infected = clear ? 'done' : 'active';
    st.extract = clear ? 'active' : 'pending';
    st._sourcesLeft = srcLeft;
    st._infectedLeft = infLeft;
    st._infectedSpawned = GAME.cityState.spawned;
    return st;
  }
  if (GAME.mission === 'contain096') {
    const s = (typeof SCP_LIST !== 'undefined') ? SCP_LIST.find(v => v.key === '096') : null;
    const hooded = !!(s && s.hooded);
    st.find = GAME.saw096 ? 'done' : 'active';
    st.hood = hooded ? 'done' : (GAME.saw096 ? 'active' : 'pending');
    st.photos = hooded ? (left === 0 ? 'done' : 'active') : 'pending';
    st.extract = (hooded && left === 0) ? 'active' : 'pending';
    return st;
  }
  const bn = (GAME.breakers.A ? 1 : 0) + (GAME.breakers.B ? 1 : 0) + (GAME.breakers.C ? 1 : 0);
  // 5K 行动：唯一目标是让 SCP-1440 在站点停留满 5 分钟（300 秒）
  if (GAME.mission === 'fivek') {
    st.power = 'pending'; st.protocol = 'pending'; st.photos = 'pending';
    st.purge = 'pending'; st.invaders = 'pending'; st.extract = 'pending';
    // 反叛之狐：处决 1440 + 清除 Nu-22
    if (roleView().id === 'rebel') {
      const ex = (typeof S1440 !== 'undefined') && S1440.executed;
      const nu = (typeof nu22Alive === 'function') ? nu22Alive() : 0;
      st.kill1440 = ex ? 'done' : 'active';
      st.killNu22 = nu <= 0 ? 'done' : 'active';
      st._nu22Left = nu;
      return st;
    }
    // 蛇之手（异常重生来的）：5K 没有撤离点，目标就是把基金会的人清空
    if (roleView().id === 'hand') {
      const fl = (typeof foundationLeft === 'function') ? foundationLeft() : 0;
      st.hunt = fl <= 0 ? 'done' : 'active';
      st._foundationLeft = fl;
      return st;
    }
    const t = (typeof S1440 !== 'undefined') ? S1440.holdT : 0;
    const need = (typeof S1440 !== 'undefined') ? S1440.holdNeed : 60;
    st.hold = t >= need ? 'done' : 'active';
    st.survive = 'active';
    st._holdT = t; st._holdNeed = need;
    st._curseKills = (typeof S1440 !== 'undefined') ? S1440.curseKills : 0;
    return st;
  }
  // SCP 阵营（079 / 附身收容物）：自己的目标链，跟人类那套完全无关
  if (isScpRole()) {    const humans = (typeof o79Humans === 'function') ? o79Humans() : 0;
    const scps = (typeof o79SCPsAlive === 'function') ? o79SCPsAlive() : 0;
    st.power = 'pending'; st.protocol = 'pending'; st.photos = 'pending';
    st.purge = 'pending'; st.invaders = 'pending'; st.extract = 'pending';
    st.ai_kill = humans <= 0 ? 'done' : 'active';
    st.ai_survive = scps > 0 ? 'active' : 'done';
    st._humans = humans; st._scps = scps;
    return st;
  }
  st.power = bn >= 3 ? 'done' : 'active';
  st.protocol = GAME.protocol ? 'done' : (bn >= 3 ? 'active' : 'pending');
  // 档案销毁与清剿并行：协议上传后就可以开始清理照片
  st.photos = left === 0 ? 'done' : (GAME.protocol ? 'active' : 'pending');
  const doneN = Object.keys(GAME.contained).length;
  st.purge = (GAME.protocol && doneN >= SCP_ORDER.length) ? 'done' : (GAME.protocol ? 'active' : 'pending');
  // 入侵势力：未部署前 pending，部署后只要还有活人就 active
  const deployed = (typeof factionsDeployed === 'function') && factionsDeployed();
  const invadersLeft = (typeof FACTION_LIST !== 'undefined') ? FACTION_LIST.filter(a => a.alive).length : 0;
  st.invaders = !deployed ? 'pending' : (invadersLeft > 0 ? 'active' : 'done');
  st._invadersLeft = invadersLeft;
  // CI 玩家的目标：清除设施内的基金会人员
  st.hunt = (typeof foundationLeft === 'function' && foundationLeft() <= 0) ? 'done' : 'active';
  st._foundationLeft = (typeof foundationLeft === 'function') ? foundationLeft() : 0;
  // 撤离条件按角色走：不是每个人都有资格打完收容战
  const role = currentRole();
  if (role.id === 'ci' || role.id === 'hand') st.extract = st.hunt === 'done' ? 'active' : 'pending';
  else if (role.id === 'classd') st.extract = 'active';                 // 活着走到电梯就行
  else if (role.id === 'scientist') st.extract = left === 0 ? 'active' : 'pending';
  else if (role.id === 'guard') st.extract = (bn >= 3 && GAME.protocol) ? 'active' : 'pending';
  else st.extract = (st.purge === 'done' && left === 0 && st.invaders !== 'active') ? 'active' : 'pending';
  return st;
}

/* 撤离点是否已解锁（按角色判定） */
function extractReady() {
  // 净化行动：感染源全关 + 场上没有活着的被感染者，直升机才起飞
  if (GAME.mission === 'city') {
    return FAC.breakers.every(b => b.done)
      && (typeof infectedLeft === 'function') && infectedLeft() <= 0;
  }
  if (GAME.mission === 'contain096') {
    const s = SCP_LIST.find(v => v.key === '096');
    const left = PHOTOS.filter(p => !p.done).length;
    return !!(s && s.hooded) && left === 0;
  }
  const role = currentRole();
  if (GAME.mission === 'fivek') return false;                  // 5K 行动没有撤离这回事
  if (role.side === 'scp') return false;                       // 收容物不撤离
  const left = PHOTOS.filter(p => !p.done).length;
  const bn = (GAME.breakers.A ? 1 : 0) + (GAME.breakers.B ? 1 : 0) + (GAME.breakers.C ? 1 : 0);
  if (role.id === 'ci' || role.id === 'hand') return (typeof foundationLeft === 'function') && foundationLeft() <= 0;
  if (role.id === 'classd') return true;                       // D 级：只要能活着走到电梯
  if (role.id === 'scientist') return left === 0;              // 研究员：销毁档案后撤离
  if (role.id === 'guard') return bn >= 3 && GAME.protocol;    // 保安：供电 + 协议
  const invadersAlive = (typeof FACTION_LIST !== 'undefined') && FACTION_LIST.some(a => a.alive);
  return GAME.protocol && Object.keys(GAME.contained).length >= SCP_ORDER.length
    && left === 0
    && !invadersAlive;
}

/* ---------- SCP-096：戴上收容头套（两个行动通用）----------
   它免疫一切伤害，戴头套是唯一的收容方式；落锤行动里戴上即计入清剿进度。 */
function hoodSCP096() {
  const s = SCP_LIST.find(v => v.key === '096');
  if (!s || s.hooded) return;
  s.hooded = true;
  s.enraged = false;
  s.rageT = 0;
  s.enrageT = 0;
  s.target = null;
  s.state = 'contained';
  if (s.model.hood) s.model.hood.visible = true;
  if (s.model.scrambleQuad) s.model.scrambleQuad.visible = false;
  AudioSys.beep(true);
  AudioSys.killConfirm();
  GAME.alarmLevel = 1;
  if (GAME.mission === 'contain096') {
    broadcast('◤ SCP-096 收容头套已就位 · 目标失去视觉');
    subtitle('收容头套已戴上', 'SCP-096 再也看不见了 —— 它不会再暴走', 4400);
    toast('目标已失能 · 下一步：销毁现场全部照片', 4000, 'good');
    killfeed('SCP-096 已收容', 'good');
  } else {
    // 落锤行动：戴头套即完成收容，计入清剿进度（不算击杀）
    GAME.contained['096'] = true;
    const doneN = Object.keys(GAME.contained).length;
    broadcast('◤ SCP-096 已收容 · 头套就位 · 目标失去视觉');
    subtitle('SCP-096 已收容', '它再也看不见了 —— 设施里还有别的收容物', 4400);
    toast('SCP-096 收容完成（' + doneN + ' / ' + SCP_ORDER.length + '）', 4200, 'good');
    onSCPKilled(s);
  }
}

/* ---------- 收容行动：划掉一张照片 ---------- */
function destroyPhoto(p) {
  if (!p || p.done) return;
  p.done = true;
  p.viewT = 0;
  p.cross.visible = true;
  p.cross.scale.setScalar(0.4);
  p.photo.material = p.photo.material.clone();
  p.photo.material.color.setHex(0x6a6154);
  // 划掉动画（用一个短促的缩放补间代替）
  let k = 0;
  const grow = () => {
    k += 0.14;
    const s = Math.min(1, k);
    p.cross.scale.setScalar(0.4 + 0.6 * s);
    if (s < 1) requestAnimationFrame(grow);
  };
  requestAnimationFrame(grow);
  AudioSys.reload('magin');
  const left = PHOTOS.filter(q => !q.done).length;
  toast('已划掉照片「' + p.where + '」（剩余 ' + left + ' 张）', 2400, 'good');
  if (left === 0) {
    GAME.alarmLevel = 1;
    if (GAME.mission === 'contain096') {
      broadcast('◤ 现场全部影像资料已销毁 · 前往公路撤离点登机');
      subtitle('照片已全部销毁', '回到公路上的直升机撤离点', 4200);
    } else {
      broadcast('◤ 收容档案已全部销毁 · 剩余的只有清剿任务');
      subtitle('泄漏档案已清零', '继续清剿设施内的收容物', 4200);
    }
  }
}

function onBreakerDone(obj) {
  GAME.breakers[obj.id] = true;
  const n = (GAME.breakers.A ? 1 : 0) + (GAME.breakers.B ? 1 : 0) + (GAME.breakers.C ? 1 : 0);
  toast('断路器 ' + obj.id + ' 已合闸（' + n + ' / 3）', 2200, 'good');
  killfeed('PWR-' + obj.id + ' 已恢复', 'good');
  AudioSys.beep(true);
  if (n >= 3) {
    GAME.powerOn = true;
    GAME.alarmLevel = 1;
    broadcast('◤ 主供电恢复 · 前往办公区「设施总控室」上传收容协议');
    subtitle('供电已恢复', '下一步：在办公区设施总控室上传收容协议', 3400);
  } else {
    broadcast('◤ 配电箱 ' + obj.id + ' 已恢复 · 剩余 ' + (3 - n) + ' 处');
  }
}

/* 核弹开关：EMP 脉冲，全场 SCP 僵直 */
function onNukeEMP() {
  broadcast('◤ 核弹装置已触发 · EMP 脉冲释放 · 全场收容物僵直 14 秒');
  subtitle('E M P  脉 冲', '电磁脉冲使所有收容物陷入僵直', 3800);
  flashScreen(0.5, '#8adfff');
  AudioSys.alarm();
  addTrauma(0.7);
  let n = 0;
  for (const s of SCP_LIST) {
    if (!s.alive) continue;
    s.stunT = Math.max(s.stunT || 0, 14);
    s.atkCd = Math.max(s.atkCd, 2.5);
    s.awake = true;
    n++;
  }
  toast('EMP 冲击 · ' + n + ' 只收容物僵直', 3200, 'good');
}

function onProtocolDone() {
  if (GAME.protocol) return;
  GAME.protocol = true;
  GAME.alarmLevel = 2;
  broadcast('◤ 收容协议已上传 · HID 装置充能完毕 · 对 SCP 伤害 ×2');
  subtitle('收容协议已上线', 'HID 收容装置充能完毕 —— 现在你有机会了', 4000);
  AudioSys.alarm();
  flashScreen(0.25, '#4ad8a0');
  // 协议上线：所有 SCP 被惊动
  for (const s of SCP_LIST) { if (s.alive) s.active = true; }
  // 情报组追加任务：清理 SCP-096 的面部影像档案
  const left = PHOTOS.filter(p => !p.done).length;
  if (left > 0) {
    setTimeout(() => {
      broadcast(BROADCASTS.archive, 6200);
      subtitle('追加任务 · 销毁收容档案', '设施内还有 ' + left + ' 份 SCP-096 面部影像待销毁', 4600);
      toast('⚠ 盯着档案照片看超过 3 秒，会把 SCP-096「看」暴走', 5200, 'warn');
    }, 3600);
  }
}

function onSCPKilled(s) {
  killfeed(s.name + (s.hooded ? ' 已收容 · 头套就位' : ' 已停止活动'), 'good');
  const doneN = Object.keys(GAME.contained).length;
  if (doneN >= SCP_ORDER.length) {
    GAME.alarmLevel = 1;
    broadcast('◤ 全部收容物已处理完毕 · 前往入口大厅撤离');
    subtitle('设施已清理', '前往入口大厅的撤离电梯', 4000);
  } else {
    broadcast('◤ 收容进度 ' + doneN + ' / ' + SCP_ORDER.length);
  }
}

/* ---------- 撤离后的第二身份（类似 RXSEND / SL 的阵营重部署）----------
   Class-D 撤离 → 以混沌分裂者回来
   科学家撤离 → 以 Nu-7 收容专家回来
   保安撤离   → 以 Nu-7 突击兵回来
   只有第一次撤离会触发；第二身份再撤离才是真正的通关。 */
function startSecondLife(roleId) {
  const r = ROLE_DEFS[roleId];
  if (!r) { endGame(true, '成功撤离'); return; }
  GAME.role = roleId;
  GAME.secondLife = true;
  // 保留战绩，只换身份与装备
  const keep = {
    kills: player.kills, shots: player.shots, hits: player.hits,
    headshots: player.headshots, dmgDealt: player.dmgDealt, dmgTaken: player.dmgTaken,
  };
  player.init();
  Object.assign(player, keep);
  player.isAI = false;
  const rm = FAC.roomAt[r.spawn] || FAC.roomAt['EZ-LOBBY'] || { cx: FAC.spawn.x, cz: FAC.spawn.z };
  player.pos.set(rm.cx + 2.5, 0, rm.cz + 2.5);
  player.yaw = FAC.spawn.yaw;
  const gd = GEAR_DEFS[effectiveLoadout().gear] || GEAR_DEFS.none;
  NVG.battery = gd.battery || 0; NVG.on = false; NVG.apply();
  GAME.extractCd = 6;                       // 刚落地别又被电梯吸走
  GAME.alarmLevel = 2;
  AudioSys.playMusic(r.side === 'ci' ? 'audio/ci-entry.mp3' : 'audio/breach-entry.mp3', 0.45, false);
  AudioSys.alarm();
  flashScreen(0.5, r.side === 'ci' ? '#8a2a22' : '#4ad8a0');
  broadcast('◤ 撤离完成 · 你被重新部署了 —— 你是 ' + r.name);
  subtitle('你是 ' + r.name, r.goal, 6400);
  toast('新身份 · ' + r.faction + ' · 目标：' + r.goal, 6200, 'good');
  killfeed('重新部署 · ' + r.name, r.side === 'ci' ? 'bad' : 'good');
}

/* ---------- 重生：倒下就重新部署（保留当前进度）----------
   ⚠️ 复活是**无限次**的 —— 玩家想收尾只能主动「放弃行动」（走 skipRebirth）。
   身份映射表在 01_data.js 的 REBIRTH / REBIRTH_FIVEK。 */
function tryRebirth(reason) {
  const next = (typeof rebirthRoleFor === 'function') ? rebirthRoleFor() : null;
  if (!next) return false;
  return rebirthPlayer(next, reason);
}

function rebirthPlayer(roleId, cause) {
  const r = ROLE_DEFS[roleId];
  if (!r) return false;

  // 1) 先把"收容物身份"那套状态摘干净（079 的 isAI / 附身实体的 isSCP）
  if (typeof stopPlayableSCP === 'function') stopPlayableSCP();
  if (typeof stop079 === 'function') stop079();
  player.isAI = false; player.isSCP = false;
  player.grabbedBy = null; player.grabT = 0; player.bleeding = 0;

  // 2) 换身份。GAME 里的进度（elapsed / 目标状态 / 收容记录 / 护送加成）一律不动，
  //    只有战绩统计挂在 player 身上，得手动搬过去。
  const keep = {
    kills: player.kills, shots: player.shots, hits: player.hits,
    headshots: player.headshots, dmgDealt: player.dmgDealt, dmgTaken: player.dmgTaken,
  };
  GAME.role = roleId;
  GAME.rebirthUsed = true;
  GAME.rebirthCount = (GAME.rebirthCount || 0) + 1;   // 复活无限次，这个只用于结算显示
  GAME.secondLife = true;        // 重生之后再撤离，就是真正的通关
  player.init();
  Object.assign(player, keep);
  player.isAI = false; player.isSCP = false;
  player.eyeH = EYE_STAND; player.eyeHCur = EYE_STAND;   // 附身时被改过
  player.alive = true;
  player.hp = player.maxHp;
  player.armorHp = player.armorMax;

  // 3) 落位到新身份的出生点
  //    ⚠️ 5K 里蛇之手别和 Nu-22 挤在同一个入口 —— 一落地就会被集火
  const spawnKey = (GAME.mission === 'fivek' && r.id === 'hand') ? 'EZ-SEC' : r.spawn;
  const rm = (FAC.roomAt && (FAC.roomAt[spawnKey] || FAC.roomAt['EZ-LOBBY']))
    || { cx: FAC.spawn.x, cz: FAC.spawn.z };
  player.pos.set(rm.cx + 2.5, 0, rm.cz + 2.5);
  player.yaw = FAC.spawn.yaw; player.pitch = 0;
  const gd = GEAR_DEFS[effectiveLoadout().gear] || GEAR_DEFS.none;
  NVG.battery = gd.battery || 0; NVG.on = false; NVG.apply();

  // 4) 复位：别刚落地又被电梯吸走
  //    ⚠️ 重生是"重新部署"，不是"开局突入" —— 必须把待命屏关掉。
  //       反叛之狐在 5K 里开局要等 60 秒，重生时绝不能再被塞回去等一次。
  GAME.staging.active = false; GAME.staging.t = 0;
  const _ss = el('stagingScreen'); if (_ss) _ss.classList.add('hidden');
  GAME.extractCd = 8;
  // ⚠️ 重新部署的无敌时间 —— 不然刚落地就被守在出生点附近的收容物（尤其 096）秒掉，
  //    那就变成了"复活即死"的死循环。
  GAME.spawnProtectT = 4.0;
  GAME.alarmLevel = 2;
  GAME.over = false; GAME.won = false; GAME.phase = 'playing';
  dmgFlash = 0;

  // 5) 入场表现：音乐按阵营换
  const hostile = r.side === 'ci' || r.side === 'hand';
  const music = (r.id === 'rebel') ? 'audio/rebel-entry.mp3'
    : (hostile ? 'audio/ci-entry.mp3' : 'audio/breach-entry.mp3');
  AudioSys.playMusic(music, 0.45, false);
  AudioSys.alarm();
  flashScreen(0.6, hostile ? '#8a2a22' : '#4ad8a0');
  broadcast('◤ 重新部署 · 你是 ' + r.name);
  subtitle('你是 ' + r.name, r.goal, 7000);
  toast('倒下一次而已 · 新身份 ' + r.faction + ' · 目标：' + r.goal, 7000, 'good');
  killfeed('重新部署 · ' + r.name + (cause ? '（死于 ' + cause + '）' : ''), hostile ? 'bad' : 'good');
  requestLock();
  return true;
}

function onExtractionDone() {
  if (GAME.over) return;
  if (GAME.extractCd > 0) return;                       // 刚重新部署，别立刻又撤一次
  const next = SECOND_LIFE[currentRole().id];
  if (next && !GAME.secondLife) { startSecondLife(next); return; }
  endGame(true, '成功撤离');
}

function onPlayerDeath(attacker, o) {
  if (GAME.over) return;
  const cause = o && o.cause ? o.cause : (attacker ? (attacker.name || '未知收容物') : '未知原因');
  killfeed('你被 ' + cause + ' 击倒', 'bad');
  AudioSys.stopAmbient();
  // 无限复活：倒下只是重新部署，给个过渡提示 —— 否则玩家会以为这局已经结束了
  broadcast('◤ 你倒下了 —— 但这不是终点');
  subtitle('你倒下了', '正在重新部署…', 2600);
  setTimeout(() => { endGame(false, cause); }, 2200);
}

/* ---------- 反叛之狐的延迟部署 ----------
   O5 的净化令先到，Nu-22 先突入；反叛之狐晚一分钟才到。
   待命期间玩家不能动、不能开枪，也不会被打到 —— 只是看着计时走完。 */
function endStaging() {
  if (!GAME.staging.active) return;
  GAME.staging.active = false;
  const ss = el('stagingScreen');
  if (ss) ss.classList.add('hidden');
  requestLock();
  AudioSys.playMusic('audio/rebel-entry.mp3', 0.5, false);
  AudioSys.alarm();
  flashScreen(0.55, '#4a7a3a');
  broadcast('◤ 反叛之狐已突入设施 · Nu-22 的净化程序由我们中止', 7000);
  subtitle('反叛之狐 · 突入', '处决 SCP-1440，清除 Nu-22', 6400);
  toast('⚠ 与保安、科学家同阵营 · Nu-22 是你的目标', 6000, 'warn');
  killfeed('反叛之狐 · 入场', 'good');
}
function updateStaging(dt) {
  if (!GAME.staging.active) return;
  GAME.staging.t -= dt;
  const ss = el('stagingScreen');
  if (ss && ss.classList.contains('hidden')) ss.classList.remove('hidden');
  const n = el('stagingN');
  const v = String(Math.max(0, Math.ceil(GAME.staging.t)));
  if (n && n.textContent !== v) n.textContent = v;
  if (GAME.staging.t <= 0) endStaging();
}

/* ---------------------------------------------------------------------
   结束
   --------------------------------------------------------------------- */
function endGame(won, reason, skipRebirth) {
  if (GAME.over) return;
  // ⚠️ 失败时先重新部署 —— 复活是**无限次**的，每个身份倒下都会重来。
  //    检查放在这里而不是 onPlayerDeath，是为了让所有失败路径
  //    （被击倒 / 附身的收容物被压制 / 079 被重新收容 / 5K 失败）统一走同一条重生逻辑。
  //    skipRebirth：只有「主动放弃行动」这种明确的收尾才跳过 ——
  //    否则玩家会被无限复活卡住，永远退不出这一局。
  if (!won && !skipRebirth && typeof tryRebirth === 'function' && tryRebirth(reason)) return;
  GAME.over = true;
  GAME.won = won;
  GAME.phase = 'over';
  exitLock();
  hide('pauseOverlay');
  AudioSys.stopAmbient();
  AudioSys.stopAlarm();       // 行动结束 → 警报停
  AudioSys.stopMusic(2.0);    // 入场曲淡出
  const t = el('endTitle');
  const rr0 = roleView();
  const isAI = !!rr0.ai;
  const isScp = rr0.side === 'scp';
  const is5K = GAME.mission === 'fivek';
  const isRebel = is5K && rr0.id === 'rebel';
  t.textContent = isScp
    ? (won ? '设 施 已 清 空' : '重 新 收 容')
    : is5K
      ? (won ? (isRebel ? '净 化 已 中 断' : '净 化 完 成') : '行 动 失 败')
      : (won ? (GAME.mission === 'contain096' ? '收 容 完 成'
        : (GAME.mission === 'city' ? '疫 区 已 清 空' : '行 动 成 功')) : '行 动 失 败');
  t.className = won ? '' : 'fail';
  if (GAME.mission !== 'contain096') {
    const rn = el('endRole');
    if (rn) { rn.textContent = '身份 · ' + rr0.name + '（' + rr0.faction + '）'; rn.style.display = ''; }
  }
  // 结算副标题也跟着身份走 —— 别再一律写 MTF Nu-7
  txt('endSub', isScp
    ? (won ? rr0.name + ' · 设施内已无人类存活' : rr0.name + ' · 你被重新收容了')
    : is5K
      ? (isRebel
        ? (won ? 'SCP-1440 已被处决 · Nu-22 已清除' : '原因：' + reason)
        : (won ? 'SCP-1440 在站点停留满 5 分钟 · 净化程序完成' : '原因：' + reason))
      : (won
        ? (GAME.mission === 'contain096' ? 'SCP-096 已收容 · 现场影像已销毁'
          : (GAME.mission === 'city' ? '感染源已关闭 · 被感染者已全部清除' : rr0.name + ' · 行动完成'))
        : '原因：' + reason));
  const acc = player.shots ? Math.round(player.hits / player.shots * 100) : 0;
  const hs = player.hits ? Math.round(player.headshots / player.hits * 100) : 0;
  let s = '';
  const row = (k, v) => '<div class="stRow"><span>' + k + '</span><b>' + v + '</b></div>';
  let grade;
  if (isAI) {
    s += row('身份', 'SCP-079 · 旧 AI');
    s += row('等级', 'Tier ' + AI079.tier);
    s += row('特斯拉门击杀', AI079.teslaKills);
    s += row('触发封锁', AI079.blackoutCount + ' 次');
    s += row('剩余人类', o79Humans());
    s += row('剩余收容物', o79SCPsAlive());
    s += row('行动时间', Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒');
    grade = won ? (AI079.teslaKills >= 2 ? 'S' : 'A') : 'F';
    s += row('评级', grade);
  } else if (is5K) {
    const t40 = (typeof S1440 !== 'undefined') ? S1440 : null;
    s += row('身份', rr0.name);
    if (isRebel) {
      s += row('处决 SCP-1440', t40 && t40.executed ? '已完成' : '未完成');
      s += row('剩余 Nu-22', (typeof nu22Alive === 'function') ? nu22Alive() : 0);
    } else {
      s += row('滞留进度', Math.floor(t40 ? t40.holdT : 0) + ' / ' + (t40 ? t40.holdNeed : 60) + ' 秒');
      s += row('1440 清理人数', t40 ? t40.curseKills : 0);
    }
    s += row('击杀', player.kills);
    s += row('命中率', acc + '%（' + player.hits + ' / ' + player.shots + '）');
    s += row('造成伤害', Math.round(player.dmgDealt));
    s += row('承受伤害', Math.round(player.dmgTaken));
    s += row('剩余生命', Math.ceil(Math.max(0, player.hp)) + ' / ' + player.maxHp);
    s += row('行动时间', Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒');
    grade = won ? (player.dmgTaken < 80 ? 'S' : 'A') : 'F';
    s += row('评级', grade);
  } else if (rr0.playable) {
    // 附身收容物：没有枪、没有命中率，只有"吃掉了几个人"
    s += row('身份', rr0.name + ' · ' + rr0.faction);
    s += row('击杀', (typeof PSCP !== 'undefined' && PSCP.active) ? PSCP.kills : 0);
    s += row('剩余人类', o79Humans());
    s += row('剩余收容物', o79SCPsAlive());
    s += row('行动时间', Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒');
    grade = won ? 'S' : 'F';
    s += row('评级', grade);
  } else if (GAME.mission === 'city') {
    const srcDone = FAC.breakers.filter(b => b.done).length;
    s += row('行动', '净化行动 · 市区疫区');
    s += row('关闭感染源', srcDone + ' / ' + FAC.breakers.length);
    s += row('清除被感染者', player.kills);
    s += row('命中率', acc + '%（' + player.hits + ' / ' + player.shots + '）');
    s += row('造成伤害', Math.round(player.dmgDealt));
    s += row('承受伤害', Math.round(player.dmgTaken));
    s += row('剩余生命', Math.ceil(Math.max(0, player.hp)) + ' / ' + player.maxHp);
    s += row('行动时间', Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒');
    grade = won ? (player.dmgTaken < 140 ? 'S' : 'A') : 'F';
    s += row('评级', grade);
  } else if (GAME.mission === 'contain096') {
    const s96 = SCP_LIST.find(v => v.key === '096');
    const doneP = PHOTOS.filter(p => p.done).length;
    s += row('行动', '收容行动 · SCP-096');
    s += row('SCP-096 收容', s96 && s96.hooded ? '已完成 · 头套就位' : '未完成');
    s += row('照片销毁', doneP + ' / ' + PHOTOS.length);
    s += row('击杀', player.kills);
    s += row('命中率', acc + '%（' + player.hits + ' / ' + player.shots + '）');
    s += row('造成伤害', Math.round(player.dmgDealt));
    s += row('承受伤害', Math.round(player.dmgTaken));
    s += row('剩余生命', Math.ceil(Math.max(0, player.hp)) + ' / ' + player.maxHp);
    s += row('行动时间', Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒');
    grade = won ? ((s96 && s96.hooded) && doneP >= PHOTOS.length ? 'S' : 'A') : 'F';
    s += row('评级', grade);
  } else {
    const role = currentRole();
    const total = SCP_ORDER.length;
    const done = Object.keys(GAME.contained).length;
    const doneP = PHOTOS.filter(p => p.done).length;
    const bn = (GAME.breakers.A ? 1 : 0) + (GAME.breakers.B ? 1 : 0) + (GAME.breakers.C ? 1 : 0);
    const fl = (typeof foundationLeft === 'function') ? foundationLeft() : 0;

    // ⚠️ 目标进度必须按身份走 —— 混沌分裂者不关心"收容进度"，
    //    Class-D 也不关心"档案销毁"。旧版一律套 MTF 那一套，等于给错人发成绩单。
    s += row('身份', role.name);
    if (role.id === 'mtf') {
      s += row('收容进度', done + ' / ' + total);
      if (PHOTOS.length) s += row('档案销毁', doneP + ' / ' + PHOTOS.length);
      s += row('设施供电', bn + ' / 3');
      s += row('收容协议', GAME.protocol ? '已上传' : '未上传');
    } else if (role.id === 'guard') {
      s += row('设施供电', bn + ' / 3');
      s += row('收容协议', GAME.protocol ? '已上传' : '未上传');
    } else if (role.id === 'scientist') {
      s += row('档案销毁', doneP + ' / ' + PHOTOS.length);
    } else if (role.id === 'classd') {
      s += row('目标', '活着走到地表电梯');
    } else if (role.side === 'ci') {
      s += row('清除基金会人员', fl <= 0 ? '已完成' : '还剩 ' + fl + ' 人');
      s += row('设施内收容物', done + ' / ' + total);
    } else {
      // 第二身份（Nu-7 收容专家 / 突击兵）
      s += row('收容进度', done + ' / ' + total);
      if (PHOTOS.length) s += row('档案销毁', doneP + ' / ' + PHOTOS.length);
    }

    if (typeof FACTION_STATE !== 'undefined' && (FACTION_STATE.ciSpawned || FACTION_STATE.handSpawned)) {
      s += row('入侵势力击破', '混沌分裂者 ' + FACTION_KILLS.ci + ' · 蛇之手 ' + FACTION_KILLS.hand);
      s += row('被蛇之手放逐', FACTION_STATE.released + ' 次');
    }
    if (typeof PERSONNEL_LIST !== 'undefined' && (GAME.rescued.scientist || GAME.rescued.guard || GAME.classdEscaped)) {
      s += row('护送撤离', '科学家 ' + GAME.rescued.scientist + ' · 保安 ' + GAME.rescued.guard);
      if (GAME.classdEscaped) s += row('D 级人员逃脱', GAME.classdEscaped + ' 人');
      s += row('最终伤害加成', '异常 ×' + GAME.bonusAnomaly + ' · 敌对 ×' + GAME.bonusHostile);
    }
    s += row('击杀', player.kills);
    s += row('命中率', acc + '%（' + player.hits + ' / ' + player.shots + '）');
    s += row('其中爆头', hs + '%');
    s += row('造成伤害', Math.round(player.dmgDealt));
    s += row('承受伤害', Math.round(player.dmgTaken));
    s += row('剩余生命', Math.ceil(Math.max(0, player.hp)) + ' / ' + player.maxHp);
    s += row('行动时间', Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒');
    // 评级也按各自的目标算
    let good = false, mid = false;
    if (role.id === 'mtf') { good = done >= total && doneP >= PHOTOS.length; mid = done >= total - 2; }
    else if (role.id === 'guard') { good = bn >= 3 && GAME.protocol; mid = bn >= 2; }
    else if (role.id === 'scientist') { good = doneP >= PHOTOS.length; mid = doneP >= Math.max(1, PHOTOS.length - 2); }
    else if (role.id === 'classd') { good = won; mid = GAME.elapsed > 240; }
    else if (role.side === 'ci') { good = fl <= 0; mid = fl <= 2; }
    else { good = done >= total; mid = done >= total - 2; }
    grade = won ? (good ? 'S' : (mid ? 'A' : 'B')) : 'F';
    s += row('评级', grade);
  }
  html('endStats', s);
  show('endScreen');
  if (won) AudioSys.killConfirm(); else AudioSys.hurt();
}

/* ---------------------------------------------------------------------
   世界重置
   --------------------------------------------------------------------- */
function resetWorld() {
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const o = scene.children[i];
    if (o.userData && o.userData.persist) continue;
    scene.remove(o);
  }
  BOXES.length = 0; CYLS.length = 0; RAMPS.length = 0;
  LIGHT_SOURCES.length = 0;
  FAC.rooms.length = 0; FAC.roomAt = {}; FAC.doors.length = 0; FAC.lights.length = 0;
  FAC.breakers.length = 0; FAC.props.length = 0;
  FAC.terminal = null; FAC.extract = null;
  SCP_LIST.length = 0; ALLY_LIST.length = 0; MINIONS.length = 0; CORPSES.length = 0; PICKUPS.length = 0;
  if (typeof FACTION_LIST !== 'undefined') FACTION_LIST.length = 0;
  if (typeof FACTION_STATE !== 'undefined') {
    FACTION_STATE.ciSpawned = false; FACTION_STATE.handSpawned = false; FACTION_STATE.released = 0;
    FACTION_STATE.ciReinforceT = 0; FACTION_STATE.handReinforceT = 0;
    FACTION_STATE.ciWaves = 0; FACTION_STATE.handWaves = 0;
    FACTION_STATE.seq.ci = 5; FACTION_STATE.seq.hand = 3;
  }
  if (typeof FACTION_KILLS !== 'undefined') { FACTION_KILLS.ci = 0; FACTION_KILLS.hand = 0; }
  if (typeof PERSONNEL_LIST !== 'undefined') PERSONNEL_LIST.length = 0;
  GAME.bonusAnomaly = 1; GAME.bonusHostile = 1;
  GAME.rescued.scientist = 0; GAME.rescued.guard = 0; GAME.classdEscaped = 0;
  if (typeof FACTION_SCHEDULE !== 'undefined') { FACTION_SCHEDULE.ciAt = 300; FACTION_SCHEDULE.handAt = 360; }
  GAME.mtfDeployed = false;
  GAME.mtfReinforceT = 0;
  GAME.allySeq = 4;
  GAME.secondLife = false;
  GAME.rebirthUsed = false;
  GAME.rebirthCount = 0;
  GAME.extractCd = 0;
  GAME.spawnProtectT = 0;
  GAME.selfEvacTold = false;
  GAME.cityState.spreadT = 18; GAME.cityState.spawned = 0;
  if (typeof INFECTED !== 'undefined') {
    for (const m of INFECTED) if (m.group && m.group.parent) m.group.parent.remove(m.group);
    INFECTED.length = 0;
  }
  GAME.staging.active = false; GAME.staging.t = 0;
  const _ss = el('stagingScreen'); if (_ss) _ss.classList.add('hidden');
  if (typeof AI079 !== 'undefined') {
    AI079.active = false; AI079.cams.length = 0; AI079.teslas.length = 0;
    AI079.darkLights.length = 0; AI079.darkT = 0; AI079.darkRoom = null;
    AI079.ap = 100; AI079.exp = 0; AI079.tier = 1;
    AI079.lockT = 0; AI079.blackoutT = 0; AI079.teslaT = 0; AI079.speakerT = 0;
    AI079.teslaKills = 0;
    AI079.blackoutCount = 0;
  }
  if (typeof PSCP !== 'undefined') {
    PSCP.active = false; PSCP.ent = null; PSCP.def = null; PSCP.tune = null;
    PSCP.atkCd = 0; PSCP.kills = 0; PSCP.observed = false; PSCP.moving = false;
    PSCP.rageTold = false; PSCP.soundList.length = 0;
  }
  if (typeof stop1440 === 'function') stop1440();
  if (typeof clearFX === 'function') clearFX();
  NOISE_EVENTS.length = 0;
  PHOTOS.length = 0;            // 两个行动共用的照片列表
  GAME.saw096 = false;
  GAME.mission = GAME.mission || 'breach';
  NAV.ready = false; NAV.grid = null; NAV.hard = null;
  NAV_OPENINGS.length = 0;
  RGRID.boxCells = null; RGRID.cylCells = null;
  _heapN = 0;
  if (flashLayer) flashLayer.innerHTML = '';
  const kf = el('killfeed'); if (kf) kf.innerHTML = '';
  // 状态复位
  GAME.breakers = { A: false, B: false, C: false };
  GAME.protocol = false; GAME.powerOn = false; GAME.contained = {};
  GAME.alarmLevel = 0; GAME.elapsed = 0; GAME.kills = 0; GAME.shots = 0; GAME.hits = 0;
  GAME.headshots = 0; GAME.dmgTaken = 0; GAME.dmgDealt = 0;
  NVG.on = false; NVG.battery = 100; NVG.apply();
}

/* ---------------------------------------------------------------------
   开始一局
   --------------------------------------------------------------------- */
function startGame() {
  resetWorld();
  const farm = GAME.mission === 'contain096';
  const city = GAME.mission === 'city';
  const bar = el('bootBar'), bt = el('bootTxt');
  show('bootScreen');
  if (bt) bt.textContent = farm ? '正在构建加州农场…'
    : (city ? '正在构建市区疫区…' : '正在构建 Site-19 设施…');
  if (bar) bar.style.width = '35%';

  if (farm) buildFarm(); else if (city) buildCity(); else buildFacility();
  if (bar) bar.style.width = '62%';
  if (bt) bt.textContent = '正在部署 ' + roleView().name + '…';

  // MTF 火力组开局 1 分钟后才进场（设施里先只有你自己）；
  // 收容行动与 5K 行动是既定的特遣队任务，一开始就齐装满员。
  const fivek = GAME.mission === 'fivek';
  if (farm || fivek) spawnAllies(); else GAME.mtfDeployed = false;
  if (farm) spawnFarmSCPs();
  else if (city) {
    // 市区里没有设施收容物，只有被感染者。
    // ⚠️ 先 player.init() 定好出生点 —— infectedSpawnPos() 要读 player.pos 来"避开玩家"，
    //    不先落位的话会拿上一局的位置做判断，感染者可能直接刷在脸上。
    GAME.cityState.spreadT = 18;
    player.init();
    spawnInitialInfected(8);
    GAME.cityState.spawned = INFECTED.length;
  } else spawnAllSCPs();
  if (!city) spawnPersonnel();
  // 5K：把 SCP-1440 投送进站点
  if (fivek && typeof spawn1440 === 'function') spawn1440();
  player.init();
  // 角色专属出生点（MTF 用设施默认入口）
  const roleNow = currentRole();
  if (!farm && roleNow.spawn && FAC.roomAt[roleNow.spawn]) {
    const rm = FAC.roomAt[roleNow.spawn];
    player.pos.set(rm.cx, 0, rm.cz);
    player.yaw = rand(0, TAU);
  }
  const gd = GEAR_DEFS[effectiveLoadout().gear] || GEAR_DEFS.none;
  NVG.battery = gd.battery || 0;
  NVG.on = false;
  NVG.apply();
  // SCP-079：接管摄像头与设施控制；附身收容物：直接接管那只 SCP
  if (roleNow.ai && typeof start079 === 'function') start079();
  else if (roleNow.playable && typeof startPlayableSCP === 'function') {
    if (!startPlayableSCP(roleNow.id)) {
      // 兜底：万一那只 SCP 没生成出来，就退回 079 模式
      if (typeof start079 === 'function') start079();
    }
  }
  // 反叛之狐：O5 的净化令先到，反叛之狐后到 —— 延迟部署（玩家也要等）
  GAME.staging.active = false;
  if (GAME.mission === 'fivek' && roleNow.id === 'rebel') {
    GAME.staging.active = true;
    GAME.staging.total = 60;
    GAME.staging.t = 60;
  }

  if (bar) bar.style.width = '88%';
  if (bt) bt.textContent = '正在上传行动档案…';

  GAME.phase = 'playing';
  GAME.over = false; GAME.paused = false;
  GAME.elapsed = 0;
  GAME.alarmLevel = farm ? 1 : 0;
  txt('missionName', currentMission().name);
  lastT = performance.now() / 1000;
  hide('endScreen'); hide('pauseOverlay'); hide('bigMap'); hide('objPanel');
  bigMapOpen = false; objPanelOpen = false;
  show('ui');
  hide('menuScreen');

  AudioSys.init(); AudioSys.resume(); AudioSys.startAmbient();
  AudioSys.stopMusic(0.3); AudioSys.stopAlarm();   // 重开一局时先清掉上一局的音乐与警报
  if (bar) bar.style.width = '100%';
  setTimeout(() => {
    hide('bootScreen');
    if (!(GAME.staging && GAME.staging.active)) requestLock();
    AudioSys.alarm();
    if (farm) {
      broadcast('◤ 行动代号「收容」· 目标 SCP-096 · 地点：美国加利福尼亚州', 6000);
      subtitle('收容行动 · 开始', '找到 SCP-096 → 戴上收容头套 → 销毁照片 → 撤离', 5200);
      toast('⚠ 不要直视 SCP-096 的脸 · 照片也不要盯着看', 5400, 'warn');
    } else {
      // 落锤行动：Nu-7 入场广播 + 全场警报（一直响到行动结束）
      AudioSys.startAlarm();
      // 5K 行动放 Nu-22 的入场广播，其余放落锤行动的入场曲
      AudioSys.playMusic(fivek ? 'audio/nu22-entry.mp3' : 'audio/breach-entry.mp3', 0.42, false);
      const rn = roleView();
      if (GAME.mission === 'fivek' && rn.id === 'mtf') {
        // 5K：Nu-7 这个编制位在本行动里就是 Nu-22「火箭侠」
        broadcast('◤ C.A.S.S.I.E：机动特遣队 Nu-22「火箭侠」已抵达设施', 7000);
        subtitle('你是 ' + rn.name, rn.goal, 6800);
        toast('⚠ 站点全员敌对 · 1440 会替你清理靠得太近的人', 6400, 'bad');
      } else if (rn.ai) {
        broadcast('◤ SCP-079 已上线 · 设施主控权限接管完成', 6800);
        subtitle('你是 SCP-079', 'Q/E 切换摄像头 · F 开关门 · R 锁门 · N 停电 · G 特斯拉 · T 广播', 8000);
        toast('你没有身体，也没有武器 —— 用这座设施本身杀人', 5600, 'warn');
      } else if (rn.playable) {
        // 附身收容物：身份 + 操作提示
        broadcast('◤ 你是 ' + rn.name + ' · ' + rn.faction, 6400);
        subtitle('你是 ' + rn.name, rn.goal, 6400);
        toast('WASD 移动 · 左键攻击 · 目标：清除设施内全部人类', 6200, 'warn');
      } else {
        // 身份在落地这一刻才揭晓（菜单里刻意不写）
        broadcast('你是 ' + rn.name + ' · ' + rn.faction, 6400);
        subtitle('你是 ' + rn.name, rn.goal, 6000);
        if (rn.id === 'mtf') {
          toast('长按 [F] 交互 · [N] 头戴装置 · [M] 平面图', 4200);
          setTimeout(() => toast('⚠ 设施里散落着 6 张拍到 SCP-096 面部的档案照片，务必全部销毁', 5200, 'warn'), 4400);
        } else {
          toast('⚠ 你身上没有 MTF 的火力 —— 靠躲，不靠打', 5200, 'warn');
          setTimeout(() => toast('目标：' + rn.goal, 5400), 4600);
        }
      }
    }
  }, 380);
}

/* 重开一局：重新随机分配身份（落锤 / 5K 才有随机池；
   收容行动固定 MTF；URL 带 ?role= 固定角色时不重抽） */
function rerollRole() {
  if (GAME.roleForced) return;
  GAME.role = GAME.mission === 'contain096' ? 'mtf' : rollRole();
}

function restartGame() {
  rerollRole();
  hide('endScreen');
  startGame();
}

/* ---------------------------------------------------------------------
   相机
   --------------------------------------------------------------------- */
function updateCamera(dt) {
  const w = player.cur();
  const baseFov = SETTINGS.fov;
  const adsFov = w ? w.stats.adsFov : baseFov;
  const tgtFov = lerp(baseFov, adsFov, VM.adsBlend);
  if (Math.abs(camera.fov - tgtFov) > 0.01) {
    camera.fov = dampF(camera.fov, tgtFov, 16, dt);
    camera.updateProjectionMatrix();
  }
  const camY = player.pos.y + player.eyeH - player.landDip;
  camera.position.set(player.pos.x, camY, player.pos.z);

  let roll = 0;
  const tr = player.trauma;
  if (tr > 0.001) {
    const s = tr * tr;
    camera.position.x += rand(-1, 1) * 0.05 * s;
    camera.position.y += rand(-1, 1) * 0.05 * s;
    roll += rand(-1, 1) * 0.045 * s;
  }
  // 侧移倾斜
  const strafe = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  roll += -strafe * 0.022 * (1 - VM.adsBlend * 0.6);

  camera.rotation.order = 'YXZ';
  camera.rotation.set(
    clamp(player.pitch + player.recoilPitch, -1.55, 1.55),
    player.yaw + player.recoilYaw,
    roll
  );
  camera.updateMatrixWorld(true);
}

/* ---------------------------------------------------------------------
   渲染
   --------------------------------------------------------------------- */
function renderFrame() {
  renderer.clear();
  renderer.render(scene, camera);
  // 记录主场景统计（第二次 render 会重置 info，所以这里先存下来）
  window.__lastInfo = {
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    cam: [camera.position.x, camera.position.y, camera.position.z],
    rot: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
  };
  if (player.alive && VM.gun && VM.root.visible) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
}

/* ---------------------------------------------------------------------
   主循环
   --------------------------------------------------------------------- */
function loop() {
  requestAnimationFrame(loop);
  if (document.hidden) return;
  const now = performance.now();
  const rawDt = (now - lastT) / 1000;
  let dt = Math.min(rawDt, 0.05);
  lastT = now;
  nowT = now / 1000;
  dtGlobal = dt;
  fpsAcc += 1 / Math.max(dt, 0.001); fpsN++;

  if (GAME.phase !== 'playing') return;

  if ((GAME.paused && !DEBUG.noPause) || GAME.over) {
    renderFrame();
    return;
  }

  GAME.elapsed += dt;
  if (GAME.extractCd > 0) GAME.extractCd -= dt;
  if (GAME.spawnProtectT > 0) GAME.spawnProtectT -= dt;
  updateStaging(dt);

  updateBlink(dt);
  updatePlayer(dt);
  updateSCPs(dt);
  updateAllies(dt);
  updateFactions(dt);
  updatePersonnel(dt);
  // 净化行动：被感染者行为 + 感染扩散
  if (typeof updateInfected === 'function') updateInfected(dt);
  if (typeof updateInfectionSpread === 'function') updateInfectionSpread(dt);
  update079(dt);
  if (typeof updatePlayableSCP === 'function') updatePlayableSCP(dt);
  if (typeof update1440 === 'function') update1440(dt);
  if (typeof checkRebelWin === 'function') checkRebelWin();
  updateDoors(dt);
  updatePhotos(dt);             // 两个行动共用：盯着照片看太久会把 096 看暴走
  if (typeof updateFarm === 'function') updateFarm(dt);
  updatePickups(dt);
  updateFX(dt);
  updateLightPool(player.pos.x, player.pos.y + 1.6, player.pos.z);
  updateCamera(dt);
  updateSunShadow();
  NVG.update(dt);
  if (SKY) SKY.position.copy(camera.position);
  player.mouseDX *= Math.pow(0.0001, dt * 3);
  player.mouseDY *= Math.pow(0.0001, dt * 3);
  updateHUD(dt);

  renderFrame();
  // 自适应分辨率用「未裁剪」的原始帧时间判断，否则高延迟时会被 0.05 上限掩盖
  updateAdaptive(rawDt);
}

/* ---------------------------------------------------------------------
   启动
   --------------------------------------------------------------------- */
function boot() {
  const bar = el('bootBar'), bt = el('bootTxt');
  const step = (p, t) => { if (bar) bar.style.width = p + '%'; if (bt) bt.textContent = t; };

  step(10, '正在生成程序化贴图…');
  initLightPool(10);
  buildTextures();
  step(35, '正在建立光照与天空…');
  SKY = buildSky();
  applyQuality();
  step(55, '正在初始化特效与 HUD…');
  initFX();
  initHUD();
  step(72, '正在装载界面…');
  initMenus();
  VM.init();
  setupInput();
  step(92, '正在校验脚本…');
  const missing = [];
  if (typeof buildFacility !== 'function') missing.push('facility');
  if (typeof spawnAllSCPs !== 'function') missing.push('scp');
  if (typeof computeWeaponStats !== 'function') missing.push('weapons');
  if (missing.length) console.error('SCP:RX 缺少模块: ' + missing.join(','));
  step(100, '准备就绪');

  // 首次交互时解锁音频
  const unlock = () => { AudioSys.init(); AudioSys.resume(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  setTimeout(() => {
    hide('bootScreen');
    GAME.phase = 'menu';
    show('menuScreen');
    show('mHome');
    lastT = performance.now() / 1000;
    loop();
  }, 700);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(boot, 60);
} else {
  addEventListener('DOMContentLoaded', () => setTimeout(boot, 60));
}

bootMark('main');
