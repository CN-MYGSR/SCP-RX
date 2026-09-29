// 实验室内部：中央实验台 + 隔离舱
const lab = FAC.roomAt['LCZ-LAB'];
player.pos.set(lab.cx, 0, lab.cz + 9);
player.yaw = 0; player.pitch = -0.04;      // 面朝北（-Z），正对实验台与隔离舱
registerLight(lab.cx, 3.3, lab.cz + 4, 0xffffff, 3.4, 26, { flicker: 0 });
registerLight(lab.cx, 3.3, lab.cz - 6, 0x9fd8e8, 2.6, 24, { flicker: 0 });
