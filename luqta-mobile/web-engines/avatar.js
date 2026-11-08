/* Luqta 3D companion — rigged humanoid with real joint animation.
 * Runs inside a WebView/iframe with THREE (r149) as a global.
 * Every pose below is produced by rotating bones of a THREE.Bone hierarchy
 * (hips → spine → chest → neck → head, shoulders → elbows → wrists,
 * hips → knees → ankles). No sprite swapping is used for motion.
 *
 * Messages in  (JSON via postMessage / window.LuqtaAvatar.command):
 *   {type:'profile', profile:{skin,hair,outfit,pants,boots,beard,accessory,faceDataUrl}}
 *     accessory: 'none' | 'glasses' | 'cap' | 'headphones'
 *   {type:'action', action:'idle'|'walk'|'run'|'jump'|'sleep'|'wake'|'cart'|'come'|'wave'|
 *                           'point'|'thumbs'|'think'|'crossed'|'listen'|'sit'|'stop'|'dance'|'sad'|'talk'}
 *   {type:'facing', yaw:<radians>}   {type:'reduceMotion', value:bool}
 *   {type:'pause', value:bool}       {type:'probe', id}
 *   {type:'processFace', dataUrl, id}
 *   {type:'snapshot', action, id}     still PNG of one pose with the current look
 * Messages out: ready, actionChanged, probe, faceProcessed, snapshot, error.
 */
(function () {
  'use strict';
  var T = window.THREE;
  var post = function (msg) {
    var s = JSON.stringify(msg);
    try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s); } catch (e) { /* ignore */ }
    try { if (window.parent && window.parent !== window) window.parent.postMessage(s, '*'); } catch (e) { /* ignore */ }
    window.__luqtaLast = msg;
    var log = window.__luqtaLog || (window.__luqtaLog = []); log.push(msg); if (log.length > 200) log.shift();
  };
  if (!T) { post({ type: 'error', code: 'NO_THREE' }); return; }

  // ---------- renderer ----------
  var canvas = document.getElementById('stage');
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;
  var renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch (e) {
    post({ type: 'error', code: 'NO_WEBGL', message: String(e && e.message || e) });
    document.body.setAttribute('data-webgl', 'none');
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new T.Scene();
  var camera = new T.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 1.05, 5.0);
  camera.lookAt(0, 0.92, 0);

  scene.add(new T.HemisphereLight(0xffffff, 0xcbbfe6, 0.85));
  var key = new T.DirectionalLight(0xffffff, 0.95); key.position.set(1.6, 3, 3.2); scene.add(key);
  var rim = new T.DirectionalLight(0xc9b6ff, 0.55); rim.position.set(-2.5, 2.2, -2); scene.add(rim);
  var fill = new T.DirectionalLight(0xffe2d6, 0.25); fill.position.set(-2, 0.6, 2.5); scene.add(fill);

  // ---------- materials ----------
  function std(color, rough, metal) { return new T.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.6 : rough, metalness: metal || 0 }); }
  var M = {
    skin: std(0xe0a27c, 0.55),
    hair: std(0x3f281b, 0.7),
    beard: std(0x3a2418, 0.85),
    tank: std(0x161616, 0.8),
    vest: std(0x141414, 0.32, 0.15),
    pants: std(0xc4161b, 0.32, 0.08),
    boots: std(0x101010, 0.42, 0.05),
    sole: std(0x050505, 0.9),
    silver: std(0xd8d8d8, 0.2, 1.0),
    band: std(0x0d0d0d, 0.5),
    eyeWhite: std(0xffffff, 0.3),
    iris: std(0x2a1a10, 0.3),
    lip: std(0xa8665a, 0.6),
    cart: std(0xd73a3a, 0.4, 0.2),
    cartWire: std(0xbfc3c9, 0.25, 0.9),
    wheel: std(0x1b1b1b, 0.7),
    frame: std(0x1b1b1f, 0.35, 0.3),
    lens: new T.MeshStandardMaterial({ color: 0x9fc4e8, transparent: true, opacity: 0.28, roughness: 0.1 }),
    cap: std(0xff6b4a, 0.6),
  };

  // ---------- geometry helpers ----------
  function capsule(r, len, mat) { var g = new T.CapsuleGeometry(r, len, 6, 14); return new T.Mesh(g, mat); }
  function sphere(r, mat, ws, hs) { return new T.Mesh(new T.SphereGeometry(r, ws || 24, hs || 18), mat); }
  function box(w, h, d, mat) { return new T.Mesh(new T.BoxGeometry(w, h, d), mat); }
  function cyl(rt, rb, h, mat, seg) { return new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 18), mat); }
  function bone(name, parent, x, y, z) { var b = new T.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); return b; }

  // ---------- skeleton ----------
  var root = new T.Group(); scene.add(root);
  var B = {};
  B.hips = bone('hips', null, 0, 0.8, 0); root.add(B.hips);
  B.spine = bone('spine', B.hips, 0, 0.12, 0);
  B.chest = bone('chest', B.spine, 0, 0.2, 0);
  B.neck = bone('neck', B.chest, 0, 0.21, 0);
  B.head = bone('head', B.neck, 0, 0.07, 0);
  ['L', 'R'].forEach(function (s) {
    var sx = s === 'L' ? 1 : -1;
    B['shoulder' + s] = bone('shoulder' + s, B.chest, 0.205 * sx, 0.14, 0);
    B['elbow' + s] = bone('elbow' + s, B['shoulder' + s], 0, -0.25, 0);
    B['wrist' + s] = bone('wrist' + s, B['elbow' + s], 0, -0.22, 0);
    B['thigh' + s] = bone('thigh' + s, B.hips, 0.1 * sx, -0.04, 0);
    B['knee' + s] = bone('knee' + s, B['thigh' + s], 0, -0.34, 0);
    B['ankle' + s] = bone('ankle' + s, B['knee' + s], 0, -0.33, 0);
  });
  B.head.scale.setScalar(1.32);
  B.chest.scale.set(1.1, 1, 1.05);
  B.shoulderL.scale.set(1 / 1.1, 1, 1 / 1.05); B.shoulderR.scale.set(1 / 1.1, 1, 1 / 1.05); B.neck.scale.set(1 / 1.1, 1, 1 / 1.05);
  var skeleton = new T.Skeleton(Object.keys(B).map(function (k) { return B[k]; }));
  window.__luqtaSkeleton = skeleton;

  // ---------- body meshes (rigidly bound to bones) ----------
  function at(mesh, parent, x, y, z) { mesh.position.set(x || 0, y || 0, z || 0); parent.add(mesh); return mesh; }
  // pelvis & belt
  at(box(0.32, 0.14, 0.2, M.pants), B.hips, 0, -0.02, 0);
  var belt = at(cyl(0.165, 0.165, 0.045, M.band, 24), B.hips, 0, 0.05, 0); belt.scale.set(1, 1, 0.66);
  at(box(0.05, 0.035, 0.02, M.silver), B.hips, 0, 0.05, 0.112);
  // torso: tank top + vest
  var abdomen = at(capsule(0.14, 0.14, M.tank), B.spine, 0, 0.06, 0); abdomen.scale.set(1.05, 1, 0.72);
  var torso = at(capsule(0.17, 0.16, M.tank), B.chest, 0, 0.04, 0); torso.scale.set(1.08, 1, 0.7);
  ['L', 'R'].forEach(function (s) {
    var sx = s === 'L' ? 1 : -1;
    var panel = at(box(0.13, 0.42, 0.03, M.vest), B.spine, 0.1 * sx, 0.2, 0.115); panel.rotation.y = -0.22 * sx;
    var lapel = at(box(0.06, 0.16, 0.02, M.vest), B.chest, 0.11 * sx, 0.12, 0.128); lapel.rotation.z = 0.35 * sx; lapel.rotation.y = -0.3 * sx;
    var side = at(box(0.03, 0.4, 0.2, M.vest), B.spine, 0.185 * sx, 0.2, 0); side.rotation.z = 0.05 * sx;
    var strap = at(box(0.09, 0.05, 0.22, M.vest), B.chest, 0.15 * sx, 0.2, 0);
    for (var i = 0; i < 3; i++) at(sphere(0.008, M.silver, 8, 6), B.spine, 0.075 * sx, 0.12 + i * 0.08, 0.132);
  });
  at(box(0.3, 0.42, 0.03, M.vest), B.spine, 0, 0.2, -0.12);
  // chain necklace
  var chain = at(new T.Mesh(new T.TorusGeometry(0.085, 0.009, 6, 28), M.silver), B.chest, 0, 0.13, 0.08);
  chain.rotation.x = 1.2; chain.scale.set(1, 1.35, 1);
  // neck & head
  at(cyl(0.055, 0.065, 0.12, M.skin), B.neck, 0, 0.03, 0);
  var head = at(sphere(0.175, M.skin, 32, 24), B.head, 0, 0.13, 0); head.scale.set(0.9, 1.06, 0.95);
  var jaw = at(sphere(0.13, M.skin, 24, 16), B.head, 0, 0.055, 0.03); jaw.scale.set(1, 0.85, 0.95);
  ['L', 'R'].forEach(function (s) { var sx = s === 'L' ? 1 : -1; at(sphere(0.035, M.skin, 12, 10), B.head, 0.155 * sx, 0.12, -0.005).scale.set(0.6, 1, 0.9); });
  // stylised face (hidden when a photo face is applied)
  var face = new T.Group(); B.head.add(face);
  ['L', 'R'].forEach(function (s) {
    var sx = s === 'L' ? 1 : -1;
    at(sphere(0.026, M.eyeWhite, 14, 10), face, 0.06 * sx, 0.15, 0.145).scale.set(1.1, 0.8, 0.5);
    at(sphere(0.014, M.iris, 12, 8), face, 0.06 * sx, 0.148, 0.157);
    var brow = at(box(0.065, 0.016, 0.018, M.hair), face, 0.062 * sx, 0.19, 0.15); brow.rotation.z = -0.12 * sx;
  });
  var nose = at(sphere(0.026, M.skin, 12, 10), face, 0, 0.11, 0.165); nose.scale.set(0.8, 1.1, 1);
  // beard & moustache
  var beard = new T.Group(); B.head.add(beard);
  var beardMain = at(sphere(0.138, M.beard, 24, 16, 0), beard, 0, 0.04, 0.045); beardMain.scale.set(1.0, 0.82, 0.92);
  var moustache = at(box(0.1, 0.022, 0.03, M.beard), beard, 0, 0.083, 0.16); moustache.rotation.x = 0.2;
  at(box(0.05, 0.012, 0.01, M.lip), face, 0, 0.068, 0.168);
  // hair: voluminous, swept back
  var hair = new T.Group(); B.head.add(hair);
  [[0, 0.27, -0.01, 0.18, 1.05, 0.62, 1.05], [0.07, 0.25, 0.07, 0.11, 1, 0.7, 1], [-0.08, 0.255, 0.06, 0.11, 1, 0.75, 1],
   [0, 0.2, -0.1, 0.17, 1, 1, 0.8], [0.13, 0.18, -0.04, 0.09, 0.8, 1.3, 1], [-0.13, 0.18, -0.04, 0.09, 0.8, 1.3, 1],
   [0.12, 0.08, -0.07, 0.07, 0.7, 1.6, 0.9], [-0.12, 0.08, -0.07, 0.07, 0.7, 1.6, 0.9], [0, 0.1, -0.13, 0.13, 1.1, 1.3, 0.7],
   [0.03, 0.3, 0.12, 0.07, 1.4, 0.6, 1.2]].forEach(function (p) {
    var h = at(sphere(p[3], M.hair, 18, 14), hair, p[0], p[1], p[2]); h.scale.set(p[4], p[5], p[6]);
  });
  // accessories (profile.accessory), mounted on the head bone so they follow every pose
  var acc = { glasses: new T.Group(), cap: new T.Group(), headphones: new T.Group() };
  Object.keys(acc).forEach(function (k) { acc[k].visible = false; B.head.add(acc[k]); });
  var accessory = 'none';
  ['L', 'R'].forEach(function (s) {
    var sx = s === 'L' ? 1 : -1;
    at(new T.Mesh(new T.TorusGeometry(0.034, 0.0065, 8, 24), M.frame), acc.glasses, 0.062 * sx, 0.152, 0.17);
    at(new T.Mesh(new T.CircleGeometry(0.031, 20), M.lens), acc.glasses, 0.062 * sx, 0.152, 0.168);
    var arm = at(box(0.008, 0.008, 0.15, M.frame), acc.glasses, 0.1 * sx, 0.156, 0.095); arm.rotation.y = 0.12 * sx;
    var cup = at(cyl(0.052, 0.052, 0.046, M.frame), acc.headphones, 0.17 * sx, 0.125, 0); cup.rotation.z = Math.PI / 2;
    var pad = at(cyl(0.046, 0.046, 0.014, M.cap), acc.headphones, 0.145 * sx, 0.125, 0); pad.rotation.z = Math.PI / 2;
  });
  at(box(0.032, 0.007, 0.007, M.frame), acc.glasses, 0, 0.158, 0.172);
  at(new T.Mesh(new T.TorusGeometry(0.186, 0.013, 8, 28, Math.PI), M.frame), acc.headphones, 0, 0.13, 0);
  var capTop = at(new T.Mesh(new T.SphereGeometry(0.19, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.cap), acc.cap, 0, 0.2, -0.01); capTop.scale.set(0.95, 0.82, 1.02);
  var brim = at(box(0.21, 0.014, 0.14, M.cap), acc.cap, 0, 0.212, 0.17); brim.rotation.x = -0.12;
  // photo face (front cap of the head sphere)
  var photoFace = null;
  function buildPhotoFace(texture, alpha) {
    if (photoFace) { B.head.remove(photoFace); photoFace.geometry.dispose(); photoFace.material.dispose(); }
    var g = new T.SphereGeometry(0.182, 40, 30, Math.PI * 1.5 - 0.95, 1.9, 0.62, 1.55);
    var mat = new T.MeshStandardMaterial({ map: texture, alphaMap: alpha, transparent: true, roughness: 0.6 });
    photoFace = new T.Mesh(g, mat); photoFace.scale.set(0.92, 1.08, 0.98); photoFace.position.set(0, 0.125, 0.006);
    B.head.add(photoFace);
  }

  // arms
  ['L', 'R'].forEach(function (s) {
    var sx = s === 'L' ? 1 : -1;
    at(sphere(0.078, M.skin), B['shoulder' + s], 0, 0, 0);
    var upper = at(capsule(0.072, 0.13, M.skin), B['shoulder' + s], 0, -0.125, 0); upper.scale.set(1, 1, 0.95);
    var bicep = at(sphere(0.066, M.skin, 16, 12), B['shoulder' + s], 0, -0.1, 0.035); bicep.scale.set(1, 1.35, 0.95);
    at(sphere(0.055, M.skin, 16, 12), B['elbow' + s], 0, 0, 0);
    at(capsule(0.058, 0.13, M.skin), B['elbow' + s], 0, -0.11, 0);
    at(cyl(0.062, 0.062, 0.05, M.band), B['elbow' + s], 0, -0.19, 0);
    for (var k = 0; k < 6; k++) { var a = k / 6 * Math.PI * 2; at(sphere(0.008, M.silver, 6, 4), B['elbow' + s], Math.cos(a) * 0.064, -0.19, Math.sin(a) * 0.064); }
    var hand = at(box(0.085, 0.095, 0.05, M.skin), B['wrist' + s], 0, -0.045, 0); hand.geometry.translate(0, 0, 0);
    var fingers = at(box(0.08, 0.055, 0.055, M.skin), B['wrist' + s], 0, -0.1, 0.01);
    var thumb = new T.Group(); thumb.name = 'thumb' + s; thumb.position.set(-0.04 * sx, -0.04, 0.02); B['wrist' + s].add(thumb);
    at(capsule(0.014, 0.04, M.skin), thumb, 0, -0.025, 0);
    B['thumb' + s] = thumb; B['fingers' + s] = fingers;
  });
  // legs
  ['L', 'R'].forEach(function (s) {
    var sx = s === 'L' ? 1 : -1;
    at(sphere(0.09, M.pants), B['thigh' + s], 0, 0, 0);
    var thigh = at(capsule(0.092, 0.19, M.pants), B['thigh' + s], 0, -0.17, 0); thigh.scale.set(1, 1, 0.95);
    var pocket = at(box(0.03, 0.11, 0.11, M.pants), B['thigh' + s], 0.09 * sx, -0.19, 0.01);
    at(box(0.032, 0.02, 0.112, std(0x9f1214, 0.4)), pocket, 0, 0.05, 0);
    at(sphere(0.075, M.pants), B['knee' + s], 0, 0, 0);
    at(capsule(0.078, 0.19, M.pants), B['knee' + s], 0, -0.15, 0);
    // boot: shaft + foot
    at(cyl(0.078, 0.082, 0.17, M.boots), B['ankle' + s], 0, 0.05, 0);
    var foot = at(box(0.14, 0.1, 0.27, M.boots), B['ankle' + s], 0, -0.045, 0.05);
    var toe = at(sphere(0.07, M.boots, 14, 10), B['ankle' + s], 0, -0.05, 0.18); toe.scale.set(1, 0.75, 1);
    at(box(0.15, 0.03, 0.3, M.sole), B['ankle' + s], 0, -0.1, 0.06);
    at(box(0.084, 0.012, 0.01, M.silver), B['ankle' + s], 0, 0.09, 0.08);
    void foot;
  });

  // shadow
  var shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  var sc = shadowCanvas.getContext('2d'); var grd = sc.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(60,30,110,0.35)'); grd.addColorStop(1, 'rgba(60,30,110,0)'); sc.fillStyle = grd; sc.fillRect(0, 0, 128, 128);
  var shadow = new T.Mesh(new T.PlaneGeometry(1.1, 0.6), new T.MeshBasicMaterial({ map: new T.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; scene.add(shadow);

  // shopping cart (child of root so it travels with the character)
  var cart = new T.Group(); cart.name = 'cart';
  (function buildCart() {
    var basket = new T.Group(); basket.position.set(0, 0.55, 0); cart.add(basket);
    var w = 0.5, d = 0.62, h = 0.36;
    at(box(w, 0.02, d, M.cartWire), basket, 0, -h / 2, 0);
    [-1, 1].forEach(function (sx) { at(box(0.02, h, d, M.cart), basket, sx * w / 2, 0, 0); });
    at(box(w, h, 0.02, M.cart), basket, 0, 0, d / 2);
    at(box(w, h * 0.8, 0.02, M.cart), basket, 0, -0.03, -d / 2);
    for (var i = -2; i <= 2; i++) at(box(0.008, h, 0.008, M.cartWire), basket, i * 0.1, 0, d / 2 + 0.012);
    // goods inside
    at(box(0.14, 0.2, 0.1, std(0x2e5aa8, 0.6)), basket, -0.12, 0.05, 0.05);
    at(box(0.1, 0.22, 0.08, std(0xf6f6f6, 0.5)), basket, 0.06, 0.07, 0.12);
    var ban = at(new T.Mesh(new T.TorusGeometry(0.07, 0.025, 8, 16, Math.PI), std(0xf5d33a, 0.5)), basket, 0.12, 0.17, -0.1); ban.rotation.z = 0.4;
    at(sphere(0.05, std(0xc9312c, 0.5)), basket, -0.05, 0.16, -0.14);
    at(sphere(0.06, std(0x4caf50, 0.7)), basket, 0.14, 0.12, 0.02);
    // frame + handle (towards the character at -z)
    [-1, 1].forEach(function (sx) {
      var post2 = at(cyl(0.012, 0.012, 0.75, M.cartWire), cart, sx * 0.24, 0.42, -0.36); post2.rotation.x = -0.25;
      at(cyl(0.012, 0.012, 0.62, M.cartWire), cart, sx * 0.22, 0.12, 0).rotation.x = Math.PI / 2;
    });
    var handle = at(cyl(0.02, 0.02, 0.56, M.cart), cart, 0, 0.78, -0.45); handle.rotation.z = Math.PI / 2;
    var wheels = [];
    [[-0.2, 0.26], [0.2, 0.26], [-0.2, -0.26], [0.2, -0.26]].forEach(function (p) {
      var wh = at(cyl(0.045, 0.045, 0.03, M.wheel, 14), cart, p[0], 0.045, p[1]); wh.rotation.z = Math.PI / 2; wheels.push(wh);
    });
    cart.userData.wheels = wheels;
  })();
  cart.position.set(0, 0, 0.62); cart.visible = false; root.add(cart);

  // sleep zzz + pillow
  function letterSprite(txt) {
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    x.fillStyle = '#7b5cc4'; x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, 32, 34);
    var sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false })); sp.scale.set(0.16, 0.16, 1); return sp;
  }
  var zzz = [letterSprite('z'), letterSprite('z'), letterSprite('Z')]; zzz.forEach(function (z) { z.visible = false; scene.add(z); });
  var pillow = sphere(0.3, std(0xcbbcf0, 0.85), 24, 16); pillow.scale.set(1.25, 0.28, 0.75); pillow.visible = false; scene.add(pillow);

  // ---------- pose system ----------
  var JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR',
    'thighL', 'thighR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'thumbL', 'thumbR'];
  function zeroPose() { var p = { rootY: 0, rootRotZ: 0, rootRotX: 0, rootX: 0, rootZ: 0 }; JOINTS.forEach(function (j) { p[j] = [0, 0, 0]; }); return p; }
  var REST_ARM = 1.28; // radians away from body (arms down)
  function base() {
    var p = zeroPose();
    p.shoulderL = [0.05, 0, REST_ARM * 0.0 + 0.12]; p.shoulderR = [0.05, 0, -0.12];
    p.elbowL = [-0.15, 0, 0]; p.elbowR = [-0.15, 0, 0];
    return p;
  }
  function S(x) { return Math.sin(x); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function ease(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  var reduceMotion = false;
  var amp = function () { return reduceMotion ? 0.45 : 1; };

  var ACTIONS = {
    idle: function (t) {
      var p = base(), b = S(t * 2.1) * 0.02 * amp();
      p.spine[0] = b; p.chest[0] = b * 0.6; p.head[1] = S(t * 0.7) * 0.12 * amp(); p.head[0] = S(t * 0.9) * 0.03;
      p.shoulderL[2] += S(t * 2.1) * 0.02; p.shoulderR[2] -= S(t * 2.1) * 0.02;
      p.hips[1] = S(t * 0.6) * 0.05 * amp();
      return p;
    },
    walk: function (t) { return gait(t, 1.0, 0.5, 0.0); },
    run: function (t) { return gait(t, 0.62, 0.85, 0.18); },
    cart: function (t) {
      var p = gait(t, 1.15, 0.38, 0.12);
      p.shoulderL = [-1.05, 0, 0.05]; p.shoulderR = [-1.05, 0, -0.05];
      p.elbowL = [-0.35, 0, 0]; p.elbowR = [-0.35, 0, 0];
      p.wristL = [0.3, 0, 0]; p.wristR = [0.3, 0, 0];
      return p;
    },
    jump: function (t) {
      var c = (t % 1.6) / 1.6, p = base(), a = amp();
      if (c < 0.22) { var k = ease(c / 0.22); crouch(p, k); p.shoulderL[0] = 0.6 * k; p.shoulderR[0] = 0.6 * k; }
      else if (c < 0.36) { var k2 = ease((c - 0.22) / 0.14); crouch(p, 1 - k2); p.shoulderL = [-2.6 * k2, 0, 0.35]; p.shoulderR = [-2.0 * k2, 0, -0.5]; p.rootY = 0.1 * k2 * a; }
      else if (c < 0.78) { var k3 = (c - 0.36) / 0.42; p.rootY = (0.1 + 0.32 * S(Math.PI * k3)) * a; p.shoulderL = [-2.6, 0, 0.35]; p.shoulderR = [-0.4, 0, -1.2]; p.elbowR = [-1.2, 0, 0]; p.thighL = [-0.9, 0, 0.05]; p.kneeL = [1.5, 0, 0]; p.thighR = [-0.2, 0, -0.05]; p.kneeR = [0.9, 0, 0]; p.ankleL = [0.3, 0, 0]; }
      else if (c < 0.9) { var k4 = ease((c - 0.78) / 0.12); crouch(p, 1 - Math.abs(k4 - 0.5) * 2); p.rootY = 0; }
      return p;
    },
    sleep: function (t) {
      var p = base(), br = S(t * 1.3) * 0.025;
      p.rootRotZ = Math.PI / 2; p.rootY = 0.2; p.rootX = 0.72;
      p.spine[0] = 0.15 + br; p.chest[0] = 0.1 + br; p.neck[0] = 0.2; p.head[2] = 0.15;
      p.shoulderL = [-0.4, 0, 0.6]; p.elbowL = [-2.2, 0, 0];
      p.shoulderR = [-1.9, 0.3, -0.2]; p.elbowR = [-1.9, 0, 0];
      p.thighL = [-0.7, 0, 0]; p.kneeL = [1.2, 0, 0]; p.thighR = [-0.5, 0, 0]; p.kneeR = [1.0, 0, 0];
      return p;
    },
    wake: function (t) {
      var p, c = Math.min(t, 3.2);
      if (c < 1.0) { p = ACTIONS.sleep(0); var k = ease(c); p.rootRotZ = Math.PI / 2 * (1 - k); p.rootY = 0.2 * (1 - k) - 0.38 * k; sit(p, k); }
      else if (c < 1.8) { p = base(); var k2 = ease((c - 1.0) / 0.8); sit(p, 1 - k2); p.rootY = -0.38 * (1 - k2); }
      else { p = base(); var k3 = S(Math.PI * clamp01((c - 1.8) / 1.4)); p.shoulderL = [-2.9 * k3, 0, 0.25]; p.shoulderR = [-2.9 * k3, 0, -0.25]; p.elbowL = [-0.4 * k3, 0, 0]; p.elbowR = [-0.4 * k3, 0, 0]; p.spine[0] = -0.12 * k3; p.head[0] = -0.2 * k3; }
      return p;
    },
    dance: function (t) {
      var p = base(), a = amp(), beat = S(t * 6), sway = S(t * 3);
      p.hips[1] = sway * 0.22 * a; p.hips[2] = sway * 0.07 * a; p.spine[2] = -sway * 0.1 * a; p.head[2] = sway * 0.12 * a;
      p.shoulderL = [-0.2, 0, 2.3 + beat * 0.3 * a]; p.elbowL = [0, 0, 0.4 + beat * 0.25 * a];
      p.shoulderR = [-0.2, 0, -2.3 + beat * 0.3 * a]; p.elbowR = [0, 0, -0.4 + beat * 0.25 * a];
      p.kneeL[0] = 0.22 + beat * 0.14 * a; p.kneeR[0] = 0.22 - beat * 0.14 * a; p.rootY = Math.abs(beat) * 0.035 * a;
      return p;
    },
    sad: function (t) {
      var p = base();
      p.neck[0] = 0.32; p.head[0] = 0.22 + S(t * 0.8) * 0.02 * amp(); p.chest[0] = 0.16; p.spine[0] = 0.08;
      p.shoulderL[0] = 0.12; p.shoulderR[0] = 0.12; p.shoulderL[2] = 0.04; p.shoulderR[2] = -0.04;
      return p;
    },
    talk: function (t) {
      var p = ACTIONS.idle(t), g = S(t * 4.5) * amp();
      p.shoulderR = [-0.75 + g * 0.2, 0.2, -0.35]; p.elbowR = [-1.35 + g * 0.25, 0, 0];
      p.shoulderL = [-0.45 - g * 0.15, -0.2, 0.3]; p.elbowL = [-1.2 - g * 0.2, 0, 0];
      p.head[1] = S(t * 1.6) * 0.15 * amp(); p.head[0] = S(t * 4.5) * 0.04 * amp();
      return p;
    },
    come: function (t) {
      var p = ACTIONS.idle(t), w = S(t * 7) * amp();
      p.shoulderR = [-1.35, 0.35, -0.25]; p.elbowR = [-1.2 - 0.55 * Math.max(0, w), 0, 0]; p.wristR = [0.4, 0, 0];
      return p;
    },
    wave: function (t) {
      var p = ACTIONS.idle(t);
      p.shoulderR = [-0.2, 0, -2.6]; p.elbowR = [0, 0, -0.35 - 0.35 * S(t * 8) * amp()];
      return p;
    },
    point: function (t) {
      var p = ACTIONS.idle(t);
      p.shoulderR = [-1.45, 0.55, -0.35]; p.elbowR = [-0.15, 0, 0]; p.wristR = [0, 0, 0];
      p.head[1] = -0.35; p.chest[1] = -0.15;
      return p;
    },
    thumbs: function (t) {
      var p = ACTIONS.idle(t);
      p.shoulderL = [-0.55, 0, 0.35]; p.elbowL = [-1.75, 0, 0]; p.wristL = [0, 0, 0]; p.thumbL = [0, 0, -2.6];
      p.head[2] = 0.08;
      return p;
    },
    think: function (t) {
      var p = ACTIONS.idle(t);
      p.shoulderR = [-1.05, 0, 0.35]; p.elbowR = [-2.35, 0, 0]; p.wristR = [0.2, 0, 0];
      p.shoulderL = [-0.35, 0, -0.35]; p.elbowL = [-1.55, 0, 0];
      p.head[0] = 0.08; p.head[2] = 0.1 + S(t * 1.2) * 0.04;
      return p;
    },
    crossed: function (t) {
      var p = ACTIONS.idle(t);
      p.shoulderL = [-0.95, 0, -0.55]; p.elbowL = [-1.95, 0, 0]; p.shoulderR = [-0.85, 0, 0.55]; p.elbowR = [-1.95, 0, 0];
      return p;
    },
    listen: function (t) {
      var p = ACTIONS.idle(t);
      p.shoulderR = [-0.6, 0, -0.95]; p.elbowR = [-2.4, 0, 0]; p.head[2] = -0.18; p.head[1] = 0.1;
      return p;
    },
    sit: function (t) {
      var p = base(); sit(p, 1); p.rootY = -0.38;
      p.shoulderR = [-0.95, 0, 0.3]; p.elbowR = [-2.3, 0, 0]; p.head[2] = 0.15; p.spine[0] = 0.2 + S(t * 2) * 0.01;
      return p;
    },
  };
  ACTIONS.stop = ACTIONS.idle;
  function gait(t, period, ampl, lean) {
    var p = base(), ph = (t / period) * Math.PI * 2, a = ampl * amp();
    p.thighL = [S(ph) * a, 0, 0.02]; p.thighR = [-S(ph) * a, 0, -0.02];
    p.kneeL = [Math.max(0, -Math.cos(ph)) * a * 1.4 + 0.05, 0, 0]; p.kneeR = [Math.max(0, Math.cos(ph)) * a * 1.4 + 0.05, 0, 0];
    p.ankleL = [-S(ph) * a * 0.3, 0, 0]; p.ankleR = [S(ph) * a * 0.3, 0, 0];
    p.shoulderL = [-S(ph) * a * 0.9, 0, 0.12]; p.shoulderR = [S(ph) * a * 0.9, 0, -0.12];
    p.elbowL = [-0.35 - Math.max(0, S(ph)) * 0.4, 0, 0]; p.elbowR = [-0.35 - Math.max(0, -S(ph)) * 0.4, 0, 0];
    p.rootY = Math.abs(Math.cos(ph)) * 0.035 * amp();
    p.hips[1] = S(ph) * 0.08 * amp(); p.chest[1] = -S(ph) * 0.1 * amp(); p.spine[0] = lean;
    return p;
  }
  function crouch(p, k) { p.rootY = -0.17 * k; p.thighL[0] = -0.95 * k; p.thighR[0] = -0.95 * k; p.kneeL[0] = 1.8 * k; p.kneeR[0] = 1.8 * k; p.ankleL[0] = -0.85 * k; p.ankleR[0] = -0.85 * k; p.spine[0] = 0.35 * k; }
  function sit(p, k) { p.thighL[0] = -1.57 * k; p.thighR[0] = -1.57 * k; p.kneeL[0] = 1.57 * k; p.kneeR[0] = 1.57 * k; p.thighL[2] = 0.1 * k; p.thighR[2] = -0.1 * k; }

  var state = { action: 'idle', started: performance.now() / 1000, yaw: 0.25, targetYaw: 0.25, paused: false };
  var current = zeroPose();
  function setAction(a) {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, a) || typeof ACTIONS[a] !== 'function') { post({ type: 'error', code: 'UNKNOWN_ACTION', action: a }); return; }
    state.action = a; state.started = performance.now() / 1000;
    cart.visible = a === 'cart';
    pillow.visible = a === 'sleep';
    zzz.forEach(function (z) { z.visible = a === 'sleep'; });
    if (typeof frameCamera === 'function') frameCamera();
    post({ type: 'actionChanged', action: a });
  }
  function apply(pose, k) {
    JOINTS.forEach(function (j) {
      var tgt = pose[j] || [0, 0, 0], cur = current[j];
      for (var i = 0; i < 3; i++) cur[i] += (tgt[i] - cur[i]) * k;
      if (B[j]) B[j].rotation.set(cur[0], cur[1], cur[2]);
    });
    ['rootY', 'rootRotZ', 'rootX', 'rootZ'].forEach(function (key2) { current[key2] += ((pose[key2] || 0) - current[key2]) * k; });
    root.position.y = current.rootY; root.position.x = current.rootX; root.position.z = current.rootZ;
    root.rotation.z = current.rootRotZ;
  }

  // ---------- profile ----------
  // Snapshots wait for a face photo that is still loading, so a still picture never shows the drawn face by mistake.
  var facePending = 0, waitingShots = [];
  function faceSettled() {
    facePending = Math.max(0, facePending - 1);
    if (!facePending) waitingShots.splice(0).forEach(function (s) { snapshot(s.action, s.id); });
  }
  function hex(c, fb) { return /^#[0-9a-fA-F]{6}$/.test(c || '') ? parseInt(c.slice(1), 16) : fb; }
  function applyProfile(pr) {
    pr = pr || {};
    M.skin.color.setHex(hex(pr.skin, 0xd9a07c));
    M.hair.color.setHex(hex(pr.hair, 0x4a2f1f));
    M.beard.color.setHex(hex(pr.beardColor || pr.hair, 0x3a2418)).multiplyScalar(0.85);
    M.vest.color.setHex(hex(pr.outfit, 0x141414));
    M.pants.color.setHex(hex(pr.pants, 0xd1191c));
    M.boots.color.setHex(hex(pr.boots, 0x101010));
    beard.visible = pr.beard !== false;
    accessory = Object.prototype.hasOwnProperty.call(acc, pr.accessory) ? pr.accessory : 'none';
    Object.keys(acc).forEach(function (k) { acc[k].visible = k === accessory; });
    hair.scale.set(1, accessory === 'cap' ? 0.7 : 1, 1);
    if (pr.faceDataUrl && /^data:image\/(png|jpeg|webp);base64,/.test(pr.faceDataUrl)) {
      facePending++;
      new T.TextureLoader().load(pr.faceDataUrl, function (tex) {
        tex.encoding = T.sRGBEncoding; buildPhotoFace(tex, faceAlpha()); face.visible = false; beardMain.visible = false; moustache.visible = false;
        faceSettled();
      }, undefined, function () { post({ type: 'error', code: 'FACE_TEXTURE' }); faceSettled(); });
    } else {
      if (photoFace) { B.head.remove(photoFace); photoFace = null; }
      face.visible = true; beardMain.visible = true; moustache.visible = true;
    }
  }
  function faceAlpha() {
    var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 62, 26, 64, 62, 62); g.addColorStop(0, '#fff'); g.addColorStop(0.75, '#fff'); g.addColorStop(1, '#000');
    x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128); x.fillStyle = g; x.beginPath(); x.ellipse(64, 62, 58, 62, 0, 0, Math.PI * 2); x.fill();
    return new T.CanvasTexture(c);
  }
  // photo → cropped face texture + sampled skin/hair colours (runs on device, nothing uploaded)
  function processFace(dataUrl, id) {
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h * 0.75) * 0.7;
        var sx = (w - side) / 2, sy = Math.max(0, h * 0.42 - side / 2);
        var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
        x.drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
        var sample = function (x0, y0, ww, hh) {
          var d = x.getImageData(x0, y0, ww, hh).data, r = [], g = [], b = [];
          for (var i = 0; i < d.length; i += 4) { r.push(d[i]); g.push(d[i + 1]); b.push(d[i + 2]); }
          var med = function (a) { a.sort(function (m, n) { return m - n; }); return a[a.length >> 1]; };
          return '#' + [med(r), med(g), med(b)].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
        };
        var skin = sample(78, 130, 100, 50), hairC = sample(70, 4, 116, 22);
        post({ type: 'faceProcessed', id: id, dataUrl: c.toDataURL('image/jpeg', 0.82), skin: skin, hair: hairC });
      } catch (e) { post({ type: 'error', id: id, code: 'FACE_PROCESS', message: String(e && e.message || e) }); }
    };
    img.onerror = function () { post({ type: 'error', id: id, code: 'FACE_LOAD' }); };
    img.src = dataUrl;
  }

  // ---------- loop ----------
  function resize() {
    var w = window.innerWidth || 200, h = window.innerHeight || 320;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // keep the full body framed whatever the slot aspect
    frameCamera();
  }
  function frameCamera() {
    var lying = state.action === 'sleep';
    var fit = lying ? Math.max(1, 2.3 / camera.aspect) : Math.max(1, 0.6 / camera.aspect);
    var ty = lying ? 0.32 : 0.86, dist = (lying ? 3.0 : 4.75) * fit;
    camera.position.set(0, ty + (lying ? 0.35 : 0.12), dist); camera.lookAt(0, ty, 0);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();
  var last = performance.now(), frames = 0, fps = 0, fpsT = last, lastRender = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (state.paused) return;
    var minDt = reduceMotion ? 1000 / 30 : 0;
    if (now - lastRender < minDt) return;
    lastRender = now;
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var t = now / 1000 - state.started;
    var actionFn = (Object.prototype.hasOwnProperty.call(ACTIONS, state.action) && typeof ACTIONS[state.action] === 'function')
      ? ACTIONS[state.action]
      : ACTIONS.idle;
    var pose = actionFn(t);
    apply(pose, 1 - Math.pow(0.0008, dt));
    state.yaw += (state.targetYaw - state.yaw) * (1 - Math.pow(0.002, dt));
    root.rotation.y = state.yaw;
    if (cart.visible) cart.userData.wheels.forEach(function (wh) { wh.rotation.x += dt * 6; });
    if (pillow.visible) pillow.position.set(-0.62, 0.08, 0);
    if (zzz[0].visible) zzz.forEach(function (z, i) { var c = ((t * 0.45 + i / 3) % 1); z.position.set(0.15 + c * 0.35, 0.55 + c * 0.7, 0.2); z.material.opacity = 1 - c; });
    shadow.scale.set(1 - current.rootY * 1.2, 1, 1 - current.rootY * 1.2);
    renderer.render(scene, camera);
    frames++; if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; }
  }
  requestAnimationFrame(loop);

  function probe(id) {
    var joints = {};
    JOINTS.forEach(function (j) { if (B[j]) joints[j] = [B[j].rotation.x, B[j].rotation.y, B[j].rotation.z].map(function (v) { return Math.round(v * 1000) / 1000; }); });
    post({ type: 'probe', id: id, action: state.action, fps: fps, bones: skeleton.bones.length, rootY: root.position.y, rootRotZ: root.rotation.z, cartVisible: cart.visible, photoFace: !!photoFace, accessory: accessory, joints: joints });
  }
  // A still picture of one pose with the current look, for the small spots that show a picture instead of the live
  // view. The pose is taken at a moment that reads well (mid-stride, top of the jump) and fully settled.
  var SNAP_AT = { walk: 0.25, run: 0.16, cart: 0.29, jump: 0.92, dance: 0.26, wave: 0.2, come: 0.22, wake: 2.6 };
  // The poses a snapshot may use, looked up by name in a Map of the engine's own actions: a received name can only
  // select one of them, never an inherited property such as __proto__.
  var POSES = new Map(Object.keys(ACTIONS).map(function (name) { return [name, ACTIONS[name]]; }));
  function snapshot(action, id) {
    var poseFn = POSES.get(action);
    if (typeof poseFn !== 'function') { post({ type: 'error', id: id, code: 'UNKNOWN_ACTION', action: action }); return; }
    if (facePending) { waitingShots.push({ action: action, id: id }); return; }
    var live = state.action;
    var props = function (a) { cart.visible = a === 'cart'; pillow.visible = a === 'sleep'; zzz.forEach(function (z) { z.visible = a === 'sleep'; }); };
    state.action = action; props(action); frameCamera();
    var t = Object.prototype.hasOwnProperty.call(SNAP_AT, action) ? SNAP_AT[action] : 0.5;
    apply(poseFn(t), 1);
    root.rotation.y = state.targetYaw;
    if (pillow.visible) pillow.position.set(-0.62, 0.08, 0);
    zzz.forEach(function (z, i) { if (z.visible) { var c = (i + 1) / 4; z.position.set(0.15 + c * 0.35, 0.55 + c * 0.7, 0.2); z.material.opacity = 1 - c * 0.6; } });
    shadow.scale.set(1 - current.rootY * 1.2, 1, 1 - current.rootY * 1.2);
    renderer.render(scene, camera);
    var dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/png'); } catch (e) { post({ type: 'error', id: id, code: 'SNAPSHOT', message: String(e && e.message || e) }); }
    state.action = live; props(live); frameCamera();
    if (dataUrl) post({ type: 'snapshot', id: id, action: action, dataUrl: dataUrl, width: canvas.width, height: canvas.height });
  }
  function command(msg) {
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (e) { return; } }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'action': setAction(String(msg.action)); break;
      case 'profile': applyProfile(msg.profile); break;
      case 'facing': state.targetYaw = Number(msg.yaw) || 0; break;
      case 'reduceMotion': reduceMotion = !!msg.value; break;
      case 'pause': state.paused = !!msg.value; break;
      case 'probe': probe(msg.id); break;
      case 'processFace': processFace(String(msg.dataUrl || ''), msg.id); break;
      case 'snapshot': snapshot(String(msg.action), msg.id); break;
      default: break;
    }
  }
  window.LuqtaAvatar = { command: command, actions: Object.keys(ACTIONS), skeleton: skeleton };
  window.addEventListener('message', function (e) { command(e.data); });
  document.addEventListener('message', function (e) { command(e.data); });
  var initial = window.__LUQTA_INIT__ || {};
  if (initial.profile) applyProfile(initial.profile);
  if (initial.reduceMotion) reduceMotion = true;
  setAction(initial.action || 'idle');
  post({ type: 'ready', webgl: true, bones: skeleton.bones.length, actions: Object.keys(ACTIONS) });
})();
