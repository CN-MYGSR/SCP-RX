// 站在 SCP-096 正前方，打开 Project SCRAMBLE —— 检查面部打码贴片
const s = SCP_LIST.find(v => v.key === '096');
player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
player.yaw = 0; player.pitch = 0.15;      // 略微抬头，正对 096 的面部
s.pos.set(player.pos.x, 0, player.pos.z - 4.5);
s.pos.y = 0; s.enraged = false; s.rageT = 0; s.awake = true; s.yaw = Math.PI;
LOADOUT.gear = 'scramble';
NVG.battery = 100; NVG.on = true; NVG.apply();
// 强制判定一次，让打码贴片立刻可见（正常游戏里由 rage() 每帧刷新）
s.scrambleHold = true;
if (s.model.scrambleQuad) s.model.scrambleQuad.visible = true;
document.getElementById('scramInd').classList.remove('hidden');
registerLight(player.pos.x, 3.2, player.pos.z - 3, 0xffffff, 3.2, 22, { flicker: 0 });
registerLight(s.pos.x, 2.6, s.pos.z, 0xa8e0f0, 2.0, 12, { flicker: 0 });
