// 开镜检查机械瞄具
const mods = { optic: 'iron', muzzle: 'none_muzzle', grip: 'none_grip', mag: 'std', laser: 'none_laser', stock: 'stock_std' };
LOADOUT.mods.primary = mods;
player.slots[0].mods = mods;
player.slots[0].stats = computeWeaponStats('hk416', mods);
VM.equip('hk416', mods);
player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
player.yaw = HPI; player.pitch = 0;
keys.ads = true; player.ads = true;
registerLight(player.pos.x, 2.2, player.pos.z - 2, 0xffffff, 2.4, 16, { flicker: 0 });
