// SCP-3114 的伪装形态（在它露馅距离之外观察）
const s = SCP_LIST.find(v => v.key === '3114');
s.disguised = true;
s.active = false;
if (s.disguise) s.disguise.group.visible = true;
s.model.group.visible = false;
const d = 11.0;
player.pos.set(s.pos.x, 0, s.pos.z + d);
player.yaw = 0; player.pitch = 0.02;
registerLight(s.pos.x, 3.4, s.pos.z + 3, 0xcfe0ff, 2.8, 20, { flicker: 0 });
registerLight(s.pos.x + 3, 2.6, s.pos.z + 6, 0xa8c0e8, 1.6, 16, { flicker: 0 });
