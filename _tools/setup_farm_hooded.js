// 已戴收容头套的 SCP-096 近景
const s = SCP_LIST.find(v => v.key === '096');
hoodSCP096();
player.pos.set(s.pos.x, 0, s.pos.z + 3.6);
player.yaw = 0; player.pitch = 0.16;
registerLight(s.pos.x, 3.0, s.pos.z + 1.5, 0xffffff, 3.0, 16, { flicker: 0 });
registerLight(s.pos.x - 2, 2.2, s.pos.z + 2, 0xa8c0e8, 1.6, 12, { flicker: 0 });
