// 把玩家放到重收容区中央主廊，看看设施深处
player.pos.set(0, 0, -30);
player.yaw = 0; player.pitch = 0;
const s682 = SCP_LIST.find(v => v.key === '682');
if (s682) { s682.pos.set(0, 0, -46); s682.active = true; }
const s076 = SCP_LIST.find(v => v.key === '076');
if (s076) { s076.pos.set(-6, 0, -40); s076.active = true; }
