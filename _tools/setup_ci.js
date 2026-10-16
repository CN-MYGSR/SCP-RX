// 混沌分裂者突入：把小队摆到玩家正前方
GAME.elapsed = 301;
checkFactionSchedule();
const ci = FACTION_LIST.filter(a => a.kind === 'ci');
player.pos.set(cellX(28), 0, cellZ(23));
player.yaw = 0; player.pitch = 0.02;
ci.forEach((a, i) => {
  const k = i - 2;
  a.pos.set(cellX(28) + k * 1.8, 0, cellZ(23) - 6.5 - Math.abs(k) * 0.9);
  a.yaw = PI;
  a.target = null; a.retargetT = 0;
});
registerLight(cellX(28), 4.5, cellZ(23) - 3, 0xffcfb0, 2.6, 24, { flicker: 0 });
registerLight(cellX(28) + 5, 3.5, cellZ(23) - 8, 0xcfe0ff, 1.6, 18, { flicker: 0 });
