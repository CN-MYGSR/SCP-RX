// 落锤行动：办公区办公桌上的一张收容档案照片
const p = PHOTOS[0];
player.pos.set(p.x, 0, p.z - 2.2);
player.yaw = PI; player.pitch = -0.26;
registerLight(p.x, 2.3, p.z - 1.0, 0xffffff, 2.6, 9, { flicker: 0 });
registerLight(p.x - 3, 2.4, p.z - 3, 0xcfe4ff, 1.6, 9, { flicker: 0 });
