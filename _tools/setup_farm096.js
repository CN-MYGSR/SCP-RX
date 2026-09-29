// 站在牧场里看着 SCP-096 蹲坐在田野中（温顺状态 —— 视线偏开 22° 观察锥外）
const s = SCP_LIST.find(v => v.key === '096');
player.pos.set(s.pos.x + 1, 0, s.pos.z + 11);
player.yaw = 0.52; player.pitch = 0.05;
LOADOUT.gear = 'scramble';
NVG.battery = 100; NVG.on = false; NVG.apply();
registerLight(s.pos.x, 3.2, s.pos.z + 3, 0xa8c0e8, 2.2, 26, { flicker: 0 });
registerLight(s.pos.x + 6, 4.5, s.pos.z + 8, 0xcfe0ff, 1.4, 24, { flicker: 0 });
