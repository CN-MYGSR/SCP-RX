// 落锤行动：LCZ-096 收容间里已戴上收容头套的 SCP-096
const s = SCP_LIST.find(v => v.key === '096');
hoodSCP096();
player.pos.set(s.pos.x, 0, s.pos.z + 3.8);
player.yaw = 0; player.pitch = 0.14;
registerLight(s.pos.x, 3.0, s.pos.z + 1.5, 0xffffff, 3.0, 16, { flicker: 0 });
registerLight(s.pos.x - 2.2, 2.2, s.pos.z + 2, 0xa8c0e8, 1.8, 13, { flicker: 0 });
