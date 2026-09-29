// 小队合影：三名队友跟在玩家侧后方（复现主人截图里的场景）
const lob = FAC.roomAt['EZ-LOBBY'];
player.pos.set(30, 0, lob.cz);
player.yaw = HPI; player.pitch = 0;
const spots = [[24, 74.5], [25.5, 79.2], [24, 83.0]];
ALLY_LIST.forEach((a, i) => {
  const s = spots[i] || spots[0];
  a.pos.set(s[0], 0, s[1]);
  a.pos.y = 0; a.yaw = -HPI; a.alive = true; a.target = null;
});
registerLight(26, 3.2, lob.cz, 0xffffff, 4.0, 30, { flicker: 0 });
registerLight(20, 3.0, lob.cz, 0xcfe4ff, 2.6, 24, { flicker: 0 });
