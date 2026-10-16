'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  14 菜单 / 配装 / 改装工坊
   ===================================================================== */

let modTabSel = { primary: 'optic', secondary: 'optic' };
let selectedPreset = 0;

function initMenus() {
  // 主菜单导航
  document.querySelectorAll('.navBtn').forEach(b => {
    b.addEventListener('click', () => {
      AudioSys.uiClick();
      const p = b.dataset.p;
      hide('mHome');
      show(p);
      if (p === 'mLoadout') { renderLoadout(); }
      if (p === 'mBrief') renderBrief();
      if (p === 'mCodex') renderCodex();
      if (p === 'mSet') syncSettingsUI();
    });
  });
  document.querySelectorAll('.backBtn').forEach(b => {
    b.addEventListener('click', () => {
      AudioSys.uiBack();
      document.querySelectorAll('.mSub').forEach(s => s.classList.add('hidden'));
      show('mHome');
    });
  });

  // 画质
  document.querySelectorAll('.qualBtn').forEach(b => {
    b.addEventListener('click', () => {
      SETTINGS.quality = parseInt(b.dataset.q, 10);
      try { localStorage.setItem('scprx_quality', String(SETTINGS.quality)); } catch (e) { }
      document.querySelectorAll('.qualBtn').forEach(x => x.classList.toggle('sel', x === b));
      applyQuality();
      AudioSys.uiClick();
    });
  });
  // 灵敏度 / FOV / 音量 / 抖动
  bindRange('sensRange', 'sensVal', v => { SETTINGS.sens = v / 100; return (v / 100).toFixed(2); }, 'scprx_sens', v => v / 100);
  bindRange('fovRange', 'fovVal', v => { SETTINGS.fov = v; camera.fov = v; camera.updateProjectionMatrix(); return String(v); }, 'scprx_fov', v => v);
  bindRange('volRange', 'volVal', v => { AudioSys.setVol(v / 100); return String(v); }, 'scprx_vol', v => v / 100);
  bindRange('shakeRange', 'shakeVal', v => { SETTINGS.shake = v / 100; return v + '%'; }, null, null);
  // 开镜方式
  const adsBtn = el('adsBtn');
  if (adsBtn) adsBtn.addEventListener('click', () => {
    SETTINGS.adsToggle = !SETTINGS.adsToggle;
    try { localStorage.setItem('scprx_adsmode', SETTINGS.adsToggle ? 'toggle' : 'hold'); } catch (e) { }
    adsBtn.textContent = SETTINGS.adsToggle ? '切换瞄准' : '按住瞄准';
    AudioSys.uiClick();
  });
  // 自适应分辨率
  const adBtn = el('adaptiveBtn');
  if (adBtn) adBtn.addEventListener('click', () => {
    SETTINGS.adaptive = !SETTINGS.adaptive;
    try { localStorage.setItem('scprx_adaptive', SETTINGS.adaptive ? '1' : '0'); } catch (e) { }
    adBtn.textContent = SETTINGS.adaptive ? '开' : '关';
    adBtn.classList.toggle('sel', SETTINGS.adaptive);
    AudioSys.uiClick();
  });
  // 夜视配色
  document.querySelectorAll('.nvgBtn').forEach(b => {
    b.addEventListener('click', () => {
      SETTINGS.nvgMode = b.dataset.n;
      try { localStorage.setItem('scprx_nvg', SETTINGS.nvgMode); } catch (e) { }
      document.querySelectorAll('.nvgBtn').forEach(x => x.classList.toggle('sel', x === b));
      NVG.apply();
      AudioSys.uiClick();
    });
  });

  // 配装
  el('deployGo').addEventListener('click', () => {
    AudioSys.uiClick();
    startDeployment();
  });

  // 暂停菜单
  el('pResume').addEventListener('click', () => { AudioSys.uiBack(); showPauseOverlay(false); requestLock(); });
  // ⚠️ 放弃行动要 skipRebirth：复活是无限次的，不跳过的话点"放弃"会被立刻重新部署，
  //    玩家永远退不出这一局。
  el('pAbort').addEventListener('click', () => { AudioSys.uiBack(); showPauseOverlay(false); endGame(false, '行动中止', true); });
  el('pSettings').addEventListener('click', () => { AudioSys.uiClick(); toast('设置请返回主菜单调整', 2200, 'warn'); });

  // 结算
  el('endRetry').addEventListener('click', () => { AudioSys.uiClick(); restartGame(); });
  el('endMenu').addEventListener('click', () => { AudioSys.uiBack(); hide('endScreen'); GAME.phase = 'menu'; show('menuScreen'); hide('mHome') === undefined; document.querySelectorAll('.mSub').forEach(s => s.classList.add('hidden')); show('mHome'); });

  syncSettingsUI();
}

function bindRange(rangeId, valId, apply, storeKey, storeVal) {
  const r = el(rangeId), v = el(valId);
  if (!r) return;
  r.addEventListener('input', () => {
    const n = parseFloat(r.value);
    const label = apply(n);
    if (v) v.textContent = label;
    if (storeKey) { try { localStorage.setItem(storeKey, String(storeVal ? storeVal(n) : n)); } catch (e) { } }
  });
}
function syncSettingsUI() {
  const set = (id, val) => { const e = el(id); if (e) e.value = String(val); };
  set('sensRange', Math.round(SETTINGS.sens * 100)); txt('sensVal', SETTINGS.sens.toFixed(2));
  set('fovRange', SETTINGS.fov); txt('fovVal', String(SETTINGS.fov));
  set('volRange', Math.round(SETTINGS.vol * 100)); txt('volVal', String(Math.round(SETTINGS.vol * 100)));
  set('shakeRange', Math.round(SETTINGS.shake * 100)); txt('shakeVal', Math.round(SETTINGS.shake * 100) + '%');
  document.querySelectorAll('.qualBtn').forEach(x => x.classList.toggle('sel', parseInt(x.dataset.q, 10) === SETTINGS.quality));
  document.querySelectorAll('.nvgBtn').forEach(x => x.classList.toggle('sel', x.dataset.n === SETTINGS.nvgMode));
  const ab = el('adsBtn'); if (ab) ab.textContent = SETTINGS.adsToggle ? '切换瞄准' : '按住瞄准';
  const adb = el('adaptiveBtn');
  if (adb) { adb.textContent = SETTINGS.adaptive ? '开' : '关'; adb.classList.toggle('sel', SETTINGS.adaptive); }
  const ph = el('perfHint');
  if (ph && typeof QUALITY_TABLE !== 'undefined') {
    const q = QUALITY_TABLE[SETTINGS.quality] || QUALITY_TABLE[1];
    ph.textContent = '渲染像素比上限 ' + q.pr.toFixed(2) + '× · 动态点光 ' + q.lights + ' 盏 · 阴影已关闭（场景无接收体，纯浪费）';
  }
}

/* ---------------------------------------------------------------------
   简报
   --------------------------------------------------------------------- */
function renderBrief() {
  html('briefBox',
    '<h3>■ 事 件 概 述</h3>'
    + '<div>Site-19 地下收容设施于 <span class="hi">03:41</span> 发生主变压器跳闸，备用电源在 <span class="hi">7 分钟</span>内被耗尽。'
    + '同一时间，全部 9 个高优先级收容间的电磁锁失效。设施内约 <span class="hi">40 名</span>研究人员与安保人员失联。</div>'
    + '<div class="rule">你是 MTF <b>Nu-7「落锤」</b>（Hammer Down）的一名操作员。Nu-7 的编制是营级规模的重武装特遣队，'
    + '专门处理大规模收容失效。你所在的小队共 4 人 —— 你是唯一被派进去的那个，另外 3 名队员会在你身后跟进。</div>'
    +     '<h3>■ 任 务 链</h3>'
    + '<div>1. <b>恢复供电</b>：三处配电箱分布在三个分区 —— 办公区安保站（PWR-A）、'
    + '轻收容区实验室（PWR-B）、重收容区电磁炮房（PWR-C），逐一长按 [F] 合闸。</div>'
    + '<div>2. <b>启动收容协议</b>：回到办公区「设施总控室」，在总控台上传协议。'
    + '协议上线后 HID 收容装置开始充能，你对所有 SCP 造成的伤害<b>翻倍</b>。</div>'
    + '<div>3. <b>销毁泄漏的收容档案</b>：设施里散落着 <b>6 张</b>拍到 SCP-096 面部的档案照片，'
    + '分布在办公区办公桌 / 安保站监控台 / 研究员办公室资料柜 / 实验室实验台 / '
    + '重收武器库缴获物箱 / 仓库 A 木箱上，逐一长按 [F] 划掉。'
    + '<b>盯着照片看超过 3 秒会把 SCP-096「看」暴走。</b></div>'
    + '<div>4. <b>清剿 / 收容</b>：9 只收容物必须全部停止活动。注意每一只都有自己的弱点。</div>'
    + '<div>5. <b>清除入侵势力</b>：行动开始 <b>5 分钟</b>后<b>混沌分裂者</b>从重收电梯厅突入（5 人，见到 MTF 就开火）；'
    + '<b>1 分钟</b>后<b>蛇之手</b>跟进（3 人），他们会跑到已收容异常的收容间，'
    + '按威胁等级<b>从低到高</b>把异常重新放出来 —— 先 173 / 966，最后 682。'
    + '全灭他们才能止住放逐。</div>'
    + '<div>6. <b>撤离</b>：清剿、档案销毁与入侵势力清除都完成后，回到入口大堂的地表电梯，长按 [F] 升井。</div>'
    + '<h3>■ 设 施 布 局</h3>'
    + '<div class="rule">'
    + '<b>办公区</b>（南）—— 入口大堂 · 地表电梯 · 玻璃房 · 咖啡休息区 · MTF 弹药库 · '
    + '办公区 · 设施总控室 · 安保站<br>'
    + '<b>轻收容区</b>（中）—— SCP-173 / 096 / 966 收容间 · 实验室 · 弹药库 · 手枪库<br>'
    + '<b>重收容区</b>（北）—— SCP-682 / 106 / 939 / 076-2 / 3114 / 049 收容间 · '
    + '电磁炮房 · 重收武器库 · 仓库 A/B · 核弹控制室 · 重收电梯厅'
    + '</div>'
    + '<div>三个分区由中央主廊与两侧横向走廊串联，门禁为感应式气密门（靠近自动开启）。</div>'
    + '<h3>■ 可 选 目 标</h3>'
    + '<div>· <b>核弹开关</b>（重收容区 · 核弹控制室）：触发 EMP 脉冲，让全场收容物僵直 14 秒。</div>'
    + '<div>· <b>咖啡机</b>（办公区 · 咖啡休息区）：恢复 15 HP、体力与精神。</div>'
    + '<h3>■ 关 键 提 示</h3>'
    + '<div>· <b>SCP-173</b> 只有在你注视它的时候才会冻结 —— 而冻结时它才会被子弹击伤。'
    + '但你无法不眨眼。每次眨眼，它都会前进。</div>'
    + '<div>· <b>SCP-096</b> <b>免疫一切伤害，打不死</b> —— 唯一的收容方式是走到它身边长按 [F] 给它戴上收容头套。'
    + '平时它很温顺，但直视它的脸 0.7 秒会让它暴走，然后以 21 m/s 冲过来；'
    + '除非你佩戴的是 <b>Project SCRAMBLE</b>：它会把 096 的面部实时打码，让它认不出你。</div>'
    + '<div>· <b>SCP-966</b> 肉眼不可见，按 [N] 开启头戴装置才能在红外波段看到它。它会持续剥夺你的睡眠。</div>'
    + '<div>· <b>SCP-939</b> 没有眼睛，靠声音捕猎。蹲下慢行可以摆脱它；战术手电的强光能让它僵直。</div>'
    + '<div>· <b>SCP-049</b> 触碰即死，并且会把你队友的尸体变成 SCP-049-2。</div>'
    + '<div>· <b>SCP-106</b> 会穿墙，只有铅能阻挡它。 <b>SCP-682</b> 血量极高，建议用 M249 或等协议上线后再打。</div>'
    + '<div class="rule">祝好运，操作员。Nu-7 没有第二次机会。</div>'
  );
}

/* ---------------------------------------------------------------------
   图鉴
   --------------------------------------------------------------------- */
function renderCodex() {
  let s = '';
  for (const key of SCP_ORDER) {
    const d = SCP_DEFS[key];
    s += '<div class="codexCard">'
      + '<div class="ccHead"><span class="ccName">' + d.name + '</span><span class="ccCls ' + d.obj.toLowerCase() + '">' + d.obj + '</span></div>'
      + '<div class="ccCn">' + d.cn + ' · ' + (ZONES[d.spawnZone] ? ZONES[d.spawnZone].name : d.spawnZone) + '</div>'
      + '<div class="ccLore">' + d.lore + '</div>'
      + '<div class="ccHint">▸ ' + d.hint + '</div>'
      + '</div>';
  }
  html('codexGrid', s);
}

/* ---------------------------------------------------------------------
   配装
   --------------------------------------------------------------------- */
function renderLoadout() {
  renderMissions();
  renderPresets();
  renderArmorRow();
  renderStats();
  renderModTabs('primary');
  renderModTabs('secondary');
  renderModList('primary');
  renderModList('secondary');
}

/* 行动（任务）选择：落锤行动 / 收容行动 */
function renderMissions() {
  const box = el('missionRow');
  if (!box) return;
  // 首次进入时先抽一次角色（URL 带 ?role= 则固定该角色，不再随机）
  if (!GAME.roleRolled) {
    const forced = (typeof forcedRoleFromURL === 'function') ? forcedRoleFromURL() : null;
    GAME.roleForced = !!forced;
    GAME.role = forced || (GAME.mission === 'contain096' ? 'mtf' : rollRole());
    GAME.roleRolled = true;
  }
  let s = '';
  for (const id of MISSION_ORDER) {
    const m = MISSIONS[id];
    if (!m) continue;
    s += '<div class="presetCard' + (GAME.mission === id ? ' sel' : '') + '" data-m="' + id + '">'
      + '<div class="pcTop"><span class="pcName">' + m.name + '</span><span class="pcCode">' + m.tag + '</span></div>'
      + '<div class="pcWpn">' + m.sub + '</div>'
      + '</div>';
  }
  box.innerHTML = s;
  box.querySelectorAll('.presetCard').forEach(c => {
    c.addEventListener('click', () => {
      AudioSys.uiClick();
      GAME.mission = c.dataset.m;
      // 换行动就重抽角色（收容行动是既定的 MTF 任务；URL 固定角色时也不重抽）
      if (!GAME.roleForced) {
        GAME.role = GAME.mission === 'contain096' ? 'mtf' : rollRole();
      } else if (GAME.mission === 'contain096') {
        GAME.role = 'mtf';
      }
      GAME.roleRolled = true;
      renderMissions();
    });
  });
  const m = currentMission();
  const desc = el('missionDesc');
  const role = currentRole();
  if (desc) {
    desc.innerHTML = '<b>' + m.name + '</b> · ' + m.sub
      + '<span class="gh">' + m.desc + '</span>'
      + (GAME.mission === 'contain096'
        ? '<span class="gwarn">▸ 提示：SCP-096 处于温顺状态，直视它的脸会让它暴走。'
        + '靠近后长按 [F] 戴收容头套，再把现场 6 张照片逐一划掉。</span>'
        : GAME.mission === 'fivek'
          ? '<span class="gwarn">▸ 本行动里你的<b>身份照常随机分配</b>；抽到 MTF 时，'
          + '这一局的编制位就是 <b>Nu-22「火箭侠」</b>（任务从"收容"改成"净化"）；'
          + '也可能抽到 <b>反叛之狐</b> —— 九尾狐麾下拒绝执行净化令的那一支，'
          + '任务是把 SCP-1440 处决掉并清除 Nu-22（<b>会延迟 60 秒突入</b>）。'
          + '<br>抽到 Nu-22 时站点全员抵抗；抽到反叛之狐时与保安、科学家同阵营。</span>'
          // ⚠️ 刻意不在菜单里透露本局抽到了谁 —— 身份在落地那一刻才揭晓（局内显示「你是 XXX」）
          : '<span class="gwarn">▸ 本局身份在落地瞬间随机分配 —— 抽到谁就是谁，没有重抽。'
          + '<br>配装只对「MTF Nu-7」生效；抽到其他身份时按各自的规则武装。</span>');
  }

  // 配装区：只对 MTF 生效时灰掉（不透露具体抽到了谁）
  const dim = GAME.mission !== 'contain096' && role.loadout !== 'custom';
  const custom = el('loadoutCustom'), right = el('loadoutRight');
  if (custom) custom.classList.toggle('loadoutDisabled', dim);
  if (right) right.classList.toggle('loadoutDisabled', dim);
}

function applyPreset(i) {
  selectedPreset = i;
  const p = LOADOUT_PRESETS[i];
  LOADOUT.preset = p.id;
  LOADOUT.primary = p.primary;
  LOADOUT.secondary = p.secondary;
  LOADOUT.armor = p.armor;
  LOADOUT.mods.primary = Object.assign({}, p.defaultMods);
  LOADOUT.mods.secondary = { optic: 'iron', muzzle: 'none_muzzle', mag: 'std', laser: 'none_laser' };
  modTabSel.primary = 'optic'; modTabSel.secondary = 'optic';
}

function renderPresets() {
  const box = el('presetRow');
  if (!box) return;
  if (!box._init) { applyPreset(0); box._init = true; }
  let s = '';
  LOADOUT_PRESETS.forEach((p, i) => {
    const pri = WPN_DEFS[p.primary], sec = WPN_DEFS[p.secondary];
    s += '<div class="presetCard' + (i === selectedPreset ? ' sel' : '') + '" data-i="' + i + '">'
      + '<div class="pcTop"><span class="pcName">' + p.name + '</span><span class="pcCode">' + p.code + '</span></div>'
      + '<div class="pcWpn">' + pri.name + ' + ' + sec.name + '</div>'
      + '<div class="pcDesc">' + p.desc + '</div>'
      + '</div>';
  });
  box.innerHTML = s;
  box.querySelectorAll('.presetCard').forEach(c => {
    c.addEventListener('click', () => {
      AudioSys.uiClick();
      applyPreset(parseInt(c.dataset.i, 10));
      renderPresets(); renderArmorRow(); renderStats(); renderModList('primary'); renderModList('secondary');
    });
  });
}

function renderArmorRow() {
  const box = el('armorRow');
  if (!box) return;
  let s = '';
  for (const a of ARMOR_DEFS) {
    s += '<button class="optBtn armorBtn' + (a.id === LOADOUT.armor ? ' sel' : '') + '" data-i="' + a.id + '">'
      + a.name + (a.resist ? ' · 减伤 ' + Math.round(a.resist * 100) + '%' : '') + '</button>';
  }
  box.innerHTML = s;
  box.querySelectorAll('.armorBtn').forEach(b => {
    b.addEventListener('click', () => {
      AudioSys.uiClick();
      LOADOUT.armor = parseInt(b.dataset.i, 10);
      renderArmorRow(); renderStats();
    });
  });
  renderGearRow();
}

/* 头戴视觉增强装置：夜视仪 / Project SCRAMBLE / 不携带 —— 三选一，同一个槽位 */
function renderGearRow() {
  const box = el('gearRow');
  if (!box) return;
  const order = ['nvg', 'scramble', 'none'];
  let s = '';
  for (const id of order) {
    const g = GEAR_DEFS[id];
    if (!g) continue;
    const tag = id === 'nvg' ? ' · 看 SCP-966 必需'
      : id === 'scramble' ? ' · 免疫 SCP-096 暴走' : '';
    s += '<button class="optBtn gearBtn' + (LOADOUT.gear === id ? ' sel' : '') + '" data-g="' + id + '">'
      + g.name + tag + '</button>';
  }
  box.innerHTML = s;
  box.querySelectorAll('.gearBtn').forEach(b => {
    b.addEventListener('click', () => {
      AudioSys.uiClick();
      LOADOUT.gear = b.dataset.g;
      renderGearRow(); renderStats();
    });
  });
  const d = GEAR_DEFS[LOADOUT.gear] || GEAR_DEFS.none;
  const desc = el('gearDesc');
  if (desc) {
    desc.innerHTML = '<b>' + d.name + '</b> · ' + d.desc
      + (d.hint ? '<span class="gh">▸ ' + d.hint + '</span>' : '')
      + (LOADOUT.gear === 'nvg' ? '<span class="gwarn">▸ 注意：夜视仪挡不住 SCP-096 的面部识别 —— 直视它的脸仍然会暴走</span>' : '')
      + (LOADOUT.gear === 'none' ? '<span class="gwarn">▸ 注意：SCP-966 将完全不可见，SCP-096 也会正常暴走</span>' : '');
  }
}

function statBar(name, pct, valTxt) {
  return '<div class="statRow"><span class="sName">' + name + '</span>'
    + '<span class="sBarWrap"><span class="sBar" style="width:' + clamp(pct, 0, 1) * 100 + '%"></span></span>'
    + '<span class="sVal">' + valTxt + '</span></div>';
}

function renderStats() {
  const box = el('statBox');
  if (!box) return;
  const st = computeWeaponStats(LOADOUT.primary, LOADOUT.mods.primary);
  const sec = computeWeaponStats(LOADOUT.secondary, LOADOUT.mods.secondary);
  const ar = ARMOR_DEFS[clamp(LOADOUT.armor, 0, 3)];
  const dps = (st.dmg * st.rpm / 60).toFixed(0);
  let s = '<div style="font-size:12px;color:#e2e8ee;margin-bottom:6px">' + st.name + ' · ' + st.cls + '</div>';
  s += statBar('伤害', st.dmg / 60, st.dmg);
  s += statBar('射速', st.rpm / 1200, st.rpm + ' RPM');
  s += statBar('理论 DPS', dps / 1400, dps);
  s += statBar('精度', 1 - clamp(st.spreadAds / 3, 0, 1), (1 - clamp(st.spreadAds / 3, 0, 1) * 100).toFixed(0) + '%');
  s += statBar('后坐控制', 1 - clamp(st.recoil / 3, 0, 1), (1 - clamp(st.recoil / 3, 0, 1) * 100).toFixed(0) + '%');
  s += statBar('机动性', (st.mobility - 0.7) / 0.5, st.mobility.toFixed(2) + '×');
  s += statBar('弹容量', st.mag / 110, st.mag + ' 发');
  s += '<div style="font-size:11px;color:#7e8891;margin-top:8px">备用弹药 ' + st.reserve + ' 发 · 换弹 ' + st.reload.toFixed(2) + 's · 穿透 ' + st.pen.toFixed(2) + '</div>';
  s += '<div style="font-size:11px;color:#7e8891;margin-top:4px">护甲：' + ar.name + (ar.resist ? '（减伤 ' + Math.round(ar.resist * 100) + '%，耐久 ' + ar.hp + '）' : '') + '</div>';
  s += '<div style="font-size:11px;color:#7e8891;margin-top:4px">副武器：' + sec.name + ' · ' + sec.mag + ' 发 / 备弹 ' + sec.reserve + '</div>';
  const gd = GEAR_DEFS[LOADOUT.gear] || GEAR_DEFS.none;
  s += '<div style="font-size:11px;color:#7e8891;margin-top:4px">头戴装置：' + gd.name
    + (LOADOUT.gear === 'scramble' ? '（夜视 + 免疫 SCP-096 面部识别）'
      : LOADOUT.gear === 'nvg' ? '（夜视 · 可让 SCP-966 显形）' : '') + '</div>';
  box.innerHTML = s;
}

function renderModTabs(which) {
  const box = el(which === 'primary' ? 'modTabs' : 'modTabs2');
  if (!box) return;
  const wpnId = which === 'primary' ? LOADOUT.primary : LOADOUT.secondary;
  const def = WPN_DEFS[wpnId];
  let s = '';
  for (const slot of def.slots) {
    const ms = MOD_SLOTS[slot];
    s += '<button class="modTab' + (modTabSel[which] === slot ? ' sel' : '') + '" data-slot="' + slot + '">'
      + '<span class="mtIco">' + ms.icon + '</span>' + ms.name + '</button>';
  }
  box.innerHTML = s;
  box.querySelectorAll('.modTab').forEach(b => {
    b.addEventListener('click', () => {
      AudioSys.uiClick();
      modTabSel[which] = b.dataset.slot;
      renderModTabs(which); renderModList(which);
    });
  });
}

function renderModList(which) {
  const box = el(which === 'primary' ? 'modList' : 'modList2');
  if (!box) return;
  const wpnId = which === 'primary' ? LOADOUT.primary : LOADOUT.secondary;
  const def = WPN_DEFS[wpnId];
  const slot = modTabSel[which];
  if (def.slots.indexOf(slot) < 0) { modTabSel[which] = def.slots[0]; }
  const s2 = modTabSel[which];
  const cur = LOADOUT.mods[which][s2];
  let s = '';
  for (const mid of MOD_CHOICES[s2]) {
    const m = MOD_DEFS[mid];
    if (!m) continue;
    const isDefault = (s2 === 'optic' && mid === 'iron') || (s2 === 'muzzle' && mid === 'none_muzzle')
      || (s2 === 'grip' && mid === 'none_grip') || (s2 === 'mag' && mid === 'std')
      || (s2 === 'laser' && mid === 'none_laser') || (s2 === 'stock' && mid === 'stock_std');
    const sel = (cur ? cur === mid : isDefault);
    s += '<div class="modItem' + (sel ? ' sel' : '') + '" data-mid="' + mid + '">'
      + '<div class="miName">' + m.name + '</div>'
      + '<div class="miDesc">' + m.desc + '</div>'
      + '</div>';
  }
  box.innerHTML = s;
  box.querySelectorAll('.modItem').forEach(b => {
    b.addEventListener('click', () => {
      AudioSys.uiClick();
      LOADOUT.mods[which][s2] = b.dataset.mid;
      renderModList(which); renderStats();
    });
  });
}

/* ---------------------------------------------------------------------
   开始部署
   --------------------------------------------------------------------- */
function startDeployment() {
  // 补全默认改装
  const p = WPN_DEFS[LOADOUT.primary];
  for (const slot of p.slots) {
    if (!LOADOUT.mods.primary[slot]) {
      LOADOUT.mods.primary[slot] = slot === 'optic' ? 'iron' : slot === 'muzzle' ? 'none_muzzle'
        : slot === 'grip' ? 'none_grip' : slot === 'mag' ? 'std' : slot === 'laser' ? 'none_laser' : 'stock_std';
    }
  }
  const s = WPN_DEFS[LOADOUT.secondary];
  for (const slot of s.slots) {
    if (!LOADOUT.mods.secondary[slot]) {
      LOADOUT.mods.secondary[slot] = slot === 'optic' ? 'iron' : slot === 'muzzle' ? 'none_muzzle'
        : slot === 'grip' ? 'none_grip' : slot === 'mag' ? 'std' : slot === 'laser' ? 'none_laser' : 'stock_std';
    }
  }
  hide('menuScreen');
  // 每次部署都重新抽身份 —— 重开对局不用再 F5（收容行动固定 MTF；URL 固定角色时除外）
  rerollRole();
  startGame();
}

bootMark('menus');
