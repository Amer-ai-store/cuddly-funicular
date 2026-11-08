// Self-contained WebGL product viewer. The engine is plain JavaScript kept as a string: phones run it inside a
// WebView (Hermes cannot serialise functions), and the web build evaluates the same source on a page element.
// Shapes are generated procedurally from the product's model3d spec, so no model files or CDN are needed.
// AR mode ("في غرفتي") puts the camera feed behind a transparent canvas; dragging then moves the product in the room.
export type ModelSpec = { shape: string; color: string; scale?: number };

export const VIEWER_JS = String.raw`
function mountViewer(container, spec, emit) {
  emit = emit || function () {};
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none';
  canvas.setAttribute('aria-label', 'product 3D view');
  var video = document.createElement('video');
  video.setAttribute('playsinline', ''); video.muted = true;
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';
  container.style.position = 'relative'; container.style.overflow = 'hidden';
  container.appendChild(video); container.appendChild(canvas);
  var gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false }) || canvas.getContext('experimental-webgl');
  if (!gl) { emit({ type: 'error', message: 'webgl' }); return { command: function () {}, destroy: function () {} }; }
  function hex(c) { var n = parseInt(String(c || '#7C5CFF').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function tint(rgb, k) { return rgb.map(function (v) { return k > 0 ? v + (1 - v) * k : v * (1 + k); }); }
  var base = hex(spec.color);
  var parts = [];
  function push(mesh, color) { parts.push({ mesh: mesh, color: color || base }); }
  function lathe(profile, seg) {
    var p = [], n = [], idx = [];
    for (var i = 0; i < profile.length; i++) for (var j = 0; j <= seg; j++) {
      var a = j / seg * Math.PI * 2, r = profile[i][0], y = profile[i][1];
      p.push(Math.cos(a) * r, y, Math.sin(a) * r);
      var prev = profile[Math.max(0, i - 1)], next = profile[Math.min(profile.length - 1, i + 1)];
      var dy = next[1] - prev[1], dr = next[0] - prev[0], len = Math.hypot(dy, dr) || 1;
      n.push(Math.cos(a) * dy / len, -dr / len, Math.sin(a) * dy / len);
    }
    for (var i2 = 0; i2 < profile.length - 1; i2++) for (var j2 = 0; j2 < seg; j2++) { var A = i2 * (seg + 1) + j2, B = A + seg + 1; idx.push(A, B, A + 1, B, B + 1, A + 1); }
    return { p: p, n: n, i: idx };
  }
  function box(w, h, d, y0) {
    var x = w / 2, z = d / 2, y = y0 || 0, faces = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], p = [], n = [], idx = [];
    faces.forEach(function (f, k) {
      var u = f[1] ? [1, 0, 0] : [0, 1, 0], v = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
        p.push((f[0] + u[0] * c[0] + v[0] * c[1]) * x, y + h / 2 + (f[1] + u[1] * c[0] + v[1] * c[1]) * h / 2, (f[2] + u[2] * c[0] + v[2] * c[1]) * z);
        n.push(f[0], f[1], f[2]);
      });
      idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    });
    return { p: p, n: n, i: idx };
  }
  function torus(R, r, arc, seg, cx, cy, rotY) {
    var p = [], n = [], idx = [], ring = 16;
    for (var i = 0; i <= seg; i++) for (var j = 0; j <= ring; j++) {
      var a = i / seg * arc, b = j / ring * Math.PI * 2, nx = Math.cos(a) * Math.cos(b), ny = Math.sin(a) * Math.cos(b), nz = Math.sin(b);
      var X = Math.cos(a) * (R + r * Math.cos(b)), Y = Math.sin(a) * (R + r * Math.cos(b)), Z = r * Math.sin(b);
      var c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
      p.push(cx + X * c + Z * s, cy + Y, -X * s + Z * c); n.push(nx * c + nz * s, ny, -nx * s + nz * c);
    }
    for (var i2 = 0; i2 < seg; i2++) for (var j2 = 0; j2 < ring; j2++) { var A = i2 * (ring + 1) + j2, B = A + ring + 1; idx.push(A, B, A + 1, B, B + 1, A + 1); }
    return { p: p, n: n, i: idx };
  }
  function cyl(r, h, y0, seg) { return lathe([[0, y0], [r, y0], [r, y0 + h], [0, y0 + h]], seg || 40); }
  var dark = tint(base, -0.35), light = tint(base, 0.35);
  switch (spec.shape) {
    case 'sphere': push(lathe(Array.from({ length: 25 }, function (_, i) { var a = -Math.PI / 2 + i / 24 * Math.PI; return [Math.cos(a) * 0.9, Math.sin(a) * 0.9 + 0.9]; }), 40)); push(cyl(0.05, 0.25, 1.75, 12), [0.35, 0.55, 0.2]); break;
    case 'cylinder': push(lathe([[0, 0], [0.75, 0], [0.8, 0.05], [0.8, 1.45], [0.75, 1.5], [0, 1.5]], 48)); push(cyl(0.55, 0.06, 1.5, 48), light); break;
    case 'bottle': push(lathe([[0, 0], [0.55, 0], [0.6, 0.06], [0.6, 1.2], [0.5, 1.45], [0.22, 1.65], [0.2, 1.95], [0, 1.95]], 48)); push(cyl(0.24, 0.22, 1.95, 32), dark); break;
    case 'mug': push(lathe([[0, 0], [0.62, 0], [0.66, 0.08], [0.66, 1.25], [0.58, 1.25], [0.58, 0.12], [0, 0.12]], 48)); push(torus(0.32, 0.08, Math.PI * 1.3, 24, 0.66, 0.65, 0), dark); break;
    case 'headphones': push(torus(0.85, 0.08, Math.PI, 40, 0, 0.9, 0), dark); push(cyl(0.34, 0.28, 0.0, 36), base); push(cyl(0.34, 0.28, 0.0, 36), base); parts[1].offset = [-0.85, 0.55, 0]; parts[2].offset = [0.85, 0.55, 0]; parts[1].rot = parts[2].rot = Math.PI / 2; break;
    case 'lamp': push(cyl(0.6, 0.08, 0, 40), dark); push(cyl(0.06, 1.2, 0.08, 16), dark); push(lathe([[0.25, 1.25], [0.7, 1.75], [0.68, 1.78], [0.22, 1.3]], 40), base); break;
    case 'bag': push(box(1.4, 1.2, 0.55, 0)); push(torus(0.38, 0.06, Math.PI, 24, 0, 1.2, 0), dark); break;
    default: push(box(1.3, 1.1, 0.9, 0)); push(box(1.32, 0.12, 0.92, 0.85), light);
  }
  var vs = 'attribute vec3 p;attribute vec3 n;uniform mat4 m;uniform mat4 v;varying vec3 vn;varying vec3 vp;void main(){vec4 w=m*vec4(p,1.0);vn=mat3(m)*n;vp=w.xyz;gl_Position=v*w;}';
  var fs = 'precision mediump float;uniform vec3 c;varying vec3 vn;varying vec3 vp;void main(){vec3 N=normalize(vn);vec3 L=normalize(vec3(0.5,0.9,0.6));float d=max(dot(N,L),0.0);vec3 V=normalize(vec3(0.0,1.0,4.0)-vp);float s=pow(max(dot(reflect(-L,N),V),0.0),24.0);gl_FragColor=vec4(c*(0.38+0.7*d)+vec3(0.35)*s,1.0);}';
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
  var aP = gl.getAttribLocation(prog, 'p'), aN = gl.getAttribLocation(prog, 'n'), uM = gl.getUniformLocation(prog, 'm'), uV = gl.getUniformLocation(prog, 'v'), uC = gl.getUniformLocation(prog, 'c');
  var ext = gl.getExtension('OES_element_index_uint');
  parts.forEach(function (part) {
    part.pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, part.pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(part.mesh.p), gl.STATIC_DRAW);
    part.nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, part.nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(part.mesh.n), gl.STATIC_DRAW);
    part.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ext ? new Uint32Array(part.mesh.i) : new Uint16Array(part.mesh.i), gl.STATIC_DRAW);
    part.count = part.mesh.i.length;
  });
  function mul(a, b) { var o = new Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  function persp(f, a, n, fr) { var t = 1 / Math.tan(f / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fr + n) / (n - fr), -1, 0, 0, 2 * fr * n / (n - fr), 0]; }
  function trans(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function scl(k) { return [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]; }
  var state = { yaw: 0.6, pitch: 0.25, zoom: 1, x: 0, y: 0, auto: true, ar: false, stream: null };
  var initial = JSON.parse(JSON.stringify(state));
  function size() { var r = container.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, r.width * d); canvas.height = Math.max(1, r.height * d); gl.viewport(0, 0, canvas.width, canvas.height); }
  size(); window.addEventListener('resize', size);
  var last = performance.now(), frame = 0, stopped = false;
  function draw(now) {
    if (stopped) return;
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state.auto && !state.ar) state.yaw += dt * 0.5;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    var aspect = canvas.width / canvas.height, k = (spec.scale || 1) * state.zoom * (state.ar ? 0.55 : 1);
    var view = mul(persp(0.8, aspect, 0.1, 50), mul(trans(state.x, state.y - 0.2, -4.2), mul(rotX(state.pitch), rotY(state.yaw))));
    gl.uniformMatrix4fv(uV, false, new Float32Array(view));
    parts.forEach(function (part) {
      var m = mul(scl(k), trans(0, -0.95, 0));
      if (part.offset) m = mul(m, mul(trans(part.offset[0], part.offset[1], part.offset[2]), rotZ(part.rot || 0)));
      gl.uniformMatrix4fv(uM, false, new Float32Array(m)); gl.uniform3fv(uC, new Float32Array(part.color));
      gl.bindBuffer(gl.ARRAY_BUFFER, part.pb); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.nb); gl.enableVertexAttribArray(aN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ib); gl.drawElements(gl.TRIANGLES, part.count, ext ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    });
    frame++; if (frame === 3) emit({ type: 'ready' });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  var pointers = {}, pinch = 0;
  canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); pointers[e.pointerId] = [e.clientX, e.clientY]; state.auto = false; });
  canvas.addEventListener('pointerup', function (e) { delete pointers[e.pointerId]; pinch = 0; });
  canvas.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; pinch = 0; });
  canvas.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    var ids = Object.keys(pointers), prev = pointers[e.pointerId]; pointers[e.pointerId] = [e.clientX, e.clientY];
    if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoomBy(d / pinch); pinch = d; return; }
    var dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    if (state.ar) { state.x += dx / 120; state.y -= dy / 120; } else { state.yaw += dx / 120; state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch + dy / 160)); }
    emit({ type: 'moved' });
  });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
  function zoomBy(f) { state.zoom = Math.max(0.4, Math.min(2.6, state.zoom * f)); emit({ type: 'zoom', zoom: state.zoom }); }
  function startAR() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { emit({ type: 'ar-error', message: 'unsupported' }); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (stream) {
      state.stream = stream; video.srcObject = stream; video.style.display = 'block'; video.play(); state.ar = true; state.auto = false; state.x = 0; state.y = -0.6; state.pitch = 0.15; emit({ type: 'ar', active: true });
    }).catch(function (err) { emit({ type: 'ar-error', message: String(err && err.name || err) }); });
  }
  function stopAR() { if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; video.style.display = 'none'; state.ar = false; state.x = 0; state.y = 0; emit({ type: 'ar', active: false }); }
  var api = {
    command: function (name) {
      if (name === 'reset') { var ar = state.ar, s = state.stream; state = JSON.parse(JSON.stringify(initial)); state.ar = ar; state.stream = s; if (ar) { state.auto = false; state.y = -0.6; } }
      else if (name === 'zoom-in') zoomBy(1.2); else if (name === 'zoom-out') zoomBy(1 / 1.2);
      else if (name === 'rotate-left') { state.auto = false; state.yaw -= 0.5; } else if (name === 'rotate-right') { state.auto = false; state.yaw += 0.5; }
      else if (name === 'ar-on') startAR(); else if (name === 'ar-off') stopAR();
      emit({ type: 'state', zoom: state.zoom, ar: state.ar, yaw: state.yaw });
    },
    state: function () { return { zoom: state.zoom, yaw: state.yaw, pitch: state.pitch, ar: state.ar }; },
    destroy: function () { stopped = true; stopAR(); window.removeEventListener('resize', size); container.innerHTML = ''; },
  };
  return api;
}`;

// JSON placed inside <script> must not be able to close the tag or open a comment (<, >) or end the line (U+2028/9).
const UNSAFE_IN_SCRIPT: Record<string, string> = { "<": "\\u003C", ">": "\\u003E", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\0": "\\0", "\u2028": "\\u2028", "\u2029": "\\u2029" };
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (c) => UNSAFE_IN_SCRIPT[c]);

export function viewerHtml(spec: ModelSpec, background: string) {
  const safe = { shape: String(spec.shape).replace(/[^a-z0-9]/g, ""), color: /^#[0-9a-fA-F]{6}$/.test(spec.color) ? spec.color : "#7C5CFF", scale: Number(spec.scale) || 1 };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body{margin:0;height:100%;background:${/^#[0-9a-fA-F]{6}$/.test(background) ? background : "#F1ECFF"};overflow:hidden}#v{position:absolute;inset:0}</style></head><body><div id="v"></div><script>${VIEWER_JS};var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));};window.viewer=mountViewer(document.getElementById('v'),${scriptJson(safe)},post);</script></body></html>`;
}

export type ViewerEvent = { type: "ready" | "moved" | "zoom" | "state" | "ar" | "ar-error" | "error"; zoom?: number; ar?: boolean; active?: boolean; message?: string };
export type ViewerCommand = "reset" | "zoom-in" | "zoom-out" | "rotate-left" | "rotate-right" | "ar-on" | "ar-off";
export const defaultModel = (category: string): ModelSpec => ({ shape: { electronics: "box", home: "mug", fashion: "bag", care: "bottle", drinks: "bottle", dairy: "cylinder", pantry: "box", fresh: "sphere", bakery: "box", meat: "sphere" }[category] || "box", color: "#7C5CFF", scale: 1 });
