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
  st.power = bn >= 3 ? 'done' : 'active';
  st.protocol = GAME.protocol ? 'done' : (bn >= 3 ? 'active' : 'pending');
  // 档案销毁与清剿并行：协议上传后就可以开始清理照片
  st.photos = left === 0 ? 'done' : (GAME.protocol ? 'active' : 'pending');
  const doneN = Object.keys(GAME.contained).length;
  st.purge = (GAME.protocol && doneN >= SCP_ORDER.length) ? 'done' : (GAME.protocol ? 'active' : 'pending');
  st.extract = (st.purge === 'done' && left === 0) ? 'active' : 'pending';
  return st;
}

/* 撤离点是否已解锁 */
function extractReady() {
  if (GAME.mission === 'contain096') {
    const s = SCP_LIST.find(v => v.key === '096');
    const left = PHOTOS.filter(p => !p.done).length;
    return !!(s && s.hooded) && left === 0;
  }
  return GAME.protocol && Object.keys(GAME.contained).length >= SCP_ORDER.length
    && PHOTOS.every(p => p.done);
}

/* ---------- 收容行动：戴上头套 ---------- */
function hoodSCP096() {
  const s = SCP_LIST.find(v => v.key === '096');
  if (!s || s.hooded) return;
  s.hooded = true;
  s.enraged = false;
  s.rageT = 0;
  s.state = 'contained';
  if (s.model.hood) s.model.hood.visible = true;
  if (s.model.scrambleQuad) s.model.scrambleQuad.visible = false;
  AudioSys.beep(true);
  AudioSys.killConfirm();
  broadcast('◤ SCP-096 收容头套已就位 · 目标失去视觉');
  subtitle('收容头套已戴上', 'SCP-096 再也看不见了 —— 它不会再暴走', 4400);
  toast('目标已失能 · 下一步：销毁现场全部照片', 4000, 'good');
  killfeed('SCP-096 已收容', 'good');
  GAME.alarmLevel = 1;
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
  killfeed(s.name + ' 已停止活动', 'good');
  const doneN = Object.keys(GAME.contained).length;
  if (doneN >= SCP_ORDER.length) {
    GAME.alarmLevel = 1;
    broadcast('◤ 全部收容物已停止活动 · 前往入口大厅撤离');
    subtitle('设施已清理', '前往入口大厅的撤离电梯', 4000);
  } else {
    broadcast('◤ 收容进度 ' + doneN + ' / ' + SCP_ORDER.length);
  }
}

function onExtractionDone() {
  if (GAME.over) return;
  endGame(true, '成功撤离');
}

function onPlayerDeath(attacker, o) {
  if (GAME.over) return;
  const cause = o && o.cause ? o.cause : (attacker ? (attacker.name || '未知收容物') : '未知原因');
  killfeed('你被 ' + cause + ' 击倒', 'bad');
  AudioSys.stopAmbient();
  setTimeout(() => { endGame(false, cause); }, 2200);
}

/* ---------------------------------------------------------------------
   结束
   --------------------------------------------------------------------- */
function endGame(won, reason) {
  if (GAME.over) return;
  GAME.over = true;
  GAME.won = won;
  GAME.phase = 'over';
  exitLock();
  hide('pauseOverlay');
  AudioSys.stopAmbient();
  const t = el('endTitle');
  t.textContent = won ? (GAME.mission === 'contain096' ? '收 容 完 成' : '撤 离 成 功') : '行 动 失 败';
  t.className = won ? '' : 'fail';
  txt('endSub', won
    ? (GAME.mission === 'contain096' ? 'SCP-096 已收容 · 现场影像已销毁' : 'MTF Nu-7 · 落锤行动 · 完成')
    : '原因：' + reason);
  const acc = player.shots ? Math.round(player.hits / player.shots * 100) : 0;
  const hs = player.hits ? Math.round(player.headshots / player.hits * 100) : 0;
  let s = '';
  const row = (k, v) => '<div class="stRow"><span>' + k + '</span><b>' + v + '</b></div>';
  let grade;
  if (GAME.mission === 'contain096') {
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
    const total = SCP_ORDER.length;
    const done = Object.keys(GAME.contained).length;
    const doneP = PHOTOS.filter(p => p.done).length;
    s += row('收容进度', done + ' / ' + total);
    if (PHOTOS.length) s += row('档案销毁', doneP + ' / ' + PHOTOS.length);
    s += row('击杀', player.kills);
    s += row('命中率', acc + '%（' + player.hits + ' / ' + player.shots + '）');
    s += row('其中爆头', hs + '%');
    s += row('造成伤害', Math.round(player.dmgDealt));
    s += row('承受伤害', Math.round(player.dmgTaken));
    s += row('剩余生命', Math.ceil(Math.max(0, player.hp)) + ' / ' + player.maxHp);
    s += row('行动时间', Math.floor(GAME.elapsed / 60) + ' 分 ' + Math.floor(GAME.elapsed % 60) + ' 秒');
    grade = won ? (done >= total ? 'S' : done >= total - 1 ? 'A' : 'B') : 'F';
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
  const bar = el('bootBar'), bt = el('bootTxt');
  show('bootScreen');
  if (bt) bt.textContent = farm ? '正在构建加州农场…' : '正在构建 Site-19 设施…';
  if (bar) bar.style.width = '35%';

  if (farm) buildFarm(); else buildFacility();
  if (bar) bar.style.width = '62%';
  if (bt) bt.textContent = '正在部署 MTF Nu-7…';

  spawnAllies();
  if (farm) spawnFarmSCPs(); else spawnAllSCPs();
  player.init();
  const gd = GEAR_DEFS[LOADOUT.gear] || GEAR_DEFS.none;
  NVG.battery = gd.battery || 0;
  NVG.on = false;
  NVG.apply();

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
  if (bar) bar.style.width = '100%';
  setTimeout(() => {
    hide('bootScreen');
    requestLock();
    AudioSys.alarm();
    if (farm) {
      broadcast('◤ 行动代号「收容」· 目标 SCP-096 · 地点：美国加利福尼亚州', 6000);
      subtitle('收容行动 · 开始', '找到 SCP-096 → 戴上收容头套 → 销毁照片 → 撤离', 5200);
      toast('⚠ 不要直视 SCP-096 的脸 · 照片也不要盯着看', 5400, 'warn');
    } else {
      broadcast(BROADCASTS.breach, 5200);
      subtitle('落锤行动 · 开始', '恢复供电 → 上传协议 → 销毁档案 → 清剿收容物 → 撤离', 4600);
      toast('长按 [F] 交互 · [N] 头戴装置 · [M] 平面图', 4200);
      setTimeout(() => toast('⚠ 设施里散落着 6 张拍到 SCP-096 面部的档案照片，务必全部销毁', 5200, 'warn'), 4400);
    }
  }, 380);
}

function restartGame() {
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

  updateBlink(dt);
  updatePlayer(dt);
  updateSCPs(dt);
  updateAllies(dt);
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
