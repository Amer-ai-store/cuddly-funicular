/* Luqta 3D product viewer ("جرّب قبل ما تختار").
 * Procedural models (armchair, headphones, textured box) with rotate / zoom / reset,
 * drag-to-rotate, pinch/wheel zoom, and a "في غرفتي" room preview at true scale
 * with a 1.75 m reference figure. Commands: {type:'rotate'|'zoomIn'|'zoomOut'|'reset'|
 * 'mode', value:'3d'|'room'} {type:'color', value:'#rrggbb'} {type:'probe', id}.
 */
(function () {
  'use strict';
  var T = window.THREE;
  var post = function (m) { var s = JSON.stringify(m); try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s); } catch (e) {} try { if (window.parent !== window) window.parent.postMessage(s, '*'); } catch (e) {} window.__luqtaLast = m; };
  if (!T) { post({ type: 'error', code: 'NO_THREE' }); return; }
  var init = window.__LUQTA_INIT__ || {};
  var canvas = document.getElementById('stage');
  var renderer;
  try { renderer = new T.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }); }
  catch (e) { post({ type: 'error', code: 'NO_WEBGL' }); return; }
  renderer.setClearColor(0, 0); renderer.outputEncoding = T.sRGBEncoding; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new T.Scene();
  var camera = new T.PerspectiveCamera(32, 1, 0.05, 60);
  scene.add(new T.HemisphereLight(0xffffff, 0xd8ccf2, 0.9));
  var k = new T.DirectionalLight(0xffffff, 0.9); k.position.set(2, 4, 3); scene.add(k);
  var r = new T.DirectionalLight(0xd2c4ff, 0.4); r.position.set(-3, 2, -2); scene.add(r);
  function std(c, ro, me) { return new T.MeshStandardMaterial({ color: c, roughness: ro == null ? 0.7 : ro, metalness: me || 0 }); }
  function at(m, p, x, y, z) { m.position.set(x || 0, y || 0, z || 0); p.add(m); return m; }
  function rbox(w, h, d, rad, mat) {
    var s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + rad, y); s.lineTo(x + w - rad, y); s.quadraticCurveTo(x + w, y, x + w, y + rad); s.lineTo(x + w, y + h - rad);
    s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h); s.lineTo(x + rad, y + h); s.quadraticCurveTo(x, y + h, x, y + h - rad); s.lineTo(x, y + rad); s.quadraticCurveTo(x, y, x + rad, y);
    var g = new T.ExtrudeGeometry(s, { depth: d - rad * 2, bevelEnabled: true, bevelThickness: rad, bevelSize: rad * 0.9, bevelSegments: 4, curveSegments: 8 });
    g.translate(0, 0, -(d - rad * 2) / 2); return new T.Mesh(g, mat);
  }
  var model = new T.Group(); scene.add(model);
  var fabric = std(init.color && /^#[0-9a-f]{6}$/i.test(init.color) ? init.color : '#d8bf98', 0.95);
  var dims = init.dimensions || { w: 0.78, d: 0.8, h: 0.82 };
  function buildChair() {
    var wood = std(0xc89a62, 0.55);
    var seat = at(rbox(0.66, 0.16, 0.62, 0.06, fabric), model, 0, 0.42, 0.03);
    at(rbox(0.6, 0.1, 0.52, 0.045, fabric), model, 0, 0.52, 0.07);
    at(rbox(0.7, 0.46, 0.16, 0.07, fabric), model, 0, 0.66, -0.27).rotation.x = -0.12;
    [-1, 1].forEach(function (sx) {
      var arm = at(rbox(0.13, 0.3, 0.66, 0.06, fabric), model, sx * 0.355, 0.55, 0.02); arm.rotation.z = sx * 0.06;
      [-1, 1].forEach(function (sz) { var leg = at(new T.Mesh(new T.CylinderGeometry(0.022, 0.014, 0.36, 12), wood), model, sx * 0.29, 0.17, sz * 0.24); leg.rotation.z = -sx * 0.12; leg.rotation.x = sz * 0.12; });
    });
    var pillow = at(rbox(0.36, 0.26, 0.1, 0.045, std(0xd2b58a, 0.95)), model, 0, 0.72, -0.15); pillow.rotation.x = -0.2;
    void seat;
  }
  function buildHeadphones() {
    var mat = std(init.color && /^#[0-9a-f]{6}$/i.test(init.color) ? init.color : '#202022', 0.45, 0.1);
    var band = at(new T.Mesh(new T.TorusGeometry(0.2, 0.022, 14, 48, Math.PI), mat), model, 0, 0.32, 0); band.scale.set(1, 1.15, 1.6);
    [-1, 1].forEach(function (sx) {
      var cup = at(new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.07, 32), mat), model, sx * 0.2, 0.3, 0); cup.rotation.z = Math.PI / 2; cup.scale.set(1, 1, 1.25);
      var pad = at(new T.Mesh(new T.TorusGeometry(0.075, 0.03, 12, 32), std(0x111111, 0.9)), model, sx * 0.165, 0.3, 0); pad.rotation.y = Math.PI / 2; pad.scale.set(1, 1.25, 1);
      at(new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.16, 8), std(0x555555, 0.3, 0.8)), model, sx * 0.205, 0.42, 0);
    });
  }
  function buildBox() {
    var g = new T.BoxGeometry(0.4, 0.55, 0.16), mats = [std(0xf3eefb), std(0xf3eefb), std(0xf3eefb), std(0xf3eefb), std(0xffffff), std(0xf3eefb)];
    var m = at(new T.Mesh(g, mats), model, 0, 0.3, 0);
    if (init.imageDataUrl) new T.TextureLoader().load(init.imageDataUrl, function (tex) { tex.encoding = T.sRGBEncoding; mats[4].map = tex; mats[4].needsUpdate = true; });
    void m;
  }
  ({ chair: buildChair, headphones: buildHeadphones, box: buildBox }[init.model] || buildBox)();
  var bbox = new T.Box3().setFromObject(model), size = bbox.getSize(new T.Vector3());
  // platform (3D mode)
  var platform = at(new T.Mesh(new T.CylinderGeometry(0.75, 0.78, 0.06, 64), std(0xece6fb, 0.8)), scene, 0, -0.03, 0);
  // room (في غرفتي mode) at true scale
  var room = new T.Group(); room.visible = false; scene.add(room);
  at(new T.Mesh(new T.PlaneGeometry(4, 4), std(0xe9dfd0, 0.9)), room, 0, 0, 0).rotation.x = -Math.PI / 2;
  at(new T.Mesh(new T.PlaneGeometry(4, 2.6), std(0xf4f0fb, 0.95)), room, 0, 1.3, -1.2);
  var side = at(new T.Mesh(new T.PlaneGeometry(4, 2.6), std(0xefe9f8, 0.95)), room, -1.6, 1.3, 0.8); side.rotation.y = Math.PI / 2;
  at(new T.Mesh(new T.CircleGeometry(0.9, 48), std(0xcfc3ea, 1)), room, 0, 0.003, 0.1).rotation.x = -Math.PI / 2;
  var person = new T.Group(); at(new T.Mesh(new T.CapsuleGeometry(0.16, 1.1, 6, 12), std(0x9c8bc9, 0.8)), person, 0, 0.71, 0); at(new T.Mesh(new T.SphereGeometry(0.12, 16, 12), std(0x9c8bc9, 0.8)), person, 0, 1.6, 0);
  person.position.set(0.95, 0, -0.4); room.add(person);
  // scale model to true dimensions in room mode
  var trueScale = dims && size.y > 0 ? dims.h / size.y : 1;
  var mode = '3d', yaw = -0.5, pitch = 0.2, dist = 2.4, auto = true, minD = 1.2, maxD = 5;
  function frame() {
    var target = mode === 'room' ? new T.Vector3(0, 0.6, 0) : new T.Vector3(0, size.y * 0.45, 0);
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(target);
  }
  function setMode(m) {
    mode = m === 'room' ? 'room' : '3d'; room.visible = mode === 'room'; platform.visible = mode === '3d';
    var s = mode === 'room' ? trueScale : 1; model.scale.set(s, s, s); dist = mode === 'room' ? 3.6 : 2.4; pitch = mode === 'room' ? 0.32 : 0.2; frame();
    post({ type: 'mode', mode: mode, dimensions: dims });
  }
  function resize() { var w = window.innerWidth || 300, h = window.innerHeight || 300; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); frame(); }
  window.addEventListener('resize', resize); resize();
  // gestures
  var drag = null, pinch = null;
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY }; auto = false; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function (e) { if (!drag) return; yaw -= (e.clientX - drag.x) * 0.01; pitch = Math.max(-0.1, Math.min(1.1, pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; frame(); });
  canvas.addEventListener('pointerup', function () { drag = null; });
  canvas.addEventListener('wheel', function (e) { dist = Math.max(minD, Math.min(maxD, dist * (e.deltaY > 0 ? 1.08 : 0.92))); frame(); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', function (e) { if (e.touches.length === 2) { var dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY, d = Math.hypot(dx, dy); if (pinch) { dist = Math.max(minD, Math.min(maxD, dist * pinch / d)); frame(); } pinch = d; } }, { passive: true });
  canvas.addEventListener('touchend', function () { pinch = null; });
  function loop(now) { requestAnimationFrame(loop); if (auto) { yaw += 0.006; frame(); } renderer.render(scene, camera); }
  requestAnimationFrame(loop);
  function command(m) {
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { return; } }
    if (!m) return;
    if (m.type === 'rotate') { auto = !auto; }
    else if (m.type === 'zoomIn') { dist = Math.max(minD, dist * 0.8); frame(); }
    else if (m.type === 'zoomOut') { dist = Math.min(maxD, dist * 1.25); frame(); }
    else if (m.type === 'reset') { yaw = -0.5; auto = true; setMode(mode); }
    else if (m.type === 'mode') setMode(m.value);
    else if (m.type === 'color' && /^#[0-9a-f]{6}$/i.test(m.value || '')) { fabric.color.set(m.value); }
    else if (m.type === 'probe') post({ type: 'probe', id: m.id, mode: mode, dist: dist, yaw: yaw, auto: auto, modelHeight: size.y * model.scale.y, dimensions: dims });
  }
  window.LuqtaViewer = { command: command };
  window.addEventListener('message', function (e) { command(e.data); });
  document.addEventListener('message', function (e) { command(e.data); });
  setMode('3d');
  post({ type: 'ready', webgl: true, model: init.model || 'box' });
})();
