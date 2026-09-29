// 农舍内的一张照片（未划掉）—— 站在桌子北侧朝南看
const p = FARM.photos[0];
player.pos.set(p.x, 0, p.z - 2.0);
player.yaw = PI; player.pitch = -0.26;
registerLight(p.x, 2.3, p.z - 1.2, 0xffd8a0, 2.6, 9, { flicker: 0 });
registerLight(p.x - 3, 2.4, p.z - 3, 0xffc880, 1.4, 9, { flicker: 0 });
