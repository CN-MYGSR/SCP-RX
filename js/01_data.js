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
    hp: 300, speed: 13.5, radius: 0.42, height: 2.0, mass: 1.0,
    touchRange: 1.7, touchDmg: 999, atkCd: 0.5,
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
    lore: '高约 2.6 米的苍白人形，面部被皮肤完全覆盖。平时温顺，但只要有人看见它的脸 —— 无论直接、照片还是录像 —— 它都会不惜一切代价冲向观察者。',
    hint: '别直视它的脸 · 暴走后无法阻挡 · 佩戴 Project SCRAMBLE 可免疫面部识别',
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
    touchRange: 2.3, touchDmg: 42, atkCd: 0.85,
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
    touchRange: 3.0, touchDmg: 68, atkCd: 1.6,
    color: 0x3d4a34, accent: 0x8f9b62,
    roarCd: 9, acidSpit: true, acidCd: 5.5,
    lore: '体长超过六米的爬行类巨兽。它对一切生命怀有纯粹的憎恨，并且几乎无法被杀死 —— 每一次伤害都会让它适应、再生、变得更强。',
    hint: '血量极高 · 需要重型火力',
    spawnZone: 'HCZ',
  },
  '939': {
    key: '939', name: 'SCP-939', cn: '众声之口',
    obj: 'Keter', behavior: 'sonar',
    hp: 780, speed: 9.2, radius: 0.6, height: 2.2, mass: 1.2,
    touchRange: 2.4, touchDmg: 58, atkCd: 1.1,
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
    touchRange: 1.8, touchDmg: 26, atkCd: 0.9,
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
    hp: 420, speed: 16.5, radius: 0.4, height: 1.6, mass: 0.5,
    touchRange: 1.5, touchDmg: 34, atkCd: 0.45,
    color: 0xded6c2, accent: 0x8d8574,
    grabDps: 46, grabRange: 1.5,
    lore: '一具能够自主活动的完整人体骨架，最高脚程 60 公里每小时。它极度渴望人类的形体 —— 抓住猎物后，它会挖出对方的骨骼，再把自己塞进剩下的皮肉里。',
    hint: '速度极快 · 会伪装成地上的尸体',
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
  { id: 1, name: 'III-A 软质防弹衣', resist: 0.18, hp: 120, mobility: 0.99 },
  { id: 2, name: 'III 级战术背心', resist: 0.30, hp: 240, mobility: 0.96 },
  { id: 3, name: 'IV 级重型装甲', resist: 0.42, hp: 400, mobility: 0.90 },
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
};
const MISSION_ORDER = ['breach', 'contain096'];

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
    detail: 'SCP-173 需保持注视才能造成伤害；SCP-096 暴走后才能被击伤；SCP-966 需开启夜视。',
  },
  {
    id: 'extract', title: '撤离', short: '撤离',
    desc: '回到办公区入口大堂的地表电梯，按住 F 撤离。',
    detail: '清剿与档案销毁都完成之后，撤离电梯才会解锁。',
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
  ammo_smg: { name: '9mm 弹药盒', kind: 'ammo', for: ['mp5', 'glock18'], amount: 0.5, color: 0xb8b06a },
  medkit: { name: '医疗包', kind: 'heal', amount: 55, color: 0xd44b4b },
  bandage: { name: '止血绷带', kind: 'heal', amount: 22, color: 0xd8d0c0 },
  armor_plate: { name: '防弹插板', kind: 'armor', amount: 60, color: 0x6a7a8a },
  battery: { name: '装置电池', kind: 'battery', amount: 40, color: 0x5ad4a0 },
};

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

// 当前行动的目标链
function currentObjectives() {
  return (GAME && GAME.mission === 'contain096') ? OBJECTIVES_CONTAIN096 : OBJECTIVES;
}
function currentMission() {
  return MISSIONS[(GAME && GAME.mission) || 'breach'] || MISSIONS.breach;
}
