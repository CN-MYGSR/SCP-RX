'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  12e 可操控的实体收容物
   173 / 096 / 939 / 106 / 049 / 3114 / 076-2 / 682 ——
   附身在设施里那只 SCP 身上，用它自己的方式杀人。

   共同点：
   · 第一人称视角（眼高按各自体型），WASD 移动，左键攻击，没有枪。
   · 目标与 079 相同：**把设施里的人类全部清除**；自己被打死就结束。
   · 其他 SCP 不会攻击你（你是同类），但 MTF 和设施人员会。

   各自的"手感"：
   · 173 —— 只要有人看着你就**一步也动不了**。NPC 也会眨眼，那是你唯一的窗口。
   · 096 —— 平时很慢；有人看见你的脸就暴走，速度翻五倍。
   · 939 —— 没有眼睛。屏幕上会标出附近**会出声的人**。
   · 106 —— **穿墙**。墙对你来说只是空气。
   · 049 —— 走得很慢，但会**把附近的尸体拉起来**变成 049-2 替你打人。
   · 3114 —— 全场最快、连击也最快，代价是血薄。
   · 076-2 —— 近战伤害高，而且**被打倒后还会自己站起来一次**。
   · 682 —— 血厚伤害高，还会**自动朝人喷酸液**（落点溅射）。
   ===================================================================== */

const PSCP = {
  active: false,
  ent: null,
  def: null,
  tune: null,
  atkCd: 0,
  observed: false,
  moving: false,
  kills: 0,
  rageTold: false,
  soundList: [],
};

const PSCP_TUNING = {
  // killCd：**造成击杀之后**的冷却（秒），比普通 atkCd 长得多 ——
  // 没有它的话，高速 + 碰即死的收容物守在入口就能来一个杀一个，对面毫无还手窗口。
  '173': { speed: 10.5, eyeH: 1.55, atkRange: 2.5, atkCd: 0.9, killCd: 2.2, frozenWhenSeen: true, atkName: '拧断脖子' },
  '096': { speed: 4.2, rageSpeed: 22.0, eyeH: 2.30, atkRange: 2.5, atkCd: 0.8, killCd: 3.2, rageOnSight: true, atkName: '撕碎' },
  '939': { speed: 7.6, eyeH: 1.70, atkRange: 2.3, atkCd: 0.75, killCd: 2.2, soundVision: true, atkName: '撕咬' },
  '106': { speed: 4.8, eyeH: 1.60, atkRange: 2.6, atkCd: 1.1, killCd: 2.6, phase: true, atkName: '腐蚀' },
  // ⚠️ 下面这四只**不是"碰即死"**（原版 touchDmg 是 30 / 46 / 22）——
  //    必须写 touchDmg 才会按伤害结算。没写 touchDmg 的（173/096/939/106）保持碰一下就死。
  '049': { speed: 3.4, eyeH: 1.72, atkRange: 2.0, atkCd: 1.4, killCd: 2.0, raiseDead: true, atkName: '治疗' },
  '076': { speed: 8.6, eyeH: 1.85, atkRange: 2.3, atkCd: 0.9, killCd: 1.8, touchDmg: 34, atkName: '斩击' },
  '682': { speed: 4.8, eyeH: 2.55, atkRange: 3.0, atkCd: 1.9, killCd: 2.0, touchDmg: 52, acidSpit: true, atkName: '撕咬' },
  '3114': { speed: 13.5, eyeH: 1.55, atkRange: 1.6, atkCd: 0.55, killCd: 2.0, touchDmg: 26, atkName: '抓取' },
};

/* ---------------------------------------------------------------------
   进入 / 退出
   --------------------------------------------------------------------- */
function startPlayableSCP(roleId) {
  const def = ROLE_DEFS[roleId];
  if (!def || !def.scpKey) return false;
  const ent = SCP_LIST.find(s => s.key === def.scpKey);
  if (!ent) return false;
  const tune = PSCP_TUNING[def.scpKey];
  if (!tune) return false;

  ent.playerControlled = true;
  ent.alive = true;
  ent.awake = true;
  ent.wakeTime = 0;
  ent.target = null;
  ent.hp = ent.maxHp;
  ent.enraged = false; ent.rageT = 0; ent.enrageT = 0;
  ent.hooded = false;
  ent.stunT = 0; ent.grabbing = null;
  if (ent.model.hood) ent.model.hood.visible = false;
  if (ent.model.scrambleQuad) ent.model.scrambleQuad.visible = false;
  if (!ent.model.group.parent) scene.add(ent.model.group);

  PSCP.active = true;
  PSCP.ent = ent; PSCP.def = def; PSCP.tune = tune;
  PSCP.atkCd = 0; PSCP.kills = 0; PSCP.rageTold = false;

  player.isSCP = true;
  player.eyeH = tune.eyeH;
  player.pos.set(ent.pos.x, ent.pos.y, ent.pos.z);
  player.yaw = ent.yaw;
  player.pitch = 0;
  ent.model.group.visible = false;      // 第一人称看不到自己
  GAME.alarmLevel = 2;
  return true;
}
function stopPlayableSCP() { PSCP.active = false; player.isSCP = false; }

/* ---------------------------------------------------------------------
   判定：能不能动 / 有没有人看着你
   --------------------------------------------------------------------- */
function scpHumans() {
  const out = [];
  if (typeof ALLY_LIST !== 'undefined') for (const a of ALLY_LIST) if (a.alive) out.push(a);
  if (typeof PERSONNEL_LIST !== 'undefined') for (const p of PERSONNEL_LIST) if (p.alive && !p.escaped) out.push(p);
  if (typeof FACTION_LIST !== 'undefined') for (const f of FACTION_LIST) if (f.alive) out.push(f);
  return out;
}

/* NPC 眨眼 —— 173 唯一的移动窗口。
   ⚠️ 改成**全体共享节拍**：以前是每个 NPC 各自随机眨眼（睁 3~8 秒、闭 0.26 秒），
      单个 NPC 的眨眼占空比只有 ~4.7%；而 173 要所有观察者**同时**眨眼才能动 ——
      2 个观察者就只有 0.2%，3 个是 0.01%，等于一步也走不了。
      现在所有人同步眨眼：每 2~3 秒睁着眼，然后有约 1 秒的冲刺窗口。 */
const NPC_BLINK = { seenMin: 1.9, seenMax: 3.2, shut: 0.95 };
let npcBlinkT = 0;      // > 0：全体正在眨眼（= 173 的窗口）
let npcBlinkCd = 0;     // 距离下一次眨眼还有多久

function tickNpcBlink(dt) {
  if (npcBlinkT > 0) { npcBlinkT -= dt; return; }
  npcBlinkCd -= dt;
  if (npcBlinkCd <= 0) {
    npcBlinkT = NPC_BLINK.shut * rand(0.85, 1.15);
    npcBlinkCd = rand(NPC_BLINK.seenMin, NPC_BLINK.seenMax);
  }
}

function scpIsObserved(e) {
  if (npcBlinkT > 0) return false;                    // 全体正在眨眼，谁都没看着你
  const humans = scpHumans();
  for (const h of humans) {
    const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z);
    if (d > 28) continue;
    if (hasLOS(h.pos.x, h.pos.y + 1.5, h.pos.z, e.pos.x, e.pos.y + e.height * 0.6, e.pos.z)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------
   攻击
   --------------------------------------------------------------------- */
function scpAttack() {
  if (!PSCP.active || PSCP.atkCd > 0) return;
  const e = PSCP.ent, t = PSCP.tune;
  PSCP.atkCd = t.atkCd;
  const R = t.atkRange;
  // touchDmg 没写 → 碰即死（173/096/939/106）；写了 → 按伤害结算（076/682/3114）
  const dmg = t.touchDmg || 9999;
  let hits = 0, kills = 0;
  const hit = (h) => {
    if (!h || !h.alive) return;
    const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z);
    if (d > R) return;
    const before = h.alive;
    h.damage(dmg, e, { limb: 'torso' });
    hits++;
    if (before && !h.alive) kills++;
  };
  for (const h of scpHumans()) hit(h);
  if (hits) {
    PSCP.kills += kills;
    // ⚠️ 一旦造成击杀就换成长冷却 —— 否则 096 这种高速 + 碰即死的，
    //    守在入口能来一个杀一个，对面完全没有还手窗口。
    if (kills > 0) PSCP.atkCd = (t.killCd || 2.0);
    AudioSys.scpRoar(e.key, 0);
    addTrauma(0.3);
    flashScreen(0.28, e.key === '106' ? '#3a2a10' : '#7a1a1a');
    broadcast('◤ ' + e.name + ' ' + t.atkName + ' · ' + hits + ' 人' + (kills ? '死亡' : '受创'));
    killfeed(e.name + (kills ? ' 击杀了 ' + kills + ' 人' : ' 命中了 ' + hits + ' 人'), 'bad');
  } else {
    AudioSys.boneClick(0);
    toast('没打中 —— 走近一点再按左键', 1600, 'warn');
  }
}

/* ---------------------------------------------------------------------
   SCP-049：把附近的尸体拉起来变成 SCP-049-2
   （复用 NPC 版的 spawnMinion —— 不重写一套召唤逻辑）
   --------------------------------------------------------------------- */
function updateRaiseDead(e, dt) {
  if (e.reviveT == null) e.reviveT = 4;
  e.reviveT -= dt;
  if (e.reviveT > 0) return;
  e.reviveT = 6.0;
  if (typeof MINIONS === 'undefined' || MINIONS.length >= 6) return;
  for (const c of CORPSES) {
    if (c.revived) continue;
    if (Math.hypot(c.x - e.pos.x, c.z - e.pos.z) > 9) continue;
    c.revived = true;
    spawnMinion(c.x, c.z);
    AudioSys.scpRoar('049', 0);
    broadcast('◤ SCP-049 让一具尸体重新站了起来');
    toast('你的"病人"起来替你干活了', 3000, 'good');
    break;
  }
}

/* ---------------------------------------------------------------------
   SCP-682：酸液吐息（可玩版）
   ⚠️ NPC 版的酸池只烧玩家，所以 spitAcid 要带 byPlayer 标记，
      落地时补一次"只对 NPC 生效"的溅射伤害（见 11_fx.js 的 updateAcid）
   --------------------------------------------------------------------- */
function updatePlayableAcid(e, dt) {
  if (e.acidT == null) e.acidT = 3;
  e.acidT -= dt;
  if (e.acidT > 0) return;
  const humans = scpHumans();
  let near = null, nd = 1e9;
  for (const h of humans) {
    const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z);
    if (d < nd) { nd = d; near = h; }
  }
  if (!near || nd > 30) return;      // 附近没人就不空喷
  e.acidT = 5.5;
  playableSpitAcid(e, near);
}

/* 朝视线正前方喷一口酸（目标不在正前方 60° 锥内就朝正前 8 米空喷） */
function playableSpitAcid(e, near) {
  const fwd = V3(0, 0, -1).applyQuaternion(camera.quaternion);
  const keep = e.target;
  let aim = near;
  if (aim) {
    const dx = aim.pos.x - e.pos.x, dz = aim.pos.z - e.pos.z;
    const d = Math.max(0.001, Math.hypot(dx, dz));
    if ((fwd.x * dx + fwd.z * dz) / d <= 0.5) aim = null;
  }
  e.target = aim || { pos: { x: e.pos.x + fwd.x * 8, y: e.pos.y, z: e.pos.z + fwd.z * 8 } };
  if (typeof spitAcid === 'function') spitAcid(e, true);
  e.target = keep;
}

/* ---------------------------------------------------------------------
   主更新
   --------------------------------------------------------------------- */
function updatePlayableSCP(dt) {
  if (!PSCP.active) return;
  const e = PSCP.ent, t = PSCP.tune;
  if (!e || !e.alive) { endGame(false, '你被重新收容了'); return; }
  PSCP.atkCd = Math.max(0, PSCP.atkCd - dt);

  tickNpcBlink(dt);                 // 全体共享节拍 —— 每帧只推进一次
  const humans = scpHumans();

  // ---- 173：被注视就冻结 ----
  let canMove = true;
  if (t.frozenWhenSeen) {
    PSCP.observed = scpIsObserved(e);
    canMove = !PSCP.observed;
  }
  // 076-2 被打倒后的"倒地"期间不能动 —— 等它自己再站起来（通用循环里的 reviveOnce）
  if (e.state === 'down') canMove = false;

  // ---- 096：被人看到脸就暴走 ----
  if (t.rageOnSight && !e.enraged) {
    let seen = false;
    for (const h of humans) {
      const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z);
      if (d > 22) continue;
      if (hasLOS(h.pos.x, h.pos.y + 1.5, h.pos.z, e.pos.x, e.pos.y + e.height * 0.92, e.pos.z)) { seen = true; break; }
    }
    if (seen) {
      e.enraged = true; e.enrageT = 0;
      if (!PSCP.rageTold) {
        PSCP.rageTold = true;
        broadcast('◤ 有人看见了 SCP-096 的脸');
        subtitle('你被看见了', '现在你停不下来', 3200);
        AudioSys.scpRoar('096', 0);
        addTrauma(0.6);
        flashScreen(0.4, '#7a1a1a');
      }
    }
  }
  if (t.rageOnSight && e.enraged) {
    e.enrageT = (e.enrageT || 0) + dt;
    if (e.enrageT > 26) {                 // 追不到人也会冷静下来，和 AI 版一致
      e.enraged = false; e.enrageT = 0; PSCP.rageTold = false;
      broadcast('◤ SCP-096 重新平静下来');
    }
  }

  // ---- 移动 ----
  let mx = 0, mz = 0;
  if (canMove) {
    const f = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    const s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (f || s) {
      const yaw = player.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      mx = fx * f + rx * s; mz = fz * f + rz * s;
      const m = Math.hypot(mx, mz);
      if (m > 0.001) { mx /= m; mz /= m; }
    }
  }
  const spd = (t.rageOnSight && e.enraged) ? t.rageSpeed : t.speed;
  PSCP.moving = !!(mx || mz);
  if (PSCP.moving) {
    e.pos.x += mx * spd * dt;
    e.pos.z += mz * spd * dt;
    if (!t.phase) {
      collideMove(e.pos, e.radius, e.height, 0.5);
      e.pos.y = floorAt(e.pos.x, e.pos.z, e.pos.y + 0.3);
    }
    e.yaw = angLerp(e.yaw, Math.atan2(-mx, -mz), clamp(dt * 8, 0, 1));
    e.walkT = (e.walkT || 0) + spd * dt;
    e.noise = (e.noise || 0) + dt;
  }

  // ---- 攻击 ----
  if (keys.fire) scpAttack();

  // ---- 049：定期把附近的尸体拉起来当帮手 ----
  if (t.raiseDead) updateRaiseDead(e, dt);

  // ---- 682：自动酸液吐息（附近有人、冷却到了就喷） ----
  if (t.acidSpit) updatePlayableAcid(e, dt);

  // ---- 相机跟随本体 ----
  // 第一人称看不到自己的身体：把本体模型藏掉（否则会从模型内部往外看）
  if (e.model.group.visible) e.model.group.visible = false;
  player.pos.set(e.pos.x, e.pos.y, e.pos.z);
  player.eyeH = t.eyeH;
  player.vel.set(0, 0, 0);

  // ---- 939 的声呐：把附近会出声的人列出来 ----
  if (t.soundVision) {
    const list = [];
    for (const h of humans) {
      const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z);
      if (d > 34) continue;
      const loud = (h === player) ? 0 : (h.moving ? 1 : 0.45);
      list.push({ d, loud, x: h.pos.x, z: h.pos.z });
    }
    list.sort((a, b) => a.d - b.d);
    PSCP.soundList = list.slice(0, 6);
  }

  // ---- 胜负 ----
  if (humans.length <= 0 && !GAME.over) endGame(true, '设施内已无人类');
}

bootMark('playableSCP');
