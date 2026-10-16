// 蛇之手跟进：兜帽长袍小队站在收容间门前
GAME.elapsed = 361;
checkFactionSchedule();
const sh = FACTION_LIST.filter(a => a.kind === 'hand');
const rm = FAC.roomAt['LCZ-173'] || FAC.roomAt['LCZ-LAB'];
player.pos.set(rm.cx + 1.5, 0, rm.cz + 9);
player.yaw = 0; player.pitch = 0.02;
sh.forEach((a, i) => {
  a.pos.set(rm.cx - 2.4 + i * 2.4, 0, rm.cz + 4.2);
  a.yaw = PI;
  a.target = null; a.retargetT = 0;
});
registerLight(rm.cx, 3.6, rm.cz + 6, 0xd8e0d0, 2.6, 20, { flicker: 0 });
registerLight(rm.cx + 4, 3.0, rm.cz + 2, 0xa8c0e8, 1.6, 16, { flicker: 0 });
