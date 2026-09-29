player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
player.yaw = 0; player.pitch = -0.02;
// 把几只 SCP 摆到面前，然后连开数枪，检验曳光弹 / 血雾 / 弹孔是否正常
const keys = ['173', '939', '682', '3114'];
keys.forEach((k, i) => {
  const s = SCP_LIST.find(v => v.key === k);
  if (!s) return;
  s.pos.set(player.pos.x - 7 + i * 4.6, 0, player.pos.z - 10);
  s.group.visible = true; s.group.rotation.z = 0; s.disguised = false;
  s.active = true; s.awake = true; s.observed = true; s.enraged = true;
});
registerLight(player.pos.x, 3.4, player.pos.z - 6, 0xffffff, 3.0, 40, { flicker: 0 });
registerLight(player.pos.x, 2.4, player.pos.z - 2, 0xbcd0ff, 1.8, 20, { flicker: 0 });
// 直接调用射击与特效，制造可截图的瞬间
for (let i = 0; i < 6; i++) {
  const s = SCP_LIST.find(v => v.key === '939');
  const from = V3(player.pos.x + 0.3, player.pos.y + 1.5, player.pos.z);
  const to = V3(s.pos.x + (i - 3) * 0.35, s.pos.y + 1.3, s.pos.z);
  spawnTracer(from, to);
  spawnBloodBurst(to, 'blood', 8);
}
spawnImpact(V3(player.pos.x - 2.5, 1.6, player.pos.z - 4.5), V3(0, 0, 1), 'box');
spawnImpact(V3(player.pos.x + 1.5, 1.9, player.pos.z - 4.5), V3(0, 0, 1), 'box');
spawnCorrosion(player.pos.x + 4, player.pos.z - 6);
spitAcid(SCP_LIST.find(v => v.key === '682'));
player.shots = 42; player.hits = 30; player.headshots = 9;
