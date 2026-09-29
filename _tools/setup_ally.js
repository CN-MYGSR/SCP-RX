// 队友模型近景：站在正前方 3.2 米，方便检查四肢与持枪姿势
const a = ALLY_LIST[0];
player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
player.yaw = 0; player.pitch = 0.02;
a.pos.set(player.pos.x, 0, player.pos.z - 3.2);
a.pos.y = 0; a.yaw = Math.PI;   // 面向玩家
a.alive = true;
// 让队友处于"交战姿态"（这才会摆出持枪动作）
a.target = SCP_LIST.find(v => v.key === '682');
registerLight(player.pos.x, 3.0, player.pos.z - 1.6, 0xffffff, 4.2, 22, { flicker: 0 });
registerLight(a.pos.x - 2, 1.6, a.pos.z, 0xaaccff, 2.0, 10, { flicker: 0 });
registerLight(a.pos.x + 2, 1.6, a.pos.z, 0xffd0a0, 2.0, 10, { flicker: 0 });
