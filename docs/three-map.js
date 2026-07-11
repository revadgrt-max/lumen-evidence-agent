/* Lumen Evidence Agent — the living map, upgraded to three.js (WebGL).
 * ------------------------------------------------------------------
 * A cinematic, depth-lit version of the discovery→clinical→regulatory map.
 * It exposes the SAME public API as the dependency-free Canvas 2D `LivingMap`
 * in app.js, so it is a drop-in: new LumenMap3D(canvas) / .reset() /
 * .setTarget(label) / .add(silo, label, flagged).
 *
 * Offline & self-contained: three.js is vendored under www/vendor/. If WebGL
 * is unavailable, LumenMap3D.supported() returns false and app.js falls back
 * to the original Canvas 2D map — the layout and behavior are preserved either
 * way. This module is loaded as <script type="module"> and publishes
 * window.LumenMap3D.
 */
import * as THREE from './vendor/three.module.min.js';

const SILOS = ['research', 'clinical', 'regulatory'];
const SILO_COLOR = { research: 0x33d6bd, clinical: 0x38d9f0, regulatory: 0xe8c36b };
const GOLD = 0xe8c36b, GOLD_BRIGHT = 0xffde8a, DANGER = 0xe0685c;
const LANE_X = { research: -2.1, clinical: 0, regulatory: 2.1 };
const FOV = 50;

// ---- shared textures (built once) -----------------------------------------
let _glowTex = null, _ringTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d'); const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace; return _glowTex;
}
function textTexture(text, { color = '#f4f1ea', weight = 500, px = 40, font = 'ui-monospace, Menlo, monospace', letter = 0 } = {}) {
  const pad = 12, c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `${weight} ${px}px ${font}`;
  const w = Math.ceil(x.measureText(text).width + letter * text.length) + pad * 2;
  const h = px + pad * 2; c.width = w; c.height = h;
  const cx = c.getContext('2d'); cx.font = `${weight} ${px}px ${font}`;
  cx.textBaseline = 'middle'; cx.textAlign = 'left';
  cx.shadowColor = 'rgba(0,0,0,0.6)'; cx.shadowBlur = 6; cx.fillStyle = color;
  let px0 = pad;
  for (const ch of text) { cx.fillText(ch, px0, h / 2); px0 += cx.measureText(ch).width + letter; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { tex: t, w, h };
}
function labelSprite(text, opts) {
  const { tex, w, h } = textTexture(text, opts);
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opts?.opacity ?? 1 });
  const sp = new THREE.Sprite(m); const scale = (opts?.scale ?? 0.5); sp.scale.set((w / h) * scale, scale, 1);
  sp.userData.aspect = w / h; sp.userData.baseScale = scale; return sp;
}
function glowSprite(colorHex, size, opacity) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: colorHex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity });
  const sp = new THREE.Sprite(m); sp.scale.set(size, size, 1); return sp;
}

export default class LumenMap3D {
  static supported() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      return !!gl && typeof THREE !== 'undefined';
    } catch (e) { return false; }
  }

  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0.2, 8);

    // lights (subtle — most "light" is emissive/additive)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.PointLight(0xffe6a8, 40, 40); key.position.set(0, 3, 5); this.scene.add(key);

    this.staticGroup = new THREE.Group(); this.scene.add(this.staticGroup);
    this.dynamic = new THREE.Group(); this.scene.add(this.dynamic);

    this._buildSilos();
    this._buildParticles();

    this.nodes = [];           // {silo, mesh, glow, caption, x, y}
    this.beams = [];           // {curve, mesh, light, p, born, color}
    this.lastNodeBySilo = {};
    this.target = null;
    this.slotCount = { research: 0, clinical: 0, regulatory: 0 };
    this.t0 = performance.now();
    this.running = true;

    this._resize();
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(canvas);
    window.addEventListener('resize', this._onWinResize = () => this._resize());
    this.renderer.setAnimationLoop((now) => this._frame(now));
  }

  _buildSilos() {
    for (const s of SILOS) {
      const cx = LANE_X[s], col = SILO_COLOR[s];
      // vertical guide line
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx, 3.2, 0), new THREE.Vector3(cx, -3.0, 0)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.16 }));
      this.staticGroup.add(line);
      // header label
      const lab = labelSprite(s.toUpperCase(), { color: '#' + col.toString(16).padStart(6, '0'), weight: 700, px: 36, letter: 3, scale: 0.34, opacity: 0.9 });
      lab.position.set(cx, 3.55, 0); this.staticGroup.add(lab);
    }
  }

  _buildParticles() {
    const N = 140, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 12; pos[i * 3 + 1] = (Math.random() - 0.5) * 9; pos[i * 3 + 2] = -2 - Math.random() * 6; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xe8c36b, size: 0.03, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
    this.particles = new THREE.Points(g, m); this.staticGroup.add(this.particles);
  }

  _fitCamera(aspect) {
    const half = (FOV / 2) * Math.PI / 180, tan = Math.tan(half);
    const Hy = 3.5, Wx = 3.3;                          // content half-extents
    const dV = Hy / tan, dH = Wx / (tan * aspect);
    this.camera.position.z = Math.min(11, Math.max(dV, dH) + 0.6);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this._fitCamera(this.camera.aspect); this.camera.updateProjectionMatrix();
  }

  reset() {
    // clear dynamic objects, keep silos + particles
    this.dynamic.clear();
    this.nodes = []; this.beams = []; this.lastNodeBySilo = {}; this.target = null;
    this.slotCount = { research: 0, clinical: 0, regulatory: 0 };
  }

  setTarget(label) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 32),
      new THREE.MeshStandardMaterial({ color: GOLD_BRIGHT, emissive: GOLD_BRIGHT, emissiveIntensity: 1.4, roughness: 0.35 }));
    const glow = glowSprite(GOLD_BRIGHT, 1.5, 0.9);
    g.add(glow); g.add(core);
    g.position.set(0, 3.0, 0);
    const tlabel = (s => s.length > 28 ? s.slice(0, 27) + '…' : s)(String(label || ''));
    const cap = labelSprite(tlabel, { color: '#ffde8a', weight: 700, px: 34, font: 'Space Grotesk, ui-sans-serif, sans-serif', scale: 0.30 });
    cap.position.set(0, -0.42, 0); g.add(cap);
    this.dynamic.add(g);
    this.target = { group: g, core, glow, pos: g.position.clone() };
  }

  add(silo, label, flagged) {
    if (!SILOS.includes(silo)) silo = 'regulatory';
    const slot = this.slotCount[silo]++;
    const x = LANE_X[silo], y = 1.9 - slot * 0.82;
    const colHex = flagged ? DANGER : SILO_COLOR[silo];
    const node = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 24),
      new THREE.MeshStandardMaterial({ color: colHex, emissive: colHex, emissiveIntensity: 1.1, roughness: 0.4 }));
    const glow = glowSprite(colHex, 0.9, 0.85);
    node.add(glow); node.add(core);
    node.position.set(x, y, 0);
    node.scale.setScalar(0.01);                     // pop-in animation
    const nlabel = (s => s.length > 22 ? s.slice(0, 21) + '…' : s)(String(label || ''));
    const cap = labelSprite(nlabel, { color: '#b4aea2', weight: 500, px: 30, scale: 0.22, opacity: 0.9 });
    cap.position.set(0, -0.3, 0); node.add(cap);
    this.dynamic.add(node);
    const rec = { silo, group: node, core, glow, x, y, born: performance.now(), colHex };
    this.nodes.push(rec);

    // beam from target
    if (this.target) this._addBeam(this.target.pos, new THREE.Vector3(x, y, 0), flagged ? DANGER : SILO_COLOR[silo]);
    // cross-silo beam from previous silo's last node (visualize the connection)
    const prevSilo = SILOS[SILOS.indexOf(silo) - 1];
    if (prevSilo && this.lastNodeBySilo[prevSilo]) {
      const p = this.lastNodeBySilo[prevSilo];
      this._addBeam(new THREE.Vector3(p.x, p.y, 0), new THREE.Vector3(x, y, 0), GOLD);
    }
    this.lastNodeBySilo[silo] = rec;
    return rec;
  }

  _addBeam(a, b, colorHex) {
    const mid = a.clone().add(b).multiplyScalar(0.5); mid.z += 0.9; mid.y += 0.25;   // bow toward camera
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    const geo = new THREE.TubeGeometry(curve, 40, 0.014, 8, false);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat); this.dynamic.add(mesh);
    const light = glowSprite(colorHex, 0.5, 0.95); this.dynamic.add(light);
    this.beams.push({ curve, mesh, light, p: 0, born: performance.now(), colorHex });
  }

  _frame(now) {
    if (!this.running) return;
    const t = (now - this.t0);
    // gentle cinematic sway
    this.camera.position.x = Math.sin(t * 0.00018) * 0.55;
    this.camera.position.y = 0.2 + Math.cos(t * 0.00015) * 0.28;
    this.camera.lookAt(0, 0.35, 0);
    if (this.particles) this.particles.rotation.z = t * 0.00002;

    // target pulse
    if (this.target) { const s = 1 + Math.sin(t * 0.004) * 0.06; this.target.glow.scale.set(1.5 * s, 1.5 * s, 1); }

    // node pop-in + subtle bob
    for (const n of this.nodes) {
      const age = (now - n.born) / 260;
      const s = age < 1 ? this._easeOut(age) : 1;
      n.group.scale.setScalar(s);
      n.group.position.y = n.y + Math.sin(t * 0.002 + n.x) * 0.015;
    }

    // beams grow + travelling light
    for (const b of this.beams) {
      b.p = Math.min(1, b.p + 0.02);
      b.mesh.material.opacity = 0.5 * b.p;
      const tt = ((now - b.born) % 1100) / 1100;                 // 0..1 loop
      const pt = b.curve.getPoint(Math.min(tt, b.p));
      b.light.position.copy(pt);
      b.light.material.opacity = 0.95 * b.p * (0.5 + 0.5 * Math.sin(tt * Math.PI));
    }

    this.renderer.render(this.scene, this.camera);
  }

  _easeOut(x) { return 1 - Math.pow(1 - Math.min(1, x), 3); }

  dispose() {
    this.running = false;
    try { this.renderer.setAnimationLoop(null); } catch (e) {}
    try { this._ro.disconnect(); } catch (e) {}
    try { window.removeEventListener('resize', this._onWinResize); } catch (e) {}
    try { this.renderer.dispose(); } catch (e) {}
  }
}

// publish for app.js (classic script) to pick up
window.LumenMap3D = LumenMap3D;
