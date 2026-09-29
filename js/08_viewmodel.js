'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  08 第一人称视图模型
   手持武器的姿态、摆动、后坐、开镜、换弹动画、枪口火焰、
   战术手电与激光指示器。
   ===================================================================== */

// 复用的临时向量（每帧都要用，不要在循环里 new）
const _vmDir = V3(), _vmMuzzle = V3();

const VM = {
  root: new THREE.Group(),      // 挂在 vmScene
  gun: null,                    // 当前枪模 group
  model: null,                  // buildGunModel 的返回
  stats: null,
  wpnId: null,
  mods: {},
  // 姿态
  hipPos: V3(0.098, -0.108, -0.285),
  hipRot: V3(0, 0.06, 0),
  adsBlend: 0,
  adsTarget: 0,
  recoilP: 0, recoilY: 0,       // 后坐角速度积分
  kick: 0,                      // 后退位移
  bobT: 0, bobAmp: 0,
  swayX: 0, swayY: 0,
  reloadT: 0, reloadDur: 0, reloading: false, reloadPhase: 0,
  drawT: 0, drawDur: 0.45,
  lowerT: 0,                    // 冲刺/收枪时压低
  // 枪口
  flash: null, flashT: 0,
  flashLight: null,
  muzzleWorld: V3(),
  laserDot: null,
  spot: null,
  lastShot: -99,
  boltT: 0,
  bipodDeployed: false,

  init() {
    vmScene.add(this.root);
    // 枪口火焰（加色混合面片）
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.36),
      new THREE.MeshBasicMaterial({ map: MUZZLE_TEX, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    this.flash.visible = false;
    this.flash.renderOrder = 999;
    vmScene.add(this.flash);
    // 枪口闪光点光（照亮视图模型）
    this.flashLight = new THREE.PointLight(0xffc070, 0, 2.2, 2);
    vmScene.add(this.flashLight);
    // 激光点
    this.laserDot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.laserDot.visible = false;
    this.laserDot.userData.persist = true;
    scene.add(this.laserDot);
    // 战术手电（主场景聚光）
    this.spot = new THREE.SpotLight(0xfff2d8, 0, 20, 0.42, 0.42, 1.4);
    this.spot.castShadow = false;
    this.spot.userData.persist = true;
    this.spot.target.userData.persist = true;
    scene.add(this.spot);
    scene.add(this.spot.target);
    this.spot.visible = false;
  },

  // 换枪（重建枪模）
  equip(wpnId, mods) {
    if (this.gun) { this.root.remove(this.gun); this.gun = null; }
    this.wpnId = wpnId;
    this.mods = mods || {};
    this.stats = computeWeaponStats(wpnId, this.mods);
    this.model = buildGunModel(wpnId, this.mods);
    this.gun = this.model.group;
    this.root.add(this.gun);
    this.drawT = this.drawDur;
    this.adsBlend = 0;
    this.recoilP = this.recoilY = this.kick = 0;
    this.reloading = false;
    // 手电
    const fl = this.stats && this.stats.hasFlashlight;
    this.flashLightOn = !!fl;
    this.spot.visible = !!fl;
    this.spot.intensity = fl ? 2.6 : 0;
  },

  toggleLight() {
    if (!this.stats || !this.stats.hasFlashlight) { toast('本武器未安装战术手电', 1600, 'warn'); return false; }
    this.flashLightOn = !this.flashLightOn;
    this.spot.visible = this.flashLightOn;
    this.spot.intensity = this.flashLightOn ? 2.6 : 0;
    AudioSys.beep(this.flashLightOn);
    return this.flashLightOn;
  },

  fire(stats) {
    const s = stats || this.stats;
    if (!s) return;
    // 后坐冲量
    this.recoilP += s.recoil * 0.055;
    this.recoilY += rand(-1, 1) * s.recSide * 0.045;
    this.kick = Math.min(0.10, this.kick + s.kick * 0.9);
    this.flashT = 0.045;
    this.lastShot = nowT;
    // 枪口位置
    if (this.gun) {
      _vmMuzzle.set(0, 0, this.model.muzzleZ || -0.4);
      this.gun.localToWorld(_vmMuzzle);
      this.muzzleWorld.copy(_vmMuzzle);
      this.flash.position.copy(this.muzzleWorld);
      this.flash.rotation.z = rand(0, TAU);
      const sc = 0.7 + Math.random() * 0.55;
      this.flash.scale.set(sc, sc, sc);
      this.flash.visible = true;
      this.flashLight.position.copy(this.muzzleWorld);
      this.flashLight.intensity = 5.5;
    }
  },

  startReload(dur) {
    this.reloading = true;
    this.reloadT = 0;
    this.reloadDur = dur;
    this.reloadPhase = 0;
  },
  cancelReload() { this.reloading = false; this.reloadT = 0; },

  // 主更新
  update(dt, p) {
    if (!this.gun) return;
    const s = this.stats;
    // ---- 开镜 ----
    this.adsTarget = (p.ads && !p.sprinting) ? 1 : 0;
    const adsSpeed = 1 / Math.max(0.06, (s ? s.adsTime : 0.2));
    this.adsBlend = dampF(this.adsBlend, this.adsTarget, adsSpeed * 7.5, dt);

    // ---- 后坐回位 ----
    this.recoilP = dampF(this.recoilP, 0, 11, dt);
    this.recoilY = dampF(this.recoilY, 0, 11, dt);
    this.kick = dampF(this.kick, 0, 13, dt);

    // ---- 走动摆动 ----
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const moving = speed > 0.6 && p.onGround;
    this.bobT += dt * (moving ? (6.4 + speed * 0.5) : 1.6);
    const bobTarget = moving ? clamp(speed / 4.6, 0.25, 1.0) : 0;
    this.bobAmp = dampF(this.bobAmp, bobTarget, 8, dt);

    // ---- 鼠标摆动（惯性延迟）----
    const swayScale = 0.00055 * (1 - this.adsBlend * 0.62);
    this.swayX = dampF(this.swayX, clamp(p.mouseDX * swayScale * 60, -0.045, 0.045), 9, dt);
    this.swayY = dampF(this.swayY, clamp(p.mouseDY * swayScale * 60, -0.045, 0.045), 9, dt);

    // ---- 冲刺 / 收枪压低 ----
    const lowerTarget = (p.sprinting && !p.ads) ? 1 : 0;
    this.lowerT = dampF(this.lowerT, lowerTarget, 9, dt);

    // ---- 换弹动画 ----
    let relPos = 0, relRot = 0;
    if (this.reloading) {
      this.reloadT += dt;
      const t = clamp(this.reloadT / this.reloadDur, 0, 1);
      const ph = this.reloadPhase;
      if (ph === 0 && t > 0.18) { this.reloadPhase = 1; if (this.onMagOut) this.onMagOut(); }
      if (ph === 1 && t > 0.62) { this.reloadPhase = 2; if (this.onMagIn) this.onMagIn(); }
      if (ph === 2 && t > 0.92) { this.reloadPhase = 3; if (this.onBolt) this.onBolt(); }
      // 曲线：先下沉再抬起
      const dip = Math.sin(clamp(t / 0.9, 0, 1) * PI);
      relPos = -dip * 0.085;
      relRot = dip * 0.42;
      if (t >= 1) { this.reloading = false; this.reloadT = 0; if (this.onReloadDone) this.onReloadDone(); }
    }
    // ---- 上膛（泵动/栓动）----
    if (this.boltT > 0) { this.boltT = Math.max(0, this.boltT - dt); }

    // ---- 出枪动画 ----
    let drawPos = 0, drawRot = 0;
    if (this.drawT > 0) {
      this.drawT = Math.max(0, this.drawT - dt);
      const t = this.drawT / this.drawDur;
      drawPos = -t * 0.22; drawRot = -t * 0.8;
    }

    // ---- 位置合成 ----
    const bobX = Math.sin(this.bobT) * 0.017 * this.bobAmp;
    const bobY = Math.abs(Math.cos(this.bobT)) * -0.014 * this.bobAmp;
    const adsP = this.adsBlend;

    const hip = this.hipPos;
    // 开镜位置：把瞄具压到屏幕中心
    const adsY = -(this.model.sightY || 0.08);
    const adsX = 0, adsZ = -0.215;

    let px = lerp(hip.x, adsX, adsP) + bobX * (1 - adsP * 0.75) + this.swayX;
    let py = lerp(hip.y, adsY, adsP) + bobY * (1 - adsP * 0.75) + this.swayY;
    let pz = lerp(hip.z, adsZ, adsP) + this.kick;

    // 压低 / 换弹 / 出枪
    py += relPos * (1 - adsP) + drawPos;
    px += this.lowerT * 0.06;
    py += this.lowerT * -0.10;

    this.root.position.set(px, py, pz);

    // ---- 旋转合成 ----
    let rx = -this.recoilP + relRot * (1 - adsP * 0.5) + drawRot + this.lowerT * 0.55;
    let ry = this.swayX * 2.2 + this.recoilY;
    let rz = -this.lowerT * 0.28 + this.bobAmp * Math.sin(this.bobT * 0.5) * 0.02 + relRot * 0.3;
    this.root.rotation.set(rx, ry, rz);

    // ---- 枪口火焰衰减 ----
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
      else { this.flashLight.intensity = 5.5 * (this.flashT / 0.045); }
    }

    // ---- 战术手电 / 激光 ----
    const camPos = camera.position;
    _vmDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (this.spot.visible) {
      this.spot.position.copy(camPos).addScaledVector(_vmDir, 0.25);
      this.spot.target.position.copy(camPos).addScaledVector(_vmDir, 18);
    }
    if (this.stats && this.stats.hasLaser) {
      const hit = raycastWorld(camPos, _vmDir, 60);
      if (hit) {
        this.laserDot.visible = true;
        this.laserDot.position.copy(hit.point).addScaledVector(hit.normal, 0.02);
      } else this.laserDot.visible = false;
    } else if (this.laserDot) this.laserDot.visible = false;
  },
};

bootMark('viewmodel');
