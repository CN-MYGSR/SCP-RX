// 对照组：同样的位置与距离，但不戴任何装置 —— 用来确认 096 的身体确实渲染了
const s = SCP_LIST.find(v => v.key === '096');
player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
player.yaw = 0; player.pitch = 0.15;
s.pos.set(player.pos.x, 0, player.pos.z - 4.5);
s.pos.y = 0; s.enraged = false; s.rageT = 0; s.awake = true; s.yaw = Math.PI;
LOADOUT.gear = 'none';
NVG.battery = 0; NVG.on = false; NVG.apply();
registerLight(player.pos.x, 3.2, player.pos.z - 3, 0xffffff, 3.2, 22, { flicker: 0 });
registerLight(s.pos.x, 2.6, s.pos.z, 0xa8e0f0, 2.0, 12, { flicker: 0 });
