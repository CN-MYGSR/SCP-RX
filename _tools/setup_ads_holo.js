// 开镜检查全息瞄具：把主武器换成 holo 并进入 ADS
const mods = { optic: 'holo', muzzle: 'comp', grip: 'vertical', mag: 'std', laser: 'none_laser', stock: 'std' };
LOADOUT.mods.primary = mods;
player.slots[0].mods = mods;
player.slots[0].stats = computeWeaponStats('hk416', mods);
VM.equip('hk416', mods);
player.pos.set(FAC.spawn.x, 0, FAC.spawn.z);
player.yaw = HPI; player.pitch = 0;
keys.ads = true; player.ads = true;
registerLight(player.pos.x, 2.2, player.pos.z - 2, 0xffffff, 2.4, 16, { flicker: 0 });
