'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  13 HUD
   生命体征 / 弹药 / 目标 / 威胁雷达 / 罗盘 / 平面图 / 眨眼系统
   ===================================================================== */

let blinkOv = null;
let radarCtx = null, compassCtx = null, bmCtx = null;
let bigMapOpen = false, objPanelOpen = false;
let lastKillfeed = 0;

// DOM 引用缓存：updateHUD 每帧要碰几十个元素，
// 每次都 document.getElementById 会白白烧掉大量时间（实测约 0.05ms/帧，且触发样式重算）
const H = {};
function initHUD() {
  radarCtx = el('radar').getContext('2d');
  compassCtx = el('compass').getContext('2d');
  bmCtx = el('bmCanvas').getContext('2d');
  const ids = ['hpBar', 'hpTxt', 'armorBar', 'armorTxt', 'sleepBar', 'sleepTxt', 'nvgBar', 'nvgTxt',
    'gearLabel', 'scramInd',
    'wName', 'wMode', 'magN', 'resN', 'modRow', 'slot1', 'slot2', 'missionTime', 'threatCount',
    'alarmLamp', 'objList', 'interact', 'interactTxt', 'interactBar', 'fps', 'crosshair', 'grabWarn', 'ui'];
  for (const id of ids) H[id] = el(id);
  const ch = H.crosshair;
  H.chT = ch.querySelector('.ch.t'); H.chB = ch.querySelector('.ch.b');
  H.chL = ch.querySelector('.ch.l'); H.chR = ch.querySelector('.ch.r');
  // 眨眼遮罩
  blinkOv = document.createElement('div');
  blinkOv.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:5';
  H.ui.appendChild(blinkOv);
  player.blinking = false;
  player.blinkTimer = rand(3.5, 7);
  player.blinkDur = 0;
}

/* ---------------------------------------------------------------------
   眨眼（SCP-173 的核心机制）
   --------------------------------------------------------------------- */
function updateBlink(dt) {
  if (!player.alive || GAME.phase !== 'playing') return;
  if (player.blinkDur > 0) {
    player.blinkDur -= dt;
    const t = clamp(player.blinkDur / 0.26, 0, 1);
    blinkOv.style.opacity = String(Math.sin(t * PI) * 0.96);
    player.blinking = true;
    if (player.blinkDur <= 0) {
      player.blinking = false;
      blinkOv.style.opacity = '0';
      player.blinkTimer = rand(4.0, 8.0);
      // 有 173 在场时给一次提示音
      let near = false;
      for (const s of SCP_LIST) if (s.alive && s.key === '173' && Math.hypot(s.pos.x - player.pos.x, s.pos.z - player.pos.z) < 24) { near = true; break; }
      if (near && Math.random() < 0.55) AudioSys.scpRoar('173', 12);
    }
    return;
  }
  player.blinking = false;
  player.blinkTimer -= dt;
  if (player.blinkTimer <= 0) {
    player.blinkDur = 0.26;
    AudioSys.beep(false);
  }
}

/* ---------------------------------------------------------------------
   准星扩散
   --------------------------------------------------------------------- */
function updateCrosshair() {
  const w = player.cur();
  if (!w) return;
  const moveMul = clamp(Math.hypot(player.vel.x, player.vel.z) / 6, 0, 1);
  const spread = lerp(w.stats.spreadHip, w.stats.spreadAds, VM.adsBlend) * (1 + player.bloom) * (1 + moveMul * 0.8);
  const px = clamp(spread * 1.5, 1.6, 22);
  H.chT.style.transform = 'translateX(-50%) translateY(' + (-px) + 'px)';
  H.chB.style.transform = 'translateX(-50%) translateY(' + px + 'px)';
  H.chL.style.transform = 'translateY(-50%) translateX(' + (-px) + 'px)';
  H.chR.style.transform = 'translateY(-50%) translateX(' + px + 'px)';
  H.crosshair.style.opacity = VM.adsBlend > 0.7 ? '0.18' : '0.9';
}

/* ---------------------------------------------------------------------
   HUD 主更新
   --------------------------------------------------------------------- */
function updateHUD(dt) {
  // 生命
  H.hpBar.style.transform = 'scaleX(' + clamp(player.hp / player.maxHp, 0, 1) + ')';
  H.hpTxt.textContent = Math.ceil(player.hp);
  const arP = player.armorMax > 0 ? clamp(player.armorHp / player.armorMax, 0, 1) : 0;
  H.armorBar.style.transform = 'scaleX(' + arP + ')';
  H.armorTxt.textContent = Math.ceil(player.armorHp);
  H.sleepBar.style.transform = 'scaleX(' + clamp(player.sleep / 100, 0, 1) + ')';
  H.sleepTxt.textContent = Math.ceil(player.sleep);
  H.nvgBar.style.transform = 'scaleX(' + clamp(NVG.battery / 100, 0, 1) + ')';
  H.nvgTxt.textContent = Math.ceil(NVG.battery);
  if (H.gearLabel) {
    const gl = NVG.shortLabel();
    if (H.gearLabel.textContent !== gl) H.gearLabel.textContent = gl;
  }

  // ---- SCP-079 面板：AP / EXP / 摄像头 ----
  const o79 = el('o79Panel');
  const o79on = (typeof AI079 !== 'undefined') && AI079.active;
  if (o79) {
    o79.classList.toggle('hidden', !o79on);
    if (o79on) {
      const apMax = o79APMax();
      el('o79ApBar').style.width = (clamp(AI079.ap / apMax, 0, 1) * 100).toFixed(0) + '%';
      el('o79ApTxt').textContent = Math.round(AI079.ap) + '/' + apMax;
      const need = O79_EXP_NEXT[o79TierIdx()];
      const maxed = AI079.tier >= 5;
      el('o79ExpBar').style.width = (maxed ? 100 : clamp(AI079.exp / need, 0, 1) * 100).toFixed(0) + '%';
      el('o79ExpTxt').textContent = maxed ? 'MAX' : Math.round(AI079.exp) + '/' + Math.round(need);
      el('o79Tier').textContent = 'TIER ' + AI079.tier;
      const c = o79Cam();
      const cn = c ? c.name : '—';
      if (el('o79CamName').textContent !== cn) el('o79CamName').textContent = cn;
      const hh = String(o79Humans()), ss = String(o79SCPsAlive());
      if (el('o79Humans').textContent !== hh) el('o79Humans').textContent = hh;
      if (el('o79Scps').textContent !== ss) el('o79Scps').textContent = ss;
    }
  }
  // ---- 附身收容物面板：本体 HP / 状态 / 击杀 ----
  const psp = el('pscpPanel');
  const pscpOn = (typeof PSCP !== 'undefined') && PSCP.active;
  if (psp) {
    psp.classList.toggle('hidden', !pscpOn);
    if (pscpOn) {
      const e = PSCP.ent, tn = PSCP.tune;
      el('pscpName').textContent = e ? e.name : '—';
      el('pscpAtk').textContent = tn.atkName;
      const hp = Math.max(0, Math.round(e ? e.hp : 0));
      el('pscpHpBar').style.width = (clamp(hp / Math.max(1, e ? e.maxHp : 1), 0, 1) * 100).toFixed(0) + '%';
      el('pscpHpTxt').textContent = hp;
      let st = '';
      if (tn.frozenWhenSeen) {
        // 全体共享眨眼节拍：把"还要等多久"直接写出来，不然 173 完全靠猜
        st = PSCP.observed
          ? '被注视 · 无法移动（眨眼倒计时 ' + Math.max(0, npcBlinkCd).toFixed(1) + ' 秒）'
          : '无人注视 · 可以移动' + (npcBlinkT > 0 ? '（窗口还剩 ' + npcBlinkT.toFixed(1) + ' 秒）' : '');
      }
      else if (tn.rageOnSight) st = (e && e.enraged) ? '暴走中 · 速度 ×5' : '温顺 · 没有人看你的脸';
      else if (tn.phase) st = '相位状态 · 可以直接穿墙';
      else if (tn.soundVision) st = '声呐视觉 · 下方标出会出声的人';
      if (el('pscpState').textContent !== st) el('pscpState').textContent = st;
      const kk = String(PSCP.kills), hh = String((typeof o79Humans === 'function') ? o79Humans() : 0);
      if (el('pscpKills').textContent !== kk) el('pscpKills').textContent = kk;
      if (el('pscpHumans').textContent !== hh) el('pscpHumans').textContent = hh;
      const snd = el('pscpSound');
      if (tn.soundVision) {
        const sig = PSCP.soundList.map(x => Math.round(x.d) + (x.loud >= 1 ? 'L' : 'q')).join(',');
        if (snd._sig !== sig) {
          snd._sig = sig;
          snd.innerHTML = PSCP.soundList.map(x =>
            '<div class="' + (x.loud >= 1 ? 'sLoud' : (x.d < 14 ? 'sNear' : '')) + '">'
            + (x.loud >= 1 ? '▮ 有声 ' : '▯ 轻微 ') + Math.round(x.d) + ' m</div>').join('');
        }
      } else if (snd.innerHTML) { snd.innerHTML = ''; snd._sig = ''; }
    }
  }
  // 079 / 附身收容物都没有生命体征面板和弹药，藏掉
  const hideHuman = o79on || pscpOn;
  if (H._o79hide !== hideHuman) {
    H._o79hide = hideHuman;
    const vit = el('vitals'), amp = el('ammoPanel');
    if (vit) vit.style.display = hideHuman ? 'none' : '';
    if (amp) amp.style.display = hideHuman ? 'none' : '';
  }

  // 弹药
  const w = player.cur();
  if (w) {
    if (H.wName.textContent !== w.stats.name) H.wName.textContent = w.stats.name;
    const modeTxt = w.stats.modeName + ' · ' + w.stats.ammoType;
    if (H.wMode.textContent !== modeTxt) H.wMode.textContent = modeTxt;
    const magStr = w.reloading ? '--' : String(w.mag);
    if (H.magN.textContent !== magStr) H.magN.textContent = magStr;
    H.magN.classList.toggle('low', w.mag <= w.stats.mag * 0.28);
    const resStr = '/ ' + w.reserve;
    if (H.resN.textContent !== resStr) H.resN.textContent = resStr;
    // 改装列表只在换枪时重建，绝不要每帧写 innerHTML
    if (H.modRow._wpn !== w.id) {
      H.modRow._wpn = w.id;
      let s = '';
      for (const m of w.stats.mods) s += '<span class="mTag">' + m.name + '</span>';
      H.modRow.innerHTML = s || '<span style="opacity:.5">原厂配置</span>';
    }
    if (H.slot1._s !== player.curSlot) {
      H.slot1._s = player.curSlot;
      H.slot1.classList.toggle('sel', player.curSlot === 0);
      H.slot2.classList.toggle('sel', player.curSlot === 1);
    }
    // 空手角色（研究员 / D 级人员）槽位是空的，不能直接读 stats
    const s1t = '1 ' + (player.slots[0] ? player.slots[0].stats.name : '—');
    const s2t = '2 ' + (player.slots[1] ? player.slots[1].stats.name : '—');
    if (H.slot1.textContent !== s1t) H.slot1.textContent = s1t;
    if (H.slot2.textContent !== s2t) H.slot2.textContent = s2t;
  } else {
    // 空手角色：别让上一局的枪械信息残留在 HUD 上
    if (H.wName.textContent !== '空手') H.wName.textContent = '空手';
    if (H.wMode.textContent !== '无武器 · 靠躲，不靠打') H.wMode.textContent = '无武器 · 靠躲，不靠打';
    if (H.magN.textContent !== '--') H.magN.textContent = '--';
    if (H.resN.textContent !== '') H.resN.textContent = '';
    if (H.slot1.textContent !== '') H.slot1.textContent = '';
    if (H.slot2.textContent !== '') H.slot2.textContent = '';
    if (H.modRow._wpn !== '__none') { H.modRow._wpn = '__none'; H.modRow.innerHTML = '<span style="opacity:.5">无装备</span>'; }
  }

  // 任务时间
  const t = Math.max(0, GAME.elapsed);
  const tStr = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  if (H.missionTime.textContent !== tStr) H.missionTime.textContent = tStr;

  // 收容进度
  const done = Object.keys(GAME.contained).length;
  const thStr = done + ' / ' + SCP_ORDER.length;
  if (H.threatCount.textContent !== thStr) H.threatCount.textContent = thStr;
  const lvl = GAME.alarmLevel;
  if (H.alarmLamp._lvl !== lvl) {
    H.alarmLamp._lvl = lvl;
    H.alarmLamp.className = 'lamp' + (lvl === 2 ? ' crit' : lvl === 1 ? ' warn' : '');
    H.alarmLamp.textContent = lvl === 2 ? '紧急' : lvl === 1 ? '警戒' : '静默';
  }

  updateObjectiveHUD();
  updateInteractHUD();
  updateCrosshair();
  updateGrabWarn();
  updateScramInd();

  // 雷达 / 罗盘（降频到约 12Hz，省下大量 Canvas 2D 开销）
  hudTick += dt;
  if (hudTick > 0.085) {
    hudTick = 0;
    drawRadar();
    drawCompass();
    if (bigMapOpen) drawBigMap();
  }

  // FPS（自适应降分辨率时一并显示当前倍率，便于判断是否在吃力）
  if (fpsN >= 30) {
    fpsShow = Math.round(fpsAcc / fpsN);
    H.fps.textContent = fpsShow + ' FPS' + (PERF.scale < 0.999 ? ' · 内部分辨率 ' + Math.round(PERF.scale * 100) + '%' : '');
    fpsAcc = 0; fpsN = 0;
  }
}
let hudTick = 0;

function updateGrabWarn() {
  const show = !!(player.grabbedBy && player.grabbedBy.alive);
  if (H.grabWarn._on !== show) {
    H.grabWarn._on = show;
    H.grabWarn.classList.toggle('hidden', !show);
  }
}

/* Project SCRAMBLE 正在把 SCP-096 的脸糊掉时，给一条明确的 HUD 反馈 */
function updateScramInd() {
  if (!H.scramInd) return;
  let on = false;
  if (player.alive && NVG.scrambleActive()) {
    for (let i = 0; i < SCP_LIST.length; i++) {
      const s = SCP_LIST[i];
      if (s.key === '096' && s.alive && s.scrambleHold) { on = true; break; }
    }
  }
  if (H.scramInd._on !== on) {
    H.scramInd._on = on;
    H.scramInd.classList.toggle('hidden', !on);
  }
}

/* ---------------------------------------------------------------------
   目标 HUD
   --------------------------------------------------------------------- */
function updateObjectiveHUD() {
  const box = H.objList;
  if (!box) return;
  const st = objectiveStatus();
  const objs = currentObjectives();
  // 护送人员 / 伤害加成（仅落锤行动有）
  const pSci = (GAME.mission !== 'contain096' && typeof personnelAlive === 'function') ? personnelAlive('scientist') : 0;
  const pGrd = (GAME.mission !== 'contain096' && typeof personnelAlive === 'function') ? personnelAlive('guard') : 0;
  const pD = (GAME.mission !== 'contain096' && typeof personnelAlive === 'function') ? personnelAlive('classd') : 0;
  let sig;
  if (GAME.mission === 'fivek') {
    const t = (typeof S1440 !== 'undefined') ? S1440 : null;
    const rb = (typeof roleView === 'function') && roleView().id === 'rebel';
    sig = 'k' + (t ? Math.floor(t.holdT * 2) : 0) + '|' + (t ? t.curseKills : 0)
      + '|' + Math.round(player.hp) + '|' + (t && t.ent ? Math.round(Math.hypot(player.pos.x - t.ent.pos.x, player.pos.z - t.ent.pos.z)) : 0)
      + '|' + (t && t.holding ? 1 : 0)
      + '|' + (rb ? 'r' + (t && t.executed ? 1 : 0) + '/' + (typeof nu22Alive === 'function' ? nu22Alive() : 0) : '');
  } else if (GAME.mission === 'contain096') {
    sig = 'f' + st.find + 'h' + st.hood + 'p' + st.photos + 'e' + st.extract + '|' + st._photosLeft;
  } else if (GAME.mission === 'city') {
    sig = 'c' + st.source + st.purge_infected + st.extract
      + '|' + st._sourcesLeft + '|' + st._infectedLeft + '|' + st._infectedSpawned;
  } else {
    const bn = (GAME.breakers.A ? 1 : 0) + (GAME.breakers.B ? 1 : 0) + (GAME.breakers.C ? 1 : 0);
    sig = st.power + st.protocol + st.photos + st.purge + st.invaders + st.extract + '|' + bn
      + '|' + Object.keys(GAME.contained).length + '|' + st._photosLeft + '|' + st._invadersLeft
      + '|' + GAME.bonusAnomaly + 'x' + GAME.bonusHostile + '|' + pSci + pGrd + pD + '|' + GAME.role
      + '|' + Math.ceil(FACTION_STATE.ciReinforceT) + ',' + Math.ceil(FACTION_STATE.handReinforceT);
  }
  // 重新部署的无敌时间也要进签名，否则倒计时不会刷新（按 0.25 秒粒度避免每帧重绘）
  sig += '|p' + (GAME.spawnProtectT > 0 ? Math.ceil(GAME.spawnProtectT * 4) : 0);
  if (box._sig === sig) return;
  box._sig = sig;
  let s = '';
  // 身份行：随机角色的回合制模式下，先告诉玩家自己是谁
  if (GAME.mission !== 'contain096') {
    const r = roleView();
    s += '<div class="objItem" style="opacity:.95">你是 ' + r.name
      + '<span style="opacity:.6"> · ' + r.faction + '</span></div>';
  }
  if (GAME.spawnProtectT > 0) {
    s += '<div class="objItem" style="color:#4ad8a0">🛡 重新部署保护 · '
      + GAME.spawnProtectT.toFixed(1) + ' 秒</div>';
  }
  for (const o of objs) {
    const state = st[o.id];
    const cls = state === 'done' ? 'done' : (state === 'active' ? 'active' : '');
    s += '<div class="objItem ' + cls + '">' + o.title + '</div>';
    if (state === 'active' && o.id === 'power') {
      const bn = (GAME.breakers.A ? 1 : 0) + (GAME.breakers.B ? 1 : 0) + (GAME.breakers.C ? 1 : 0);
      s += '<div class="objProg">断路器 ' + bn + ' / 3</div>';
    }
    // 净化行动：感染源进度 + 场上感染者数量
    if (state === 'active' && o.id === 'source') {
      s += '<div class="objProg">已关闭 ' + (FAC.breakers.length - st._sourcesLeft) + ' / ' + FAC.breakers.length + '</div>';
    }
    if (o.id === 'purge_infected') {
      s += '<div class="objProg">场上被感染者 ' + st._infectedLeft + ' 个</div>';
      if (st._sourcesLeft > 0) {
        s += '<div class="objProg" style="opacity:.7">感染仍在扩散 · 先关感染源</div>';
      }
    }
    if (state === 'active' && o.id === 'purge') {
      s += '<div class="objProg">已停止活动 ' + Object.keys(GAME.contained).length + ' / ' + SCP_ORDER.length + '</div>';
    }
    if (state === 'active' && o.id === 'photos') {
      s += '<div class="objProg">剩余照片 ' + st._photosLeft + ' / ' + st._photosTotal + '</div>';
    }
    if (state === 'active' && o.id === 'hood' && GAME.saw096) {
      s += '<div class="objProg">靠近后长按 [F] 戴头套</div>';
    }
    if (state === 'active' && o.id === 'invaders') {
      s += '<div class="objProg">混沌分裂者 ' + factionAlive('ci') + ' · 蛇之手 ' + factionAlive('hand') + ' 存活</div>';
      const nxt = Math.min(
        FACTION_STATE.ciSpawned ? FACTION_STATE.ciReinforceT : 999,
        FACTION_STATE.handSpawned ? FACTION_STATE.handReinforceT : 999);
      if (nxt < 900) s += '<div class="objProg" style="opacity:.7">增援倒计时 ' + Math.max(0, Math.ceil(nxt)) + ' 秒</div>';
    }
    if (state === 'pending' && o.id === 'invaders') {
      const left = Math.max(0, Math.ceil(FACTION_SCHEDULE.ciAt - GAME.elapsed));
      s += '<div class="objProg">预计 ' + Math.floor(left / 60) + ' 分 ' + (left % 60) + ' 秒后突入</div>';
    }
    // 5K：SCP-1440 滞留计时
    if (state === 'active' && o.id === 'hold' && typeof S1440 !== 'undefined' && S1440.ent) {
      const dd = Math.hypot(player.pos.x - S1440.ent.pos.x, player.pos.z - S1440.ent.pos.z);
      const near = S1440.holding;
      const who = near
        ? (dd < S1440_HOLD_R ? '你在范围内' : 'Nu-22 正在守着它')
        : '计时回退中';
      s += '<div class="objProg">滞留 ' + Math.floor(S1440.holdT) + ' / ' + S1440.holdNeed + ' 秒'
        + '　<span style="color:' + (near ? '#4ad8a0' : '#e8c06a') + '">'
        + who + (near || dd < S1440_HOLD_R ? '' : ' · 距 1440 ' + Math.round(dd) + 'm') + '</span></div>';
    }
    if (state === 'active' && o.id === 'survive' && typeof S1440 !== 'undefined') {
      s += '<div class="objProg">1440 已清理 ' + S1440.curseKills + ' 人</div>';
    }
    // 反叛之狐的目标进度
    if (state === 'active' && o.id === 'kill1440' && typeof S1440 !== 'undefined') {
      s += '<div class="objProg">' + (S1440.executed ? '已处决' : '走近它长按 [F] 执行处决（6 秒引导）') + '</div>';
    }
    if (state === 'active' && o.id === 'killNu22') {
      s += '<div class="objProg">还剩 ' + (st._nu22Left | 0) + ' 名 Nu-22</div>';
    }
  }
  // 护送进度 + 伤害加成（收容物阵营不参与护送，别显示）
  if (GAME.mission !== 'contain096' && currentRole().side !== 'scp'
    && (pSci + pGrd + pD > 0 || GAME.bonusAnomaly > 1 || GAME.bonusHostile > 1)) {
    s += '<div class="objItem" style="opacity:.9">护送 · 待救 ' + (pSci + pGrd) + ' 人'
      + (pD > 0 ? ' · D级 ' + pD : '') + '</div>';
    if (GAME.bonusAnomaly > 1 || GAME.bonusHostile > 1) {
      s += '<div class="objProg">加成 异常 ×' + GAME.bonusAnomaly + ' · 敌对 ×' + GAME.bonusHostile + '</div>';
    }
  }
  box.innerHTML = s;
}

function updateInteractHUD() {
  const box = H.interact;
  if (!box) return;
  const it = player.interact;
  if (!it || !player.alive) {
    if (H._intOn !== false) { H._intOn = false; box.classList.remove('on'); }
    return;
  }
  if (H._intOn !== true) { H._intOn = true; box.classList.add('on'); }
  let label = '交互';
  if (it.hood096) label = '为 SCP-096 戴上收容头套 —— 长按 [F]';
  else if (it.isPhoto) label = '划掉照片「' + it.where + '」—— 长按 [F]';
  else if (it.s1440Follow) label = '让 SCP-1440 跟着你走 —— 长按 [F]';
  else if (it.s1440Release) label = '让 SCP-1440 停下 —— 长按 [F]';
  else if (it.exec1440) label = '处决 SCP-1440 —— 长按 [F]（6 秒）';
  else if (it.isInfectionSource) label = '关闭感染源 ' + it.id + ' —— 长按 [F]';
  else if (it.key && it.key.startsWith('breaker_')) label = '合上断路器 ' + it.id + ' —— 长按 [F]';
  else if (it === FAC.terminal) label = '上传收容协议 —— 长按 [F]';
  else if (it === FAC.extract) label = (GAME.mission === 'contain096' || GAME.mission === 'city')
    ? '登机撤离 —— 长按 [F]' : '启动撤离电梯 —— 长按 [F]';
  else if (it === FAC.nuke) label = '触发核弹装置 · EMP 脉冲 —— 长按 [F]';
  else if (it === FAC.coffee) label = '来一杯咖啡 —— 长按 [F]';
  if (H.interactTxt.textContent !== label) H.interactTxt.textContent = label;
  H.interactBar.style.width = (clamp(player.interactHold / it.holdNeed, 0, 1) * 100) + '%';
}

/* ---------------------------------------------------------------------
   击杀提示
   --------------------------------------------------------------------- */
function killfeed(msg, cls) {
  const box = el('killfeed');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'kf ' + (cls || '');
  d.textContent = msg;
  box.appendChild(d);
  while (box.children.length > 7) box.removeChild(box.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 6000);
}

/* ---------------------------------------------------------------------
   威胁雷达
   --------------------------------------------------------------------- */
function drawRadar() {
  const c = radarCtx; if (!c) return;
  const W = 180, H = 180, R = 84;
  const cx = W / 2, cy = H / 2;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(4,6,8,0.55)'; c.fillRect(0, 0, W, H);
  // 网格
  c.strokeStyle = 'rgba(90,168,224,0.16)'; c.lineWidth = 1;
  for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(cx, cy, R * i / 3, 0, TAU); c.stroke(); }
  c.beginPath(); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.stroke();
  // 扇形
  c.fillStyle = 'rgba(90,168,224,0.06)';
  c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, -HPI - 0.55, -HPI + 0.55); c.closePath(); c.fill();

  const yaw = player.yaw;
  const range = 26;
  const toRadar = (x, z) => {
    const dx = x - player.pos.x, dz = z - player.pos.z;
    // 世界 → 以玩家朝向为上的雷达坐标（前 = 上）
    const rx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const rz = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    return { x: cx + rx / range * R, y: cy - rz / range * R, d: Math.hypot(dx, dz) };
  };
  // 目标点
  const drawDot = (x, z, color, size, ring) => {
    const p = toRadar(x, z);
    if (p.d > range) {
      // 贴边指示
      const ang = Math.atan2(p.y - cy, p.x - cx);
      c.fillStyle = color; c.globalAlpha = 0.5;
      c.beginPath(); c.arc(cx + Math.cos(ang) * (R - 3), cy + Math.sin(ang) * (R - 3), size * 0.7, 0, TAU); c.fill();
      c.globalAlpha = 1;
      return;
    }
    c.fillStyle = color;
    c.beginPath(); c.arc(p.x, p.y, size, 0, TAU); c.fill();
    if (ring) { c.strokeStyle = color; c.globalAlpha = 0.45; c.beginPath(); c.arc(p.x, p.y, size + 3, 0, TAU); c.stroke(); c.globalAlpha = 1; }
  };
  for (const s of SCP_LIST) {
    if (!s.alive) continue;
    const ghost = s.ghost;
    if (ghost) continue;   // 966 隐形时不上雷达
    drawDot(s.pos.x, s.pos.z, s.key === '682' || s.key === '106' ? '#ff5a3a' : '#d8442f', 3.4, true);
  }
  for (const m of MINIONS) if (m.alive) drawDot(m.pos.x, m.pos.z, '#b06ad8', 2.6, false);
  for (const a of ALLY_LIST) if (a.alive) drawDot(a.pos.x, a.pos.z, '#5aa8e0', 2.6, false);
  // ⚠️ 设施人员与两支入侵势力也要上雷达 ——
  //    之前只画了 SCP / 小怪 / MTF，结果"我在地图上找不到人"变成了单方面的信息差。
  //    颜色：D 级橙（同它的囚服）、研究员浅灰、保安蓝；CI 暗红、蛇之手绿。
  if (typeof PERSONNEL_LIST !== 'undefined') {
    for (const p of PERSONNEL_LIST) {
      if (!p.alive || p.escaped) continue;
      const col = p.kind === 'classd' ? '#d4761f' : (p.kind === 'guard' ? '#5aa8e0' : '#cfe0e8');
      drawDot(p.pos.x, p.pos.z, col, 2.4, false);
    }
  }
  if (typeof FACTION_LIST !== 'undefined') {
    for (const f of FACTION_LIST) {
      if (!f.alive) continue;
      drawDot(f.pos.x, f.pos.z, f.kind === 'ci' ? '#a03a2a' : '#6a9a4a', 2.6, false);
    }
  }
  // 净化行动：被感染者（疫病绿）
  if (typeof INFECTED !== 'undefined') {
    for (const m of INFECTED) if (m.alive) drawDot(m.pos.x, m.pos.z, '#8adf3a', 2.6, false);
  }
  // 目标点
  for (const b of FAC.breakers) if (!b.done) drawDot(b.x, b.z, '#e0b64a', 3, false);
  if (FAC.terminal && !FAC.terminal.done) drawDot(FAC.terminal.x, FAC.terminal.z, '#e0b64a', 3.4, false);
  if (typeof FARM !== 'undefined' && FAC.mode === 'farm') {
    for (const p of PHOTOS) if (!p.done) drawDot(p.x, p.z, '#ffd23f', 3.2, true);
  }
  if (FAC.extract && extractReady()) drawDot(FAC.extract.x, FAC.extract.z, '#4ad8a0', 3.4, true);
  for (const p of PICKUPS) if (!p.taken) drawDot(p.x, p.z, '#6a7a5a', 1.6, false);

  // 玩家
  c.fillStyle = '#4ad8a0';
  c.beginPath(); c.moveTo(cx, cy - 6); c.lineTo(cx - 4.5, cy + 4); c.lineTo(cx + 4.5, cy + 4); c.closePath(); c.fill();
  // 扫描线
  const sa = nowT * 1.1 % TAU;
  c.strokeStyle = 'rgba(74,216,160,0.35)'; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(sa) * R, cy - Math.cos(sa) * R); c.stroke();
}

/* ---------------------------------------------------------------------
   罗盘
   --------------------------------------------------------------------- */
const COMPASS_DIRS = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
function drawCompass() {
  const c = compassCtx; if (!c) return;
  const W = 640, H = 30;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(4,6,8,0.42)'; c.fillRect(0, 0, W, H);
  const fovDeg = SETTINGS.fov;
  const pxPerDeg = W / fovDeg;
  // 玩家 yaw → 方位角（yaw=0 时朝向 +Z，记为南；这里定义 yaw 增加为逆时针）
  let heading = (-player.yaw * 180 / PI) % 360;
  if (heading < 0) heading += 360;
  c.font = '11px Consolas, monospace';
  c.textAlign = 'center';
  for (let deg = -180; deg <= 540; deg += 15) {
    const rel = deg - heading;
    const x = W / 2 + rel * pxPerDeg;
    if (x < -30 || x > W + 30) continue;
    const major = deg % 90 === 0;
    c.strokeStyle = major ? 'rgba(224,182,74,0.9)' : 'rgba(126,136,145,0.5)';
    c.beginPath(); c.moveTo(x, major ? 4 : 9); c.lineTo(x, 15); c.stroke();
    if (major) {
      const d = COMPASS_DIRS.find(v => ((v[0] % 360) + 360) % 360 === ((deg % 360) + 360) % 360);
      if (d) { c.fillStyle = 'rgba(224,182,74,0.95)'; c.fillText(d[1], x, 27); }
    }
  }
  c.fillStyle = '#4ad8a0';
  c.beginPath(); c.moveTo(W / 2, 16); c.lineTo(W / 2 - 5, 25); c.lineTo(W / 2 + 5, 25); c.closePath(); c.fill();
}

/* ---------------------------------------------------------------------
   设施平面图
   --------------------------------------------------------------------- */
function drawBigMap() {
  const c = bmCtx; if (!c) return;
  const W = 720, H = 820;
  c.fillStyle = '#0a0c0f'; c.fillRect(0, 0, W, H);
  const pad = 26;
  const sx = (W - pad * 2) / GW, sy = (H - pad * 2) / GH;
  const zoneFill = { HCZ: '#3e2a2a', LCZ: '#3c3828', EZ: '#2c3a48' };
  const zoneLine = { HCZ: '#7a4c4c', LCZ: '#7a7250', EZ: '#4c6c8a' };
  const zoneName = { HCZ: '重收容区', LCZ: '轻收容区', EZ: '办公区' };

  // 分区底色带（只有设施地图有分区；农场和市区是开阔地）
  if (FAC.mode === 'facility') {
    const zoneBands = [['HCZ', 3, 33], ['LCZ', 34, 49], ['EZ', 50, 70]];
    c.font = 'bold 11px Consolas, monospace';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    for (const [z, r0, r1] of zoneBands) {
      const y0 = pad + r0 * sy, y1 = pad + (r1 + 1) * sy;
      c.fillStyle = 'rgba(255,255,255,0.035)';
      c.fillRect(pad - 22, y0, W - pad * 2 + 44, y1 - y0);
      c.fillStyle = zoneLine[z];
      c.fillRect(pad - 22, y0, 3, y1 - y0);
      c.save();
      c.translate(pad - 8, (y0 + y1) / 2);
      c.rotate(-HPI);
      c.textAlign = 'center';
      c.fillStyle = zoneLine[z];
      c.fillText(zoneName[z], 0, 0);
      c.restore();
    }
  }

  // 开放格
  for (let r = 0; r < GH; r++) for (let cc = 0; cc < GW; cc++) {
    if (FAC.open[idxOf(cc, r)] !== 1) continue;
    const z = FAC.zone[idxOf(cc, r)] || 'LCZ';
    c.fillStyle = zoneFill[z];
    c.fillRect(pad + cc * sx, pad + r * sy, sx + 0.6, sy + 0.6);
  }
  // 房间轮廓 + 名称
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const rm of FAC.rooms) {
    const px = pad + rm.c0 * sx, py = pad + rm.r0 * sy;
    const pw = (rm.c1 - rm.c0 + 1) * sx, ph = (rm.r1 - rm.r0 + 1) * sy;
    c.strokeStyle = zoneLine[rm.zone];
    c.lineWidth = 1;
    c.strokeRect(px, py, pw, ph);
    const label = rm.name.replace('SCP-', '');
    const isSCP = rm.kind === 'containment';
    if (pw > 52 && ph > 26) {
      c.font = (isSCP ? 'bold ' : '') + (pw > 90 ? '11px' : '9.5px') + ' Consolas, monospace';
      c.fillStyle = isSCP ? 'rgba(255,140,120,0.95)' : 'rgba(206,214,222,0.86)';
      const parts = label.split(' ');
      if (parts.length > 1 && pw < 90) {
        c.fillText(parts[0], px + pw / 2, py + ph / 2 - 6);
        c.fillText(parts.slice(1).join(' '), px + pw / 2, py + ph / 2 + 6);
      } else {
        c.fillText(label, px + pw / 2, py + ph / 2);
      }
    }
  }
  const mark = (x, z, color, size, label, shape) => {
    const mx = pad + ((x / CELL + GW / 2 - 0.5) + 0.5) * sx;
    const mz = pad + ((z / CELL + GH / 2 - 0.5) + 0.5) * sy;
    c.fillStyle = color;
    if (shape === 'tri') {
      c.beginPath(); c.moveTo(mx, mz - size); c.lineTo(mx - size, mz + size); c.lineTo(mx + size, mz + size); c.closePath(); c.fill();
    } else if (shape === 'sq') {
      c.fillRect(mx - size, mz - size, size * 2, size * 2);
    } else {
      c.beginPath(); c.arc(mx, mz, size, 0, TAU); c.fill();
    }
    if (label) { c.fillStyle = 'rgba(230,235,240,.85)'; c.font = '9px Consolas, monospace'; c.textAlign = 'left'; c.fillText(label, mx + size + 3, mz + 3); c.textAlign = 'center'; }
  };
  for (const b of FAC.breakers) mark(b.x, b.z, b.done ? '#1f6b50' : '#e0b64a', 5, 'PWR-' + b.id, 'sq');
  if (FAC.terminal) mark(FAC.terminal.x, FAC.terminal.z, FAC.terminal.done ? '#1f6b50' : '#e0b64a', 5, '总控', 'sq');
  if (FAC.nuke) mark(FAC.nuke.x, FAC.nuke.z, FAC.nuke.done ? '#1f6b50' : '#ff5a3a', 5, '核弹', 'sq');
  if (FAC.coffee) mark(FAC.coffee.x, FAC.coffee.z, FAC.coffee.done ? '#1f6b50' : '#ffb060', 4, '咖啡', 'circle');
  if (typeof FARM !== 'undefined' && FAC.mode === 'farm') {
    for (const p of PHOTOS) mark(p.x, p.z, p.done ? '#1f6b50' : '#ffd23f', 5, p.done ? '' : '照片', 'sq');
  }
  if (FAC.extract) mark(FAC.extract.x, FAC.extract.z, extractReady() ? '#4ad8a0' : '#6a7a72', 6, '撤离', 'tri');
  for (const s of SCP_LIST) if (s.alive) mark(s.pos.x, s.pos.z, '#d8442f', 4, s.name, 'circle');
  for (const a of ALLY_LIST) if (a.alive) mark(a.pos.x, a.pos.z, '#5aa8e0', 3.4, '', 'circle');
  // 设施人员 + 两支入侵势力（和雷达保持一致 —— 不画就没人找得到）
  if (typeof PERSONNEL_LIST !== 'undefined') {
    for (const p of PERSONNEL_LIST) {
      if (!p.alive || p.escaped) continue;
      const col = p.kind === 'classd' ? '#d4761f' : (p.kind === 'guard' ? '#5aa8e0' : '#cfe0e8');
      const nm = p.kind === 'classd' ? 'D级' : (p.kind === 'guard' ? '保安' : '研究员');
      mark(p.pos.x, p.pos.z, col, 3.2, nm, 'circle');
    }
  }
  if (typeof FACTION_LIST !== 'undefined') {
    for (const f of FACTION_LIST) {
      if (!f.alive) continue;
      mark(f.pos.x, f.pos.z, f.kind === 'ci' ? '#a03a2a' : '#6a9a4a', 3.6,
        f.kind === 'ci' ? 'CI' : 'SH', 'circle');
    }
  }
  // 净化行动：被感染者
  if (typeof INFECTED !== 'undefined') {
    for (const m of INFECTED) if (m.alive) mark(m.pos.x, m.pos.z, '#8adf3a', 3.0, '', 'circle');
  }
  mark(player.pos.x, player.pos.z, '#4ad8a0', 6, '', 'tri');
  // 指北
  c.fillStyle = 'rgba(224,182,74,.75)'; c.font = '12px Consolas, monospace'; c.textAlign = 'left';
  c.fillText('N ↑', pad + 4, pad + 12);
}

/* ---------------------------------------------------------------------
   面板开关
   --------------------------------------------------------------------- */
function toggleBigMap() {
  bigMapOpen = !bigMapOpen;
  const e = el('bigMap');
  if (e) e.classList.toggle('hidden', !bigMapOpen);
  if (bigMapOpen) drawBigMap();
}
function toggleObjPanel() {
  objPanelOpen = !objPanelOpen;
  const e = el('objPanel');
  if (e) e.classList.toggle('hidden', !objPanelOpen);
  if (objPanelOpen) renderObjPanel();
  if (pointerLocked) exitLock();
  else if (!objPanelOpen) requestLock();
}
function renderObjPanel() {
  const st = objectiveStatus();
  const objs = currentObjectives();
  const farm = GAME.mission === 'contain096';
  let s = '<div class="opSection"><h3>行 动 目 标 · ' + currentMission().name + '</h3>';
  if (!farm) {
    const r = roleView();
    s += '<div class="opCard"><div class="ocHead"><span>你的身份</span><span class="ocObj">你是 ' + r.name + '</span></div>'
      + '<div class="ocBody">' + r.desc + '</div>'
      + '<div class="ocHint">▸ 阵营：' + r.faction + ' · 目标：' + r.goal + '</div></div>';
  }
  for (const o of objs) {
    const state = st[o.id];
    s += '<div class="opCard' + (state === 'done' ? ' done' : '') + '">'
      + '<div class="ocHead"><span>' + o.title + '</span><span class="ocObj">' + (state === 'done' ? '完成' : state === 'active' ? '进行中' : '未开始') + '</span></div>'
      + '<div class="ocBody">' + o.desc + '</div>'
      + (o.detail ? '<div class="ocHint">' + o.detail + '</div>' : '')
      + '</div>';
  }
  s += '</div><div class="opSection"><h3>威 胁 图 鉴</h3>';
  const list = farm ? ['096'] : SCP_ORDER;
  for (const key of list) {
    const d = SCP_DEFS[key];
    const s2 = SCP_LIST.find(v => v.key === key);
    const done = farm ? (s2 && s2.hooded) : !!GAME.contained[key];
    s += '<div class="opCard' + (done ? ' done' : '') + '">'
      + '<div class="ocHead"><span>' + d.name + ' · ' + d.cn + '</span><span class="ocObj ' + d.obj.toLowerCase() + '">' + d.obj + '</span></div>'
      + '<div class="ocBody">' + d.lore + '</div>'
      + '<div class="ocHint">▸ ' + d.hint + '</div>'
      + (key === '096' ? '<div class="ocHint">▸ 收容方式：靠近后长按 [F] 戴上收容头套 —— 它免疫一切伤害，打不死</div>' : '')
      + (s2 && s2.hooded ? '<div class="ocBody" style="color:#4ad8a0">状态：收容头套已就位 · 目标失能</div>' : '')
      + (s2 && s2.alive && !d.immortal ? '<div class="ocBody" style="color:#8a9298">HP ' + Math.max(0, Math.round(s2.hp)) + ' / ' + s2.maxHp + '</div>' : '')
      + '</div>';
  }
  s += '</div>';
  if (!farm && typeof FACTION_DEFS !== 'undefined') {
    const dep = FACTION_STATE.ciSpawned || FACTION_STATE.handSpawned;
    s += '<div class="opSection"><h3>入 侵 势 力 · ' + (dep ? '已突入' : '尚未出现') + '</h3>';
    for (const id of ['ci', 'hand']) {
      const d = FACTION_DEFS[id];
      const on = id === 'ci' ? FACTION_STATE.ciSpawned : FACTION_STATE.handSpawned;
      const alive = factionAlive(id);
      s += '<div class="opCard' + (on && alive === 0 ? ' done' : '') + '">'
        + '<div class="ocHead"><span>' + d.name + '</span><span class="ocObj">'
        + (!on ? '未出现' : alive > 0 ? '存活 ' + alive + ' 人' : '已肃清') + '</span></div>'
        + '<div class="ocBody">' + (id === 'ci'
          ? '从基金会叛出的武装力量，装备精良。他们不是来收容的 —— 见到 MTF 就开火。'
          : '信奉「异常应当自由」的地下组织。他们不打阵地战，目标是跑进收容间把异常放出来。')
        + '</div>'
        + '<div class="ocHint">▸ ' + (id === 'ci'
          ? '部署时间：行动开始后 5 分钟 · 从重收电梯厅突入'
          : '部署时间：混沌分裂者入场后 1 分钟 · 按威胁由低到高逐个放逐异常')
        + '</div>'
        + '</div>';
    }
    s += '</div>';
  }
  if (!farm && typeof PERSONNEL_LIST !== 'undefined' && PERSONNEL_LIST.length) {
    const dAlive = personnelAlive('classd'), sAlive = personnelAlive('scientist'), gAlive = personnelAlive('guard');
    s += '<div class="opSection"><h3>设 施 幸 存 人 员</h3>';
    s += '<div class="opCard"><div class="ocHead"><span>D 级人员</span><span class="ocObj">'
      + '在场 ' + dAlive + ' · 已逃脱 ' + GAME.classdEscaped + '</span></div>'
      + '<div class="ocBody">混沌分裂者阵营，没有武器，只想逃出去。放他们跑到入口大堂，'
      + '就会把设施情报带出去 —— <b>混沌分裂者提前 70 秒突入</b>。想拦住只能开枪。</div></div>';
    s += '<div class="opCard"><div class="ocHead"><span>研究员</span><span class="ocObj">'
      + '在场 ' + sAlive + ' · 已护送 ' + GAME.rescued.scientist + '</span></div>'
      + '<div class="ocBody">靠到 4 米内会自动跟随。带到入口大堂撤离 → '
      + '<b>对异常伤害 ×2（可叠加）</b>，本人转为队友驻守门口。</div></div>';
    s += '<div class="opCard"><div class="ocHead"><span>设施保安</span><span class="ocObj">'
      + '在场 ' + gAlive + ' · 已护送 ' + GAME.rescued.guard + '</span></div>'
      + '<div class="ocBody">同上，护送到入口大堂撤离 → '
      + '<b>对异常与对敌对伤害都 ×2（可叠加）</b>。</div></div>';
    s += '<div class="opCard done"><div class="ocHead"><span>当前伤害加成</span><span class="ocObj">'
      + '异常 ×' + GAME.bonusAnomaly + ' · 敌对 ×' + GAME.bonusHostile + '</span></div></div>';
    s += '</div>';
  }
  if (PHOTOS.length) {
    const left = PHOTOS.filter(p => !p.done).length;
    s += '<div class="opSection"><h3>' + (farm ? '现 场 照 片' : '收 容 档 案 照 片') + ' · ' + left + ' / ' + PHOTOS.length + ' 未销毁</h3>';
    for (const p of PHOTOS) {
      s += '<div class="opCard' + (p.done ? ' done' : '') + '">'
        + '<div class="ocHead"><span>' + p.where + '</span><span class="ocObj">' + (p.done ? '已划掉' : '未处理') + '</span></div>'
        + '<div class="ocBody">坐标 ' + Math.round(p.x) + ', ' + Math.round(p.z) + '</div>'
        + '</div>';
    }
    s += '</div>';
  }
  html('opBody', s);
}

/* ---------------------------------------------------------------------
   暂停
   --------------------------------------------------------------------- */
function showPauseOverlay(on) {
  const e = el('pauseOverlay');
  if (!e) return;
  e.classList.toggle('hidden', !on);
  GAME.paused = on;
  if (typeof AudioSys !== 'undefined' && AudioSys.setPaused) AudioSys.setPaused(on);
  if (on) {
    const s = el('pauseStats');
    if (s) {
      s.innerHTML =
        '<div class="stRow"><span>击杀</span><b>' + player.kills + '</b></div>'
        + '<div class="stRow"><span>已收容</span><b>' + Object.keys(GAME.contained).length + ' / ' + SCP_ORDER.length + '</b></div>'
        + '<div class="stRow"><span>命中率</span><b>' + (player.shots ? Math.round(player.hits / player.shots * 100) : 0) + '%</b></div>'
        + '<div class="stRow"><span>行动时间</span><b>' + Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒</b></div>';
    }
  }
}
function togglePause() {
  if (GAME.over) return;
  const willPause = !GAME.paused;
  showPauseOverlay(willPause);
  if (willPause) exitLock(); else requestLock();
}

bootMark('hud');
