// 办公区：站在玻璃房内看玻璃观察室
const glass = FAC.roomAt['EZ-GLASS'];
player.pos.set(glass.cx, 0, glass.cz + 9);
player.yaw = 0; player.pitch = -0.02;
registerLight(glass.cx, 3.3, glass.cz + 4, 0xffffff, 3.4, 26, { flicker: 0 });
