// 站在轻收容区横向走廊，看向「实验室」的门
const lab = FAC.roomAt['LCZ-LAB'];
player.pos.set(lab.cx + 0.5, 0, cellZ(48));
player.yaw = 0; player.pitch = -0.02;
// 点亮周围，方便看清布景
registerLight(player.pos.x, 3.2, player.pos.z + 4, 0xffffff, 3.4, 30, { flicker: 0 });
registerLight(lab.cx, 3.0, lab.cz, 0x9fd8e8, 2.2, 24, { flicker: 0 });
