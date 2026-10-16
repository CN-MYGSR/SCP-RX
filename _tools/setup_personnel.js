// 三类设施幸存人员：D 级人员 / 研究员 / 设施保安
const sci = PERSONNEL_LIST.find(p => p.kind === 'scientist');
const d = PERSONNEL_LIST.find(p => p.kind === 'classd');
const g = PERSONNEL_LIST.find(p => p.kind === 'guard');
player.pos.set(cellX(36), 0, cellZ(57));
player.yaw = 0; player.pitch = 0.02;
[sci, d, g].forEach((p, i) => {
  if (!p) return;
  p.pos.set(cellX(36) - 3.2 + i * 3.2, 0, cellZ(57) - 5.5);
  p.yaw = PI;
  p.state = 'idle';
  p.homeX = p.pos.x; p.homeZ = p.pos.z;
  p.wanderX = p.pos.x; p.wanderZ = p.pos.z;
  p.wanderT = 99;
});
registerLight(cellX(36), 4.0, cellZ(57) - 3, 0xffe4c8, 3.2, 24, { flicker: 0 });
registerLight(cellX(36) - 5, 3.2, cellZ(57) - 7, 0xcfe0ff, 1.8, 18, { flicker: 0 });
