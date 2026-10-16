'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  01 数据层
   9 种 SCP 的设定与战斗数值 / 武器库 / 改装件 / 关卡目标链。
   全部为纯数据，供 08_scp.js、06_weapons.js、15_objectives.js 读取。
   ===================================================================== */

/* ---------------------------------------------------------------------
   SCP 图鉴
   behavior 字段决定 08_scp.js 里挂载哪套 AI 状态机：
     blink   观察冻结（SCP-173）
     rage    被注视即暴走（SCP-096）
     touch   触碰即死 + 复活尸体（SCP-049）
     duelist 高速近战武士，可复活一次（SCP-076-2）
     phase   穿墙 + 腐蚀（SCP-106）
     tank    极高血量重装（SCP-682）
     sonar   盲眼声呐捕猎（SCP-939）
     thermal 红外隐形（SCP-966）
     mimic   高速扼喉骨架（SCP-3114）
   --------------------------------------------------------------------- */
const SCP_DEFS = {
  '173': {
    key: '173', name: 'SCP-173', cn: '雕像',
    obj: 'Euclid', behavior: 'blink',
    hp: 300, speed: 11.5, radius: 0.42, height: 2.0, mass: 1.0,
    touchRange: 1.7, touchDmg: 999, atkCd: 0.75,
    color: 0x9a9689, accent: 0x5f5a4e,
    // 关键机制：被观察时完全冻结；只有在冻结状态下才吃伤害
    freezeWhenSeen: true, immuneWhenMoving: true,
    lore: '混凝土与钢筋构成的人形雕像。任何视线接触期间它无法移动 —— 但移开视线的一瞬间，它会以肉眼无法捕捉的速度出现在你身后。',
    hint: '保持注视才能冻住它 · 冻结时才吃子弹',
    spawnZone: 'LCZ',
  },
  '096': {
    key: '096', name: 'SCP-096', cn: '羞涩的人',
    obj: 'Euclid', behavior: 'rage',
    hp: 1500, speed: 21.5, radius: 0.55, height: 2.6, mass: 1.2,
    touchRange: 2.0, touchDmg: 999, atkCd: 0.6,
    color: 0xe8ded2, accent: 0xb9a894,
    // 未暴走时免疫一切伤害；被注视面部 0.7 秒后进入暴走
    rageTriggerTime: 0.7, immuneWhenDocile: true,
    // 打不死：唯一的收容方式是靠近长按 F 给它戴上收容头套
    immortal: true, calmAfter: 25,
    lore: '高约 2.6 米的苍白人形，面部被皮肤完全覆盖。平时温顺，但只要有人看见它的脸 —— 无论直接、照片还是录像 —— 它都会不惜一切代价冲向观察者。它的躯体无法被常规火力破坏。',
    hint: '打不死 · 别直视它的脸 · 靠近长按 [F] 戴上收容头套即可收容 · 佩戴 Project SCRAMBLE 可免疫面部识别',
    spawnZone: 'LCZ',
  },
  '049': {
    key: '049', name: 'SCP-049', cn: '瘟疫医生',
    obj: 'Euclid', behavior: 'touch',
    hp: 620, speed: 1.9, radius: 0.42, height: 2.05, mass: 0.9,
    touchRange: 1.9, touchDmg: 999, atkCd: 1.4,
    color: 0x1b1b20, accent: 0xcfc39a,
    // 触碰即死；会把沿途尸体复活成 SCP-049-2
    reviveCd: 6.0, reviveRange: 9, maxMinions: 6,
    lore: '身披黑色长袍、戴着鸟嘴面具的人形。它坚信自己正在治愈一种名为"瘟疫"的疾病，而它的"治疗"方式，是让病人以另一种形态重新站起来。',
    hint: '切勿近身 · 会复活尸体',
    spawnZone: 'HCZ',
  },
  '076': {
    key: '076', name: 'SCP-076-2', cn: '亚伯',
    obj: 'Keter', behavior: 'duelist',
    hp: 1100, speed: 8.4, sprintSpeed: 12.5, radius: 0.45, height: 2.15, mass: 1.1,
    touchRange: 2.3, touchDmg: 30, atkCd: 0.9,
    color: 0x8a7358, accent: 0x3a2f22,
    reviveOnce: true, reviveDelay: 22,
    lore: '从石棺中苏醒的古代战士。体能远超人类极限，能够凭空召唤出锋利的武器。它享受战斗本身，因此不会立刻杀死你 —— 它会先陪你玩一会儿。',
    hint: '近战伤害极高 · 被击杀后可能再次起身',
    spawnZone: 'HCZ',
  },
  '106': {
    key: '106', name: 'SCP-106', cn: '老人',
    obj: 'Keter', behavior: 'phase',
    hp: 1300, speed: 2.6, radius: 0.5, height: 1.95, mass: 1.0,
    touchRange: 1.9, touchDmg: 999, atkCd: 1.0,
    color: 0x2b2419, accent: 0x0d0b07,
    phaseCd: 7.5, phaseRange: 26,
    lore: '一具不断渗出黑色腐蚀性黏液的衰老躯体。它能穿过任何固体物质，把猎物拖入属于自己的口袋空间 —— 在那里，时间没有意义。',
    hint: '会穿墙瞬移 · 只有铅能阻挡',
    spawnZone: 'HCZ',
  },
  '682': {
    key: '682', name: 'SCP-682', cn: '不灭孽蜥',
    obj: 'Keter', behavior: 'tank',
    hp: 5200, speed: 4.6, radius: 1.15, height: 3.1, mass: 2.6,
    touchRange: 3.0, touchDmg: 46, atkCd: 1.9,
    color: 0x3d4a34, accent: 0x8f9b62,
    roarCd: 9, acidSpit: true, acidCd: 5.5,
    lore: '体长超过六米的爬行类巨兽。它对一切生命怀有纯粹的憎恨，并且几乎无法被杀死 —— 每一次伤害都会让它适应、再生、变得更强。',
    hint: '血量极高 · 需要重型火力',
    spawnZone: 'HCZ',
  },
  '939': {
    key: '939', name: 'SCP-939', cn: '众声之口',
    obj: 'Keter', behavior: 'sonar',
    hp: 620, speed: 8.4, radius: 0.6, height: 2.2, mass: 1.2,
    touchRange: 2.4, touchDmg: 32, atkCd: 1.3,
    color: 0x7a2b2b, accent: 0xd94b4b,
    // 没有眼睛：靠声音定位；强光会造成短暂僵直
    blind: true, hearingRange: 34, lightStun: 2.2,
    lore: '身高 2.2 米、皮肤半透明的红色食肉动物。它没有眼睛，靠声音捕猎，并且能够完美模仿此前受害者的嗓音来引诱猎物。',
    hint: '盲眼 · 蹲行静音可摆脱 · 强光可致其僵直',
    spawnZone: 'HCZ',
  },
  '966': {
    key: '966', name: 'SCP-966', cn: '失眠者',
    obj: 'Euclid', behavior: 'thermal',
    hp: 460, speed: 7.4, radius: 0.42, height: 1.6, mass: 0.7,
    touchRange: 1.8, touchDmg: 18, atkCd: 0.95,
    color: 0x6b6f73, accent: 0xb9c2c8,
    // 只在 700~900nm（红外）可见 —— 玩家必须开夜视/热成像才能看到
    onlyVisibleWithNVG: true, revealRange: 5.5,
    sleepDrain: 7, hallucinate: true,
    lore: '高约 1.5 米的无毛人形，仅在 700 至 900 纳米波段可见。它会持续剥夺猎物的睡眠，直到对方在幻觉与暴怒中彻底崩溃。',
    hint: '肉眼不可见 · 按 [N] 开夜视才能看见',
    spawnZone: 'LCZ',
  },
  '3114': {
    key: '3114', name: 'SCP-3114', cn: '骸骨',
    obj: 'Euclid', behavior: 'mimic',
    hp: 420, speed: 14.5, radius: 0.4, height: 1.6, mass: 0.5,
    touchRange: 1.5, touchDmg: 22, atkCd: 0.6,
    color: 0xded6c2, accent: 0x8d8574,
    grabDps: 28, grabRange: 1.5,
    lore: '一具能够自主活动的完整人体骨架，最高脚程 60 公里每小时。它极度渴望人类的形体 —— 抓住猎物后，它会挖出对方的骨骼，再把自己塞进剩下的皮肉里。它会把受害者的皮肉披在身上，顶着那张脸在设施里走动。',
    hint: '速度极快 · 会伪装成设施人员、混沌分裂者、蛇之手甚至 MTF —— 靠近才会露馅',
    spawnZone: 'HCZ',
  },
};

// 全部 SCP 的出场顺序（关卡推进用）
const SCP_ORDER = ['173', '096', '966', '049', '939', '3114', '076', '106', '682'];
// 无需击杀、只需收容的特殊个体（游戏内统一按击杀处理，此处仅用于简报）
const SCP_BOSS = ['106', '682'];

/* ---------------------------------------------------------------------
   武器库
   --------------------------------------------------------------------- */
const WPN_DEFS = {
  hk416: {
    id: 'hk416', name: 'HK-416', full: 'HK-416 突击步枪', cls: '突击步枪', ammoType: '5.56×45mm',
    mode: 'auto', modeName: '全自动', dmg: 28, headMul: 2.0, rpm: 700, mag: 30, reserve: 240,
    reload: 2.35, reloadEmpty: 3.1, spreadHip: 2.6, spreadAds: 0.30, spreadMove: 1.7,
    recoil: 0.68, recSide: 0.40, kick: 0.048, adsFov: 55, adsTime: 0.20, snd: 'rifle',
    tracer: 3, mobility: 0.94, pen: 0.55,
    slots: ['optic', 'muzzle', 'grip', 'mag', 'laser', 'stock'],
  },
  mp5: {
    id: 'mp5', name: 'MP5', full: 'HK MP5 冲锋枪', cls: '冲锋枪', ammoType: '9×19mm',
    mode: 'auto', modeName: '全自动', dmg: 21, headMul: 1.8, rpm: 800, mag: 30, reserve: 300,
    reload: 2.05, reloadEmpty: 2.75, spreadHip: 2.2, spreadAds: 0.42, spreadMove: 1.2,
    recoil: 0.40, recSide: 0.30, kick: 0.036, adsFov: 58, adsTime: 0.16, snd: 'smg',
    tracer: 4, mobility: 1.0, pen: 0.30,
    slots: ['optic', 'muzzle', 'grip', 'mag', 'laser', 'stock'],
  },
  m249: {
    id: 'm249', name: 'M249', full: 'M249 班用机枪', cls: '轻机枪', ammoType: '5.56×45mm 弹链',
    mode: 'auto', modeName: '全自动', dmg: 33, headMul: 1.7, rpm: 760, mag: 100, reserve: 400,
    reload: 5.4, reloadEmpty: 6.6, spreadHip: 4.2, spreadAds: 0.55, spreadMove: 2.6,
    recoil: 0.86, recSide: 0.52, kick: 0.058, adsFov: 56, adsTime: 0.34, snd: 'mg',
    tracer: 2, mobility: 0.80, pen: 0.85,
    slots: ['optic', 'muzzle', 'grip', 'laser', 'stock'],
  },
  glock18: {
    id: 'glock18', name: 'Glock-18', full: '格洛克 18 全自动手枪', cls: '手枪', ammoType: '9×19mm',
    mode: 'auto', modeName: '全自动', dmg: 20, headMul: 1.9, rpm: 1100, mag: 17, reserve: 170,
    reload: 1.85, reloadEmpty: 2.4, spreadHip: 3.4, spreadAds: 0.95, spreadMove: 1.8,
    recoil: 0.44, recSide: 0.42, kick: 0.032, adsFov: 62, adsTime: 0.14, snd: 'pistol',
    tracer: 4, mobility: 1.12, pen: 0.15, pistol: true,
    slots: ['optic', 'muzzle', 'mag', 'laser'],
  },
  // ---- 弹药补给箱里可能捡到的临时武器 ----
  spas12: {
    id: 'spas12', name: 'SPAS-12', full: 'SPAS-12 战术霰弹枪', cls: '霰弹枪', ammoType: '12 号霰弹',
    mode: 'pump', modeName: '泵动', dmg: 17, headMul: 1.5, rpm: 75, mag: 8, reserve: 48,
    pellets: 8, reload: 3.2, reloadEmpty: 3.8, spreadHip: 5.0, spreadAds: 2.6, spreadMove: 3.0,
    recoil: 2.1, recSide: 0.7, kick: 0.13, adsFov: 62, adsTime: 0.24, snd: 'shotgun',
    tracer: 1, mobility: 0.88, pen: 0.05,
    slots: ['optic', 'muzzle', 'laser', 'stock'],
  },
  /* ---- 设施里散落的"补给武器"：给没枪的 Class-D / 科学家 / 保安捡 ----
     三把都是 MTF 制式装备之外的常见货，射速/伤害各有取舍。 */
  ump45: {
    id: 'ump45', name: 'UMP-45', full: 'HK UMP-45 冲锋枪', cls: '冲锋枪', ammoType: '.45 ACP',
    mode: 'auto', modeName: '全自动', dmg: 27, headMul: 1.9, rpm: 600, mag: 25, reserve: 200,
    reload: 2.30, reloadEmpty: 3.00, spreadHip: 2.4, spreadAds: 0.38, spreadMove: 1.3,
    recoil: 0.50, recSide: 0.33, kick: 0.042, adsFov: 58, adsTime: 0.19, snd: 'smg',
    tracer: 3, mobility: 0.97, pen: 0.34,
    slots: ['optic', 'muzzle', 'grip', 'mag', 'laser', 'stock'],
  },
  mp7: {
    id: 'mp7', name: 'MP7', full: 'HK MP7 冲锋手枪', cls: '冲锋枪', ammoType: '4.6×30mm',
    mode: 'auto', modeName: '全自动', dmg: 17, headMul: 1.7, rpm: 950, mag: 40, reserve: 320,
    reload: 1.95, reloadEmpty: 2.60, spreadHip: 2.7, spreadAds: 0.52, spreadMove: 1.4,
    recoil: 0.34, recSide: 0.26, kick: 0.030, adsFov: 60, adsTime: 0.15, snd: 'smg',
    tracer: 5, mobility: 1.06, pen: 0.26,
    slots: ['optic', 'muzzle', 'grip', 'mag', 'laser', 'stock'],
  },
  glock17: {
    id: 'glock17', name: 'Glock-17', full: '格洛克 17 半自动手枪', cls: '手枪', ammoType: '9×19mm',
    mode: 'semi', modeName: '半自动', dmg: 26, headMul: 2.0, rpm: 400, mag: 17, reserve: 170,
    reload: 1.70, reloadEmpty: 2.25, spreadHip: 2.6, spreadAds: 0.55, spreadMove: 1.4,
    recoil: 0.52, recSide: 0.34, kick: 0.036, adsFov: 62, adsTime: 0.13, snd: 'pistol',
    tracer: 3, mobility: 1.14, pen: 0.18, pistol: true,
    slots: ['optic', 'muzzle', 'mag', 'laser'],
  },
};

/* ---------------------------------------------------------------------
   初始配装（三选一 · 对应任务里 MTF Nu-7 的标准配置）
   --------------------------------------------------------------------- */
const LOADOUT_PRESETS = [
  {
    id: 'assault', name: '突击兵', code: 'NU7-01',
    primary: 'hk416', secondary: 'glock18',
    desc: 'HK-416 突击步枪 + Glock-18。均衡的伤害与操控，适合走廊推进与中距离交火。',
    defaultMods: { optic: 'reddot', muzzle: 'comp', grip: 'vertical', mag: 'std', laser: 'laser', stock: 'std' },
    armor: 2,
  },
  {
    id: 'breacher', name: '破门手', code: 'NU7-04',
    primary: 'mp5', secondary: 'glock18',
    desc: 'MP5 冲锋枪 + Glock-18。机动性最高、换弹最快，适合近距离清房与追击。',
    defaultMods: { optic: 'holo', muzzle: 'supp', grip: 'angled', mag: 'ext', laser: 'flashlight', stock: 'light' },
    armor: 1,
  },
  {
    id: 'support', name: '火力支援', code: 'NU7-07',
    primary: 'm249', secondary: 'glock18',
    desc: 'M249 班用机枪 + Glock-18。100 发弹链与高穿透，是唯一能正面对抗 SCP-682 的配置。',
    defaultMods: { optic: 'reddot', muzzle: 'flashhider', grip: 'bipod', laser: 'laser', stock: 'heavy' },
    armor: 3,
  },
];

/* ---------------------------------------------------------------------
   改装件
   每个改装件通过 mod 字段覆盖或叠加武器基础数值。
     mul  乘算（倍率）
     add  加算
   --------------------------------------------------------------------- */
const MOD_SLOTS = {
  optic: { name: '瞄具', icon: '◎' },
  muzzle: { name: '枪口', icon: '⌐' },
  grip: { name: '握把', icon: '⋀' },
  mag: { name: '弹匣', icon: '▤' },
  laser: { name: '战术', icon: '⌖' },
  stock: { name: '枪托', icon: '▬' },
};

const MOD_DEFS = {
  // ---- 瞄具 ----
  iron: { id: 'iron', slot: 'optic', name: '机械瞄具', desc: '原厂机瞄。无额外加成，视野最开阔。', cost: 0, mul: {}, add: {} },
  reddot: { id: 'reddot', slot: 'optic', name: '红点镜', desc: '开镜速度 +15%，开镜视野略窄。', cost: 0, mul: { adsTime: 0.85 }, add: { spreadAds: -0.06 } },
  holo: { id: 'holo', slot: 'optic', name: '全息瞄具', desc: '开镜散布 -15%，适合快速点射。', cost: 0, mul: { spreadAds: 0.82 }, add: {} },
  scope3x: { id: 'scope3x', slot: 'optic', name: '3 倍战术镜', desc: '倍率提升至 3×，开镜变慢、视野收窄。', cost: 0, mul: { adsTime: 1.5 }, add: { adsFov: -22, spreadAds: -0.14 } },

  // ---- 枪口 ----
  none_muzzle: { id: 'none_muzzle', slot: 'muzzle', name: '无', desc: '不加装枪口装置。', cost: 0, mul: {}, add: {} },
  comp: { id: 'comp', slot: 'muzzle', name: '补偿器', desc: '垂直后坐 -18%，但枪口焰更明显。', cost: 0, mul: { recoil: 0.82 }, add: {} },
  flashhider: { id: 'flashhider', slot: 'muzzle', name: '消焰器', desc: '后坐 -8%，显著降低枪口火光（对 SCP-939 更隐蔽）。', cost: 0, mul: { recoil: 0.92 }, add: { stealth: 0.5 } },
  supp: { id: 'supp', slot: 'muzzle', name: '消音器', desc: '枪声半径大幅缩小（SCP-939 更难定位），伤害 -8%。', cost: 0, mul: { dmg: 0.92 }, add: { stealth: 1.0, recoil: -0.04 } },

  // ---- 握把 ----
  none_grip: { id: 'none_grip', slot: 'grip', name: '无', desc: '不加装握把。', cost: 0, mul: {}, add: {} },
  vertical: { id: 'vertical', slot: 'grip', name: '垂直握把', desc: '水平后坐 -25%。', cost: 0, mul: { recSide: 0.75 }, add: {} },
  angled: { id: 'angled', slot: 'grip', name: '斜角握把', desc: '开镜速度 +12%，腰射散布 -10%。', cost: 0, mul: { adsTime: 0.88 }, add: { spreadHip: -0.25 } },
  bipod: { id: 'bipod', slot: 'grip', name: '两脚架', desc: '蹲下时后坐 -35%（仅机枪）。', cost: 0, mul: {}, add: { bipod: 1 } },

  // ---- 弹匣 ----
  std: { id: 'std', slot: 'mag', name: '标准弹匣', desc: '标准容量。', cost: 0, mul: {}, add: {} },
  ext: { id: 'ext', slot: 'mag', name: '扩容弹匣', desc: '弹容量 +40%，换弹略慢、机动性 -4%。', cost: 0, mul: { mag: 1.4, reload: 1.12, mobility: 0.96 }, add: {} },
  drum: { id: 'drum', slot: 'mag', name: '弹鼓', desc: '弹容量 +110%，换弹明显变慢、机动性 -9%。', cost: 0, mul: { mag: 2.1, reload: 1.3, mobility: 0.91 }, add: {} },
  fastmag: { id: 'fastmag', slot: 'mag', name: '快拔弹匣', desc: '换弹速度 +20%，弹容量不变。', cost: 0, mul: { reload: 0.8 }, add: {} },

  // ---- 战术 ----
  none_laser: { id: 'none_laser', slot: 'laser', name: '无', desc: '不加装战术配件。', cost: 0, mul: {}, add: {} },
  laser: { id: 'laser', slot: 'laser', name: '激光指示器', desc: '腰射散布 -35%，但激光可见会暴露位置。', cost: 0, mul: { spreadHip: 0.65 }, add: {} },
  flashlight: { id: 'flashlight', slot: 'laser', name: '战术手电', desc: '照亮前方 18 米。强光可使 SCP-939 僵直。', cost: 0, mul: {}, add: { flashlight: 1 } },
  laserlight: { id: 'laserlight', slot: 'laser', name: '激光/照明一体', desc: '腰射散布 -20% 且带照明。', cost: 0, mul: { spreadHip: 0.8 }, add: { flashlight: 1 } },

  // ---- 枪托 ----
  stock_std: { id: 'stock_std', slot: 'stock', name: '标准枪托', desc: '原厂枪托。', cost: 0, mul: {}, add: {} },
  heavy: { id: 'heavy', slot: 'stock', name: '重型枪托', desc: '后坐 -14%，机动性 -6%。', cost: 0, mul: { recoil: 0.86, mobility: 0.94 }, add: {} },
  light: { id: 'light', slot: 'stock', name: '轻量枪托', desc: '机动性 +10%，开镜速度 +8%，后坐 +8%。', cost: 0, mul: { mobility: 1.1, adsTime: 0.92, recoil: 1.08 }, add: {} },
};

// 每个槽位的可选改装件（顺序即界面顺序）
const MOD_CHOICES = {
  optic: ['iron', 'reddot', 'holo', 'scope3x'],
  muzzle: ['none_muzzle', 'comp', 'flashhider', 'supp'],
  grip: ['none_grip', 'vertical', 'angled', 'bipod'],
  mag: ['std', 'ext', 'drum', 'fastmag'],
  laser: ['none_laser', 'laser', 'flashlight', 'laserlight'],
  stock: ['stock_std', 'heavy', 'light'],
};

/* ---------------------------------------------------------------------
   护甲
   --------------------------------------------------------------------- */
const ARMOR_DEFS = [
  { id: 0, name: '无护甲', resist: 0.00, hp: 0, mobility: 1.00 },
  { id: 1, name: 'III-A 软质防弹衣', resist: 0.24, hp: 120, mobility: 0.99 },
  { id: 2, name: 'III 级战术背心', resist: 0.36, hp: 240, mobility: 0.96 },
  { id: 3, name: 'IV 级重型装甲', resist: 0.48, hp: 400, mobility: 0.90 },
];

/* ---------------------------------------------------------------------
   视觉增强装置（头戴设备 · 三选一，占用同一个槽位）
   --------------------------------------------------------------------- */
const GEAR_DEFS = {
  none: {
    id: 'none', name: '不携带', short: '—', battery: 0,
    desc: '不占用头戴槽位。黑暗中只能靠手电与设施照明。',
  },
  nvg: {
    id: 'nvg', name: '夜视仪', short: 'NVG', battery: 100, drain: 0.40,
    desc: '红外增强视野，黑暗中视物如昼，并让 SCP-966 在红外波段显形。',
    hint: '按 [N] 开关 · 让 SCP-966 显形',
  },
  scramble: {
    id: 'scramble', name: 'Project SCRAMBLE', short: 'SCRAM', battery: 100, drain: 0.34,
    desc: '「视神经阻断式面部干扰装置」。与夜视仪共用同一槽位，同样提供夜视能力，'
      + '并对 SCP-096 的面部做实时打码 —— 即使直视它的脸，也不会触发暴走。',
    hint: '按 [N] 开关 · 免疫 SCP-096 暴走 · 电量耗尽会失效',
  },
};

/* ---------------------------------------------------------------------
   行动（任务）
   --------------------------------------------------------------------- */
const MISSIONS = {
  breach: {
    id: 'breach', name: '落 锤 行 动', sub: 'SITE-19 · 收容失效',
    map: 'facility', tag: '设施 · 9 只收容物 · 长流程',
    desc: 'Site-19 主变压器跳闸，9 只收容物全部脱离。恢复供电、上传收容协议、'
      + '销毁散落各区的收容档案照片、逐一压制，然后撤离。',
  },
  contain096: {
    id: 'contain096', name: '收 容 行 动', sub: 'SCP-096 · 美国加利福尼亚州',
    map: 'farm', tag: '户外 · 单目标收容 · 短流程',
    desc: '一次摄影事故之后，SCP-096 脱离收容，最终停在加州一处偏远农场。'
      + 'Nu-7「落锤」被部署到现场：给它套上收容头套，并销毁所有拍到它面部的照片。',
  },
  fivek: {
    id: 'fivek', name: '5K 行 动', sub: 'NU-22「火箭侠」· 净化程序',
    map: 'facility', tag: '设施 · 全员敌对 · 守护目标',
    desc: 'O5 已经下令。Nu-22「火箭侠」带着 SCP-1440 抵达站点 —— '
      + '你的任务不是收容，而是把它留在这里五分钟 —— 足够久到反叛之狐赶来阻止你。'
      + '站点里的每一个人都会阻止你，而 1440 会替你完成剩下的事。',
  },
  city: {
    id: 'city', name: '净 化 行 动', sub: 'BETA-7「疯帽匠」· 市区疫区',
    map: 'city', tag: '市区 · 感染扩散 · 清剿',
    desc: 'SCP-049 的"瘟疫"在市区里扩散开了。街上到处是被感染的市民 —— '
      + '它们已经不再是人。Beta-7「疯帽匠」被派进来：'
      + '关掉三处感染源，把剩下的清理干净，然后撤离。',
  },
};
const MISSION_ORDER = ['breach', 'contain096', 'fivek', 'city'];

/* 5K 行动的目标链 */
const OBJECTIVES_FIVEK = [
  {
    id: 'hold', title: '让 SCP-1440 在站点停留 5 分钟', short: '滞留',
    desc: '待在它附近 —— 只有你在场，它的异常性质才会持续侵蚀这个站点。',
    detail: '15 米内计时推进，离开后计时缓慢回退。Nu-22 成员免疫 1440 的影响，站点里的人不免疫。',
  },
  {
    id: 'survive', title: '活着撑到净化完成', short: '生存',
    desc: '站点守备与设施人员全部与你敌对。',
    detail: '没有支援。靠 1440 替你清理靠得太近的人。',
  },
];

/* 收容行动的目标链 */
const OBJECTIVES_CONTAIN096 = [
  {
    id: 'find', title: '搜索并接近 SCP-096', short: '搜索',
    desc: 'SCP-096 停在农场北侧的牧场里。找到它，但**不要直视它的脸**。',
    detail: '它现在处于温顺状态，双手抱头蹲坐在田野中。',
  },
  {
    id: 'hood', title: '为 SCP-096 戴上收容头套', short: '收容',
    desc: '走到它身边，长按 [F] 把收容头套套在它头上。',
    detail: '戴上之后它永久失去视觉，不会再暴走攻击任何人。',
  },
  {
    id: 'photos', title: '销毁现场全部照片', short: '销毁',
    desc: '农场里散落着 6 张拍到 SCP-096 面部的照片，逐一按 [F] 划掉。',
    detail: '⚠ 盯着照片看超过 3 秒，会把它「看」暴走 —— 划完就走，别多看。',
  },
  {
    id: 'extract', title: '撤离', short: '撤离',
    desc: '回到公路上的直升机着陆点，长按 [F] 登机。',
    detail: '收容完成前直升机不会起飞。',
  },
];

/* ---------------------------------------------------------------------
   关卡目标链（落锤行动）
   --------------------------------------------------------------------- */
/* 净化行动（市区）的目标链 */
const OBJECTIVES_CITY = [
  {
    id: 'source', title: '关闭感染源', short: '感染源',
    desc: '市区里有三处异常疾病的源头。走近按住 [F] 关掉它们 —— '
      + '只要还有一处没关，感染就会继续扩散。',
    detail: '感染源会持续把附近的市民变成被感染者，越拖场上的人越多。',
  },
  {
    id: 'purge_infected', title: '清除全部被感染者', short: '清剿',
    desc: '把街上游荡的被感染者全部清除。',
    detail: '它们跑得不快，但会成片扑上来 —— 别被围住。',
  },
  {
    id: 'extract', title: '撤离', short: '撤离',
    desc: '回到北端街口的直升机，按住 [F] 撤离。',
    detail: '感染源全关、场上没有活着的被感染者之后，直升机才会起飞。',
  },
];

const OBJECTIVES = [
  {
    id: 'power', title: '恢复供电', short: '电力',
    desc: '重收容区主变压器已跳闸。前往 A / B / C 三处配电间，依次合上断路器。',
    detail: '断路器分布在设施的三个分区，需要逐一交互（按住 F）。',
  },
  {
    id: 'protocol', title: '启动收容协议', short: '协议',
    desc: '电力恢复后，前往办公区「设施总控室」，在总控台上传收容协议。',
    detail: '协议启动后，HID 收容装置将上线，对 SCP 的伤害提升 100%。',
  },
  {
    id: 'photos', title: '销毁泄漏的收容档案', short: '档案',
    desc: '设施里散落着 6 张拍到 SCP-096 面部的档案照片 —— 逐一按 [F] 划掉。',
    detail: '⚠ 盯着照片看超过 3 秒，会把 SCP-096「看」暴走。它们分布在三个分区的办公室、实验室与仓库里。',
  },
  {
    id: 'purge', title: '清剿 / 收容', short: '清剿',
    desc: '设施内 9 只 SCP 全部脱离收容。逐一压制，直至收容协议确认完成。',
    detail: 'SCP-173 需保持注视才能造成伤害；SCP-096 免疫一切伤害，只能靠近长按 [F] 给它戴上收容头套；SCP-966 需开启夜视。',
  },
  {
    id: 'invaders', title: '清除入侵势力', short: '入侵',
    desc: '混沌分裂者与蛇之手会先后突入设施。击毙他们，否则蛇之手会不断把已收容异常放出来。',
    detail: '混沌分裂者在行动开始 5 分钟后从重收电梯厅突入；蛇之手 1 分钟后跟进，按威胁由低到高逐个放逐异常（先 173 / 966，最后 682）。',
  },
  {
    id: 'hunt', title: '清除基金会人员', short: '清剿',
    desc: '把设施里的 MTF、保安、科学家全部干掉 —— 你是回来抢东西的。',
    detail: '基金会的人见到你就会开火。先下手为强。',
  },
  {
    id: 'extract', title: '撤离', short: '撤离',
    desc: '回到办公区入口大堂的地表电梯，按住 F 撤离。',
    detail: '清剿、档案销毁与入侵势力清除都完成之后，撤离电梯才会解锁。',
  },
];

/* 反叛之狐的目标链（仅 5K 行动） */
const OBJECTIVES_REBEL = [
  {
    id: 'kill1440', title: '处决 SCP-1440', short: '处决',
    desc: '它是这场"净化"的核心。走近它，长按 F 执行处决程序 —— 子弹对它没有意义。',
    detail: '处决需要 6 秒引导，期间你动不了。Nu-22 会全力阻止你。',
  },
  {
    id: 'killNu22', title: '清除 Nu-22「火箭侠」', short: '清除',
    desc: '执行净化令的那支特遣队。他们不受 1440 影响，所以只能靠子弹解决。',
    detail: '四名 Nu-22 成员全部清除即完成。',
  },
];
/* SCP-079 / 附身收容物共用的目标链 */
const OBJECTIVES_O79 = [
  {
    id: 'ai_kill', title: '清除设施内全部人类', short: '清场',
    desc: '把队友、保安、研究员、D 级、入侵者 —— 全部送进 SCP 嘴里。',
    detail: '你没有武器。门、停电封锁和特斯拉门过充是你的武器。',
  },
  {
    id: 'ai_survive', title: '保住其他收容物', short: '保全',
    desc: '其他 SCP 全部被清空时，你的重新收容程序会自动启动。',
    detail: '它们是你唯一的手 —— 别让 MTF 把它们一个个清掉。',
  },
];

/* ---------------------------------------------------------------------
   设施分区（04_facility.js 读取）
   --------------------------------------------------------------------- */
const ZONES = {
  EZ: { id: 'EZ', name: '入口区', code: 'Entrance Zone', color: 0x3a4a5a, light: 0.62 },
  LCZ: { id: 'LCZ', name: '轻收容区', code: 'Light Containment', color: 0x4a4436, light: 0.34 },
  HCZ: { id: 'HCZ', name: '重收容区', code: 'Heavy Containment', color: 0x4a3232, light: 0.20 },
};

// SCP 收容间（房间 id -> SCP key）—— 依照 SCP:RX 分区平面图分布
const CONTAINMENT_ROOMS = {
  'LCZ-173': '173',
  'LCZ-096': '096',
  'LCZ-966': '966',
  'HCZ-682': '682',
  'HCZ-106': '106',
  'HCZ-939': '939',
  'HCZ-076': '076',
  'HCZ-3114': '3114',
  'HCZ-049': '049',
};

// 配电间位置（分区 -> 房间 id）
const BREAKER_ROOMS = { A: 'EZ-SEC', B: 'LCZ-LAB', C: 'HCZ-ELECTRO' };

/* ---------------------------------------------------------------------
   拾取物 / 补给
   --------------------------------------------------------------------- */
const PICKUP_TYPES = {
  ammo_rifle: { name: '5.56mm 弹药箱', kind: 'ammo', for: ['hk416', 'm249'], amount: 0.5, color: 0xc8a24a },
  ammo_smg: { name: '9mm 弹药盒', kind: 'ammo', for: ['mp5', 'glock18', 'glock17'], amount: 0.5, color: 0xb8b06a },
  ammo_45: { name: '.45 ACP 弹药盒', kind: 'ammo', for: ['ump45'], amount: 0.6, color: 0xc09a5a },
  ammo_46: { name: '4.6mm 弹药盒', kind: 'ammo', for: ['mp7'], amount: 0.6, color: 0xa8b878 },
  medkit: { name: '医疗包', kind: 'heal', amount: 55, color: 0xd44b4b },
  bandage: { name: '止血绷带', kind: 'heal', amount: 22, color: 0xd8d0c0 },
  armor_plate: { name: '防弹插板', kind: 'armor', amount: 60, color: 0x6a7a8a },
  battery: { name: '装置电池', kind: 'battery', amount: 40, color: 0x5ad4a0 },
  // ---- 散落的补给武器（只给没枪的阵营捡）----
  wpn_ump45: { name: 'UMP-45', kind: 'weapon', wpn: 'ump45', color: 0x8a7a5a },
  wpn_mp7: { name: 'MP7', kind: 'weapon', wpn: 'mp7', color: 0x6a7a6a },
  wpn_glock17: { name: 'Glock-17', kind: 'weapon', wpn: 'glock17', color: 0x5a5a62 },
};

/* 哪些角色可以捡地上的武器。
   只有"没枪或只有手枪"的阵营需要 —— MTF / 第二身份 / 收容物都不参与。 */
function canPickWeapons() {
  const r = (typeof currentRole === 'function') ? currentRole() : null;
  return !!(r && r.canPickWeapons) && !player.isAI && !player.isSCP;
}

/* ---------------------------------------------------------------------
   设施广播台词
   --------------------------------------------------------------------- */
const BROADCASTS = {
  breach: '⚠ 收容失效 · 全体人员立即撤离 · MTF 已部署',
  power: '◤ 主变压器跳闸 · 备用电源剩余 20%',
  protocol: '◤ 收容协议上传中 · HID 装置充能',
  archive: '◤ 情报组提示 · 设施内散落 6 份 SCP-096 面部影像档案 · 必须全部销毁',
  scp: {
    '173': '◤ 警告 · SCP-173 收容间失压',
    '096': '◤ 警告 · SCP-096 已脱离监控范围',
    '049': '◤ 警告 · SCP-049 收容间生命体征异常',
    '076': '◤ 警告 · SCP-076-2 石棺开启',
    '106': '◤ 警告 · SCP-106 腐蚀痕迹扩散',
    '682': '◤ 警告 · SCP-682 收容间结构失效',
    '939': '◤ 警告 · SCP-939 群体活动信号',
    '966': '◤ 警告 · SCP-966 红外信号丢失',
    '3114': '◤ 警告 · SCP-3114 收容间气压异常',
  },
};

bootMark('data');

/* ---------------------------------------------------------------------
   开局角色（还原 RXSEND 的随机阵营机制）
   每局开始随机分配一个角色，装备、出生点和目标链都不同。
   · loadout:'custom' —— 用玩家在配装界面自己选的（只有 MTF 有这待遇）
   · loadout:'fixed'  —— 用角色自带的固定配装
   · loadout:'none'   —— 什么都没有
   --------------------------------------------------------------------- */
const ROLE_DEFS = {
  mtf: {
    id: 'mtf', name: '机动特遣队 Nu-7', short: 'Nu-7', weight: 30,
    faction: '基金会 · 机动特遣队', side: 'foundation',
    desc: '全副武装的收容恢复力量 —— 唯一有资格和异常正面交手的角色。',
    goal: '恢复设施 → 收容全部异常 → 清除入侵势力 → 撤离。',
    loadout: 'custom', primary: null, secondary: null, armor: 2, gear: 'scramble',
    spawn: null, objectives: 'all',
  },
  guard: {
    id: 'guard', name: '设施保安', short: '保安', weight: 25,
    faction: '基金会 · 安保部门', side: 'foundation',
    desc: '设施的秩序维护力量。有一把手枪和轻质防弹衣 —— 但挡不住收容物。',
    goal: '恢复供电 → 启动收容协议 → 活着走到地表电梯。',
    loadout: 'fixed', primary: null, secondary: 'glock18', armor: 1, gear: 'none',
    spawn: 'EZ-SEC', objectives: ['power', 'protocol', 'extract'], canPickWeapons: true,
  },
  scientist: {
    id: 'scientist', name: '科学家', short: '科学家', weight: 25,
    faction: '基金会 · 研究部门', side: 'foundation',
    desc: '没有武器，也没有护甲。你比设施里的任何一个东西都脆弱。',
    goal: '销毁泄漏的收容档案 → 活着走到地表电梯。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: 'LCZ-LAB', objectives: ['photos', 'extract'], canPickWeapons: true,
  },
  classd: {
    id: 'classd', name: 'Class-D', short: 'D 级', weight: 20,
    faction: 'D 级人员', side: 'ci',
    desc: '你什么都没有 —— 没有武器、没有护甲、没有权限，也没有人在乎你。',
    goal: '找到出口。活下去。仅此而已。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: 'EZ-OFFICE', objectives: ['extract'], canPickWeapons: true,
  },
  o79: {
    id: 'o79', name: 'SCP-079「旧 AI」', short: '079', weight: 7,
    faction: 'SCP · 收容物', side: 'scp',
    desc: '设施的主控 AI。你没有身体、没有血量，也没有武器 —— 你只有摄像头和电。',
    goal: '操纵门、电与特斯拉门，帮其他 SCP 把人类全部清除。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp', ai: true,
  },

  /* ---- 可操控的实体收容物：直接附身在设施里那只 SCP 身上 ---- */
  p173: {
    id: 'p173', name: 'SCP-173', short: '173', weight: 7,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '173',
    desc: '混凝土与钢筋构成的雕像。只要有人看着你，你就一步也动不了。',
    goal: '趁他们眨眼的那一瞬间靠近，拧断他们的脖子。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },
  p096: {
    id: 'p096', name: 'SCP-096', short: '096', weight: 7,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '096',
    desc: '你平时很温顺。但只要有人看见你的脸 —— 无论是直接看还是看照片 —— 你就再也停不下来。',
    goal: '谁看了你的脸，就冲向谁。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },
  p939: {
    id: 'p939', name: 'SCP-939', short: '939', weight: 5,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '939',
    desc: '你没有眼睛，靠声音捕猎。凡是会动、会开枪、会喘气的东西，都会在你的视野里亮起来。',
    goal: '循着声音找过去，一口咬断。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },
  p106: {
    id: 'p106', name: 'SCP-106', short: '106', weight: 5,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '106',
    desc: '腐烂的老者。墙对你来说只是空气 —— 你从里面穿过去，留下一条腐蚀的痕迹。',
    goal: '穿过墙，把撞上你的人一个一个拖走。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },
  p049: {
    id: 'p049', name: 'SCP-049', short: '049', weight: 3,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '049',
    desc: '瘟疫医生。你走得很慢，但你碰到的每一个人都会成为你的"病人" —— 而倒下的尸体还会重新站起来替你干活。',
    goal: '把设施里的人全部"治愈"。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },
  p3114: {
    id: 'p3114', name: 'SCP-3114', short: '3114', weight: 3,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '3114',
    desc: '一具会奔跑的人体骨架。你比设施里任何东西都快 —— 追上去，把他们的皮肉据为己有。',
    goal: '追上每一个还在跑的人。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },
  p076: {
    id: 'p076', name: 'SCP-076-2', short: '076-2', weight: 2,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '076',
    desc: '从石棺中苏醒的古代战士。你享受战斗本身 —— 而且倒下一次，并不代表结束。',
    goal: '把设施里的人杀光。你还有一次站起来的机会。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },
  p682: {
    id: 'p682', name: 'SCP-682', short: '682', weight: 2,
    faction: 'SCP · 收容物', side: 'scp', playable: true, scpKey: '682',
    desc: '不灭的巨蜥。你对一切生命怀有纯粹的憎恨，而你的酸液会替你把这份憎恨浇到他们身上。',
    goal: '碾平设施里所有会动的东西。',
    loadout: 'none', primary: null, secondary: null, armor: 0, gear: 'none',
    spawn: null, objectives: 'scp',
  },

  /* ---- 5K 行动：Nu-22「火箭侠」（固定角色，不进随机池）---- */
  nu22: {
    id: 'nu22', name: 'MTF Nu-22「火箭侠」', short: 'Nu-22', weight: 0,
    faction: '基金会 · Nu-22', side: 'nu22',
    desc: '为加速"清理"而组建的特遣队。小队成员都免疫 SCP-1440 的影响 —— 所以你才能把它带进来。',
    goal: '让 SCP-1440 在站点停留 5 分钟。',
    loadout: 'fixed', primary: 'hk416', secondary: 'glock18', armor: 3, gear: 'nvg',
    spawn: 'EZ-LOBBY', objectives: 'fivek',
  },

  /* ---- 5K 行动专属：反叛之狐（拒绝执行"净化令"的那一支）---- */
  rebel: {
    id: 'rebel', name: '反叛之狐', short: '反叛之狐', weight: 20,
    faction: '基金会 · 九尾狐麾下', side: 'mtf',
    missions: ['fivek'],
    desc: '九尾狐麾下的收容精锐。O5 的"净化令"下来之后，你是唯一拒绝执行的那一支 —— '
      + '他们说你是叛徒，但你知道自己从来都不是。',
    goal: '处决 SCP-1440，并清除执行净化令的 Nu-22。',
    loadout: 'fixed', primary: 'hk416', secondary: 'glock18', armor: 2, gear: 'scramble',
    // ⚠️ 复活点必须和 Nu-22 分开：Nu-22 从入口大堂突入，
    //    反叛之狐从安保站进来 —— 否则刚落地就被小队集火。
    spawn: 'EZ-SEC', objectives: 'rebel',
  },

  /* ---- 净化行动专属：Beta-7「疯帽匠」（生化 / 危险物质处理特遣队）---- */
  beta7: {
    id: 'beta7', name: 'MTF Beta-7「疯帽匠」', short: 'Beta-7', weight: 1,
    faction: '基金会 · 机动特遣队', side: 'foundation',
    missions: ['city'],
    desc: '专精生化与危险物质处理的特遣队。城里那场"瘟疫"扩散得太快了 —— '
      + '上面把你们整队扔了进来，要求只有一个：清干净。',
    goal: '关闭三处感染源，清除全部被感染者，然后撤离。',
    loadout: 'fixed', primary: 'hk416', secondary: 'glock18', armor: 3, gear: 'nvg',
    spawn: null, objectives: 'city',
  },

  /* ---- 第二身份：撤离后重新部署，不进随机池 ---- */
  ci: {
    id: 'ci', name: '混沌分裂者', short: 'CI', weight: 0,
    faction: '混沌分裂者', side: 'ci', second: true,
    desc: '你带着 Class-D 带出来的情报回来了 —— 这次你是来抢东西的。',
    goal: '清除设施内的基金会人员，然后撤离。',
    loadout: 'fixed', primary: 'mp5', secondary: 'glock18', armor: 2, gear: 'nvg',
    spawn: 'EZ-LOBBY', objectives: ['hunt', 'extract'],
  },
  mtf_spec: {
    id: 'mtf_spec', name: 'Nu-7 收容专家', short: '收容专家', weight: 0,
    faction: '基金会 · 机动特遣队', side: 'foundation', second: true,
    desc: '你从地表回来了，带着完整的收容权限和一套 HID 接口。',
    goal: '把设施里剩下的收容物全部处理掉，然后撤离。',
    loadout: 'fixed', primary: 'hk416', secondary: 'glock18', armor: 2, gear: 'scramble',
    spawn: 'EZ-LOBBY', objectives: ['purge', 'extract'],
  },
  mtf_assault: {
    id: 'mtf_assault', name: 'Nu-7 突击兵', short: '突击兵', weight: 0,
    faction: '基金会 · 机动特遣队', side: 'foundation', second: true,
    desc: '你从地表回来了，扛的是破门和清场用的家伙。',
    goal: '清剿剩余收容物、清除入侵势力，然后撤离。',
    loadout: 'fixed', primary: 'spas12', secondary: 'glock18', armor: 3, gear: 'nvg',
    spawn: 'EZ-LOBBY', objectives: ['purge', 'invaders', 'extract'],
  },
  /* ---- 第二身份：收容物被压制后，蛇之手把你"接"了过去 ---- */
  hand: {
    id: 'hand', name: '蛇之手', short: '蛇之手', weight: 0,
    faction: '蛇之手', side: 'hand', second: true,
    desc: '你被他们从收容间里放了出来 —— 现在你和他们站在一起。',
    goal: '清除设施里的基金会人员，然后撤离。',
    loadout: 'fixed', primary: 'mp5', secondary: 'glock18', armor: 1, gear: 'nvg',
    spawn: 'EZ-LOBBY', objectives: ['hunt', 'extract'],
  },
};

/* 撤离后转成的第二身份（类似 RXSEND / SL 的阵营重部署） */
const SECOND_LIFE = { classd: 'ci', scientist: 'mtf_spec', guard: 'mtf_assault' };

/* ---------------------------------------------------------------------
   部署后的「重生」：倒下就换个身份接着打（保留当前进度）。
   ⚠️ 复活是**无限次**的：第一次倒下按这张表换身份，之后再倒下保持当前身份原地复活。
   ⚠️ 和上面的 SECOND_LIFE 是两套：那个走"成功撤离转职"，这个走"被击倒"。
   --------------------------------------------------------------------- */
const REBIRTH = {
  breach: {
    mtf: 'mtf',                 // MTF：原地重新部署，装备与目标链都不变
    guard: 'mtf_assault',       // 保安 → Nu-7 突击兵
    scientist: 'mtf_spec',      // 科学家 → Nu-7 收容专家
    classd: 'ci',               // Class-D → 混沌分裂者
    // 收容物被压制 → 蛇之手把你接了过去
    o79: 'hand', p173: 'hand', p096: 'hand', p939: 'hand', p106: 'hand',
  },
};
/* 5K 只覆盖三条：科学家 → Nu-22 编制位（mtf），保安 → 反叛之狐，
   反叛之狐 → 保持自己（和 MTF 一样原地重新部署）。
   其余（异常 → 蛇之手、Class-D → CI、MTF → 保持）沿用常规表。
   ⚠️ rebel 这条不能漏 —— 漏了它就只能走 endGame 结算，进度全清、只能重开，
      而重开抽到反叛之狐又要从头等 60 秒待命。 */
const REBIRTH_FIVEK = Object.assign({}, REBIRTH.breach, {
  guard: 'rebel',
  scientist: 'mtf',
  rebel: 'rebel',
});

/* 当前身份重生成什么。
   ⚠️ 复活是**无限次**的：第一次倒下按映射换身份（Class-D → CI 之类），
      之后再倒下就保持当前身份原地复活 —— 所以这里永远返回一个合法 id，
      映射表里没有的身份（ci / hand / mtf_spec / mtf_assault）就返回它自己。 */
function rebirthRoleFor(roleId) {
  const id = roleId || (GAME && GAME.role) || 'mtf';
  const table = (GAME && GAME.mission === 'fivek') ? REBIRTH_FIVEK : REBIRTH.breach;
  return table[id] || id;
}

const ROLE_ORDER = ['mtf', 'guard', 'scientist', 'classd', 'o79',
  'p173', 'p096', 'p939', 'p106', 'p049', 'p3114', 'p076', 'p682', 'rebel'];

/* 各行动的随机池：没写 missions 的角色在所有行动里都可能抽到；
   写了 missions 的只在该行动出现（反叛之狐只存在于 5K）。 */
function rollPoolFor(mission) {
  const m = mission || (GAME && GAME.mission) || 'breach';
  // 净化行动是 Beta-7「疯帽匠」的既定任务 —— 不参与随机分配。
  // （不能只靠 ROLE_DEFS 的 missions 字段：没写 missions 的角色默认"所有行动都能抽到"，
  //   那样城市里会冒出 MTF / 保安 / 科学家。）
  if (m === 'city') return ['beta7'];
  return ROLE_ORDER.filter(k => {
    const r = ROLE_DEFS[k];
    if (!r) return false;
    if (!r.missions) return true;
    return r.missions.indexOf(m) >= 0;
  });
}

// 是不是"收容物阵营"的可玩角色（079 是 AI，其余是附身实体）
function isScpRole(role) {
  const r = role || (typeof currentRole === 'function' ? currentRole() : null);
  return !!(r && r.side === 'scp');
}

// 当前角色（默认 MTF；startGame 之前由 rollRole() 决定）
function currentRole() {
  return ROLE_DEFS[(GAME && GAME.role) || 'mtf'] || ROLE_DEFS.mtf;
}

/* 5K 行动里，「MTF Nu-7」这个编制位就是 Nu-22「火箭侠」——
   同一支特遣队，只是这次的任务是"净化"而不是"收容"，所以换了个代号。
   ⚠️ 不是把玩家固定成 Nu-22：随机分配照常进行，只是抽到 MTF 时换一层皮。 */
const FIVEK_MTF_VIEW = {
  name: 'MTF Nu-22「火箭侠」', short: 'Nu-22',
  faction: '基金会 · Nu-22',
  desc: '为加速"清理"而组建的特遣队。小队成员都免疫 SCP-1440 的影响 —— 所以你才能把它带进来。',
  goal: '守住 SCP-1440，让它在站点停留 5 分钟。',
};

/* 这一局该怎么"称呼"这个身份（只影响显示，不影响数值） */
function roleView(role) {
  const r = role || currentRole();
  if (!r) return null;
  if (GAME && GAME.mission === 'fivek' && r.id === 'mtf') return Object.assign({}, r, FIVEK_MTF_VIEW);
  return r;
}

// 按权重随机抽一个角色（只从当前行动的池子里抽）
function rollRole() {
  const pool = (typeof rollPoolFor === 'function') ? rollPoolFor() : ROLE_ORDER;
  let total = 0;
  for (const k of pool) total += ROLE_DEFS[k].weight;
  let r = Math.random() * total;
  for (const k of pool) {
    r -= ROLE_DEFS[k].weight;
    if (r <= 0) return k;
  }
  return 'mtf';
}

/* URL 上可以写 ?role=mtf|guard|scientist|classd 指定角色。
   既是自检用的固定入口，也给不想被随机支配的玩家留个口子。 */
function forcedRoleFromURL() {
  try {
    const m = /[?&]role=([a-z0-9]+)/i.exec(location.search);
    if (m) {
      const k = m[1].toLowerCase();
      if (ROLE_DEFS[k]) return k;
    }
  } catch (e) { }
  return null;
}

// 当前行动的目标链
function currentObjectives() {
  if (GAME && GAME.mission === 'contain096') return OBJECTIVES_CONTAIN096;
  if (GAME && GAME.mission === 'city') return OBJECTIVES_CITY;
  if (GAME && GAME.mission === 'fivek') {
    const id = (typeof roleView === 'function' && roleView()) ? roleView().id : null;
    // 5K 里反叛之狐的目标和 Nu-22 完全相反
    if (id === 'rebel') return OBJECTIVES_REBEL;
    // 蛇之手（由异常重生而来）：5K 没有撤离点，目标只有"清空基金会人员" ——
    // 否则会挂上一个永远做不了的「撤离」
    if (id === 'hand') return OBJECTIVES.filter(o => o.id === 'hunt');
    return OBJECTIVES_FIVEK;
  }
  const role = currentRole();
  if (role.objectives === 'all') return OBJECTIVES;
  if (role.objectives === 'scp') return OBJECTIVES_O79;
  if (role.objectives === 'rebel') return OBJECTIVES_REBEL;
  return OBJECTIVES.filter(o => role.objectives.indexOf(o.id) >= 0);
}
function currentMission() {
  return MISSIONS[(GAME && GAME.mission) || 'breach'] || MISSIONS.breach;
}
