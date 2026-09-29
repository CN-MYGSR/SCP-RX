const lob = FAC.roomAt['EZ-LOBBY'];
// 站在入口大堂东端向西看，9 只 SCP 按 3×3 错开摆位（避免前后互相遮挡）
player.pos.set(46, 0, lob.cz);
player.yaw = HPI; player.pitch = 0.01;
const keys = ['173', '096', '049', '076', '106', '682', '939', '966', '3114'];
keys.forEach((k, i) => {
  const s = SCP_LIST.find(v => v.key === k);
  if (!s) return;
  const col = i % 3, row = Math.floor(i / 3);
  s.pos.set(46 - 9 - row * 4.6, 0, lob.cz + (col - 1) * 3.7);
  s.group.visible = true;
  s.group.rotation.z = 0;
  s.disguised = false;
  s.active = true;
  s.awake = true;
  s.hp = s.maxHp;
  s.yaw = -HPI;   // 面向玩家
});
registerLight(38, 3.4, lob.cz, 0xffffff, 4.2, 26, { flicker: 0 });
registerLight(33, 3.4, lob.cz, 0xffffff, 3.8, 24, { flicker: 0 });
registerLight(28, 3.4, lob.cz, 0xffffff, 3.4, 22, { flicker: 0 });
