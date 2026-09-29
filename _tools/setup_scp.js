player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
player.yaw = 0; player.pitch = -0.02;
const place = (k, dx, dz) => { const s = SCP_LIST.find(v => v.key === k); if (s) { s.pos.set(player.pos.x + dx, 0, player.pos.z + dz); s.active = true; } };
place('173', -3.0, -9);
place('682', 4.5, -15);
place('939', -9.0, -13);
place('3114', 9.0, -11);
const s966 = SCP_LIST.find(v => v.key === '966');
if (s966) { s966.pos.set(player.pos.x + 2.0, 0, player.pos.z - 7); s966.group.visible = true; }
