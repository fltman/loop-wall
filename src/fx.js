// Finalens effekter: Patchwerks effektnoder (src/vendor/patchwerk) körs som en
// kedja av helskärmspass på WebGL2, med dansarnas bild som indata. Varje runda
// (final) väljer fyra olika "looks", ett per kvart av minuten, och aldrig samma
// som förra rundan. Varje look är två–tre noder vars rattar pulserar på kicken
// och byter läge på taktslagen. Dansarna ritas alltid rena ovanpå (keep), så att
// de syns hur vild effekten än blir.

import { VERTEX } from './vendor/patchwerk/prelude.js';
import { composeFragment, glslType } from './vendor/patchwerk/compose.js';
import { createProgram, createQuad, createDataTexture, hexToRgb } from './vendor/patchwerk/gl.js';
import EFFECTS from './vendor/patchwerk/nodes/effects.js';

const DEFS = Object.fromEntries(EFFECTS.map((d) => [d.type, d]));

// c = { kick (0..1, avtagande efter varje slag), beat, bar, phase (0..1 i looken), energy (lagrens rattar) }
export const LOOKS = [
  { name: 'kalejdoskop', layout: 'ring', keep: 0.35, chain: [
    ['kaleidoscope', { segments: 6, spin: 0.15, offset: 0.1 }, (c) => ({ zoom: 1 + 0.25 * c.kick, segments: [6, 8, 12, 5][c.bar % 4] })],
    ['bloom', { intensity: 1.2, threshold: 0.25, radius: 0.6 }, (c) => ({ intensity: 1 + 1.5 * c.kick })],
  ] },
  { name: 'eko', layout: 'row', keep: 0.7, chain: [
    ['feedback', { decay: 0.92, zoom: 1.025, rotate: 0.01, hue: 0.02, mode: 0 }, (c) => ({ rotate: 0.03 * Math.sin(c.beat * 0.25), zoom: 1.01 + 0.03 * c.kick })],
    ['rgb-split', { amount: 0.01, style: 1 }, (c) => ({ amount: 0.004 + 0.03 * c.kick })],
  ] },
  { name: 'tunnel', layout: 'center', keep: 0.45, chain: [
    ['polar', { mode: 1, repeat: 2, spin: 0.1, amount: 1 }, (c) => ({ radius: 1 + 0.4 * c.kick, repeat: 1 + (c.bar % 3) })],
    ['bloom', { intensity: 1.4, threshold: 0.3, radius: 0.7 }, () => ({})],
  ] },
  { name: 'vätska', layout: 'ring', keep: 0.35, chain: [
    ['wave-warp', { mode: 2, freq: 4, speed: 0.8 }, (c) => ({ amount: 0.02 + 0.06 * c.kick })],
    ['gradient-map', { preset: 1, cycle: 0, amount: 0.8 }, () => ({})],
  ] },
  { name: 'halvton', layout: 'grid', keep: 0.3, chain: [
    ['halftone', { mode: 1, size: 12 }, (c) => ({ size: 8 + 18 * c.kick, angle: c.beat * 0.05 })],
    ['vignette', { amount: 0.6 }, () => ({})],
  ] },
  { name: 'glitch', layout: 'row', keep: 0.35, chain: [
    ['glitch', { rate: 8, blocks: 1, rgb: 0.7 }, (c) => ({ amount: 0.15 + 0.7 * c.kick })],
    ['rgb-split', { mode: 1, style: 1 }, (c) => ({ amount: 0.01 + 0.04 * c.kick })],
    ['crt', { scan: 0.4, curve: 0.25 }, () => ({})],
  ] },
  { name: 'speglar', layout: 'center', keep: 0.35, chain: [
    ['mirror', { mode: 4, amount: 1 }, () => ({})],
    ['tile', { mode: 1, gap: 0 }, (c) => ({ count: [1, 2, 3, 2][c.bar % 4], scrollY: 0.1 })],
    ['bloom', { intensity: 1, threshold: 0.3, radius: 0.5 }, (c) => ({ intensity: 0.8 + c.kick })],
  ] },
  { name: 'strålar', layout: 'ring', keep: 0.55, chain: [
    ['zoom-blur', { mode: 2 }, (c) => ({ strength: 0.25 + 0.45 * c.kick })],
    ['color-adjust', { saturation: 1.6, spin: 0.15, contrast: 1.2 }, () => ({})],
  ] },
  { name: 'ledvägg', layout: 'grid', keep: 0.2, chain: [
    ['pixelate', { shape: 2, size: 16 }, (c) => ({ size: 10 + 10 * (1 - c.kick) })],
    ['bloom', { intensity: 2, threshold: 0.15, radius: 0.5 }, () => ({})],
  ] },
  { name: 'konturer', layout: 'row', keep: 0.4, chain: [
    ['edges', { mode: 2, strength: 2, width: 1.5, keep: 0.1 }, () => ({})],
    ['feedback', { decay: 0.86, zoom: 0.985, hue: 0.03, mode: 0 }, (c) => ({ rotate: 0.02 * Math.sin(c.beat * 0.5) })],
  ] },
  { name: 'flöde', layout: 'ring', keep: 0.45, chain: [
    ['flow', { decay: 0.95, flow: 0.5, scale: 2.5, speed: 0.3, lift: 0.3, mode: 0 }, (c) => ({ flow: 0.3 + 0.5 * c.kick })],
    ['gradient-map', { preset: 4, cycle: 0, amount: 0.65 }, () => ({})],
  ] },
  { name: 'video', layout: 'center', keep: 0.4, chain: [
    ['vhs', { amount: 0.6, tracking: 0.3 }, (c) => ({ tracking: 0.2 + 0.6 * c.kick })],
    ['crt', { scan: 0.5, curve: 0.35 }, () => ({})],
    ['strobe', { mode: 0 }, (c) => ({ amount: c.kick > 0.9 && c.bar % 2 === 0 ? 0.6 : 0 })],
  ] },
  { name: 'virvel', layout: 'ring', keep: 0.35, chain: [
    ['swirl', { radius: 0.7 }, (c) => ({ twist: 3 * Math.sin(c.beat * 0.25) + 2 * c.kick })],
    ['kaleidoscope', { segments: 4, spin: -0.1 }, () => ({})],
    ['bloom', { intensity: 1.2, threshold: 0.3 }, () => ({})],
  ] },
];

// Fyra looks för runda n: blandade, och inga från förra rundan.
export function pickRound(n, looks = LOOKS, count = 4) {
  const order = (round) => {
    const idx = looks.map((_, i) => i);
    let seed = (round + 1) * 2654435761 % 4294967296;
    for (let i = idx.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const j = seed % (i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  };
  const prev = n > 0 ? new Set(pickRound(n - 1, looks, count)) : new Set();
  const picked = order(n).filter((i) => !prev.has(i)).slice(0, count);
  return picked.length === count ? picked : order(n).slice(0, count);
}

const BLEND = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 fragColor;
uniform sampler2D t_fx, t_src; uniform float u_keep, u_fade;
void main() {
  vec3 fx = texture(t_fx, v_uv).rgb;
  vec3 src = texture(t_src, v_uv).rgb;
  fragColor = vec4((fx + src * u_keep) * u_fade, 1.0);
}`;

export class Fx {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false }));
    if (!gl) throw new Error('WebGL2 saknas');
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.quad = createQuad(gl);
    this.programs = new Map();
    this.blend = createProgram(gl, VERTEX, BLEND);
    this.black = createDataTexture(gl, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.spectrum = createDataTexture(gl, 128, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(128));
    this.src = gl.createTexture();
    this.targets = [];
    this.look = null;
    this.frame = 0;
    this.errors = [];
  }

  program(type) {
    if (!this.programs.has(type)) {
      const def = DEFS[type];
      const p = def ? createProgram(this.gl, VERTEX, composeFragment(def)) : { error: `okänd nod ${type}` };
      if (p.error) this.errors.push(`${type}: ${p.error}`);
      this.programs.set(type, p.error ? null : p);
    }
    return this.programs.get(type);
  }

  // Förbered alla looks i förväg, så att det inte hackar när en ny börjar.
  warm() { for (const l of LOOKS) for (const [type] of l.chain) this.program(type); }

  target(i, w, h) {
    const gl = this.gl;
    const t = this.targets[i];
    if (t && t.w === w && t.h === h) return t;
    const make = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, this.float ? gl.RGBA16F : gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo };
    };
    // Två ytor per nod: nu och förra bilden (för feedback-noder).
    this.targets[i] = { w, h, a: make(), b: make(), phases: {} };
    return this.targets[i];
  }

  // Ny look: rensa feedbackens minne så att förra lookens spår inte hänger kvar.
  setLook(look) {
    if (this.look === look) return;
    this.look = look;
    for (const t of this.targets) if (t) {
      t.phases = {};
      for (const s of [t.a, t.b]) { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, s.fbo); this.gl.clearColor(0, 0, 0, 0); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
    }
  }

  // source: canvasen med dansarna. c: kick, beat, bar, phase, energy. fade: 0..1.
  render(source, look, c, dt, time, fade = 1) {
    const gl = this.gl;
    const w = this.canvas.width = source.width, h = this.canvas.height = source.height;
    this.setLook(look);
    this.frame++;
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // canvas är upp-och-ned mot uv (0,0 nere till vänster)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindVertexArray(this.quad);
    gl.viewport(0, 0, w, h);

    let input = this.src;
    look.chain.forEach(([type, base, mod], i) => {
      const def = DEFS[type];
      const prog = this.program(type);
      if (!prog) return;
      const t = this.target(i, w, h);
      [t.a, t.b] = [t.b, t.a]; // b = förra bilden
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.a.fbo);
      gl.useProgram(prog.program);
      const u = (n) => prog.uniforms.get(n);
      const set1f = (n, v) => { const l = u(n); if (l) gl.uniform1f(l, v); };
      set1f('u_time', time); set1f('u_dt', dt);
      if (u('u_frame')) gl.uniform1i(u('u_frame'), this.frame);
      if (u('u_res')) gl.uniform2f(u('u_res'), w, h);
      set1f('u_aspect', w / h);
      let unit = 0;
      const bind = (name, tex, mips = false) => {
        const l = u(name);
        if (!l) return;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (mips && tex !== this.src) gl.generateMipmap(gl.TEXTURE_2D);
        gl.uniform1i(l, unit++);
      };
      bind('t_src', input, def.lod);
      if (def.feedback) bind('t_prev', t.b.tex);
      for (const s of ['u_spectrum', 'u_spectrogram', 'u_wave']) bind(s, this.spectrum);
      const vals = { ...base, ...mod(c) };
      for (const p of def.params ?? []) {
        if (p.type === 'text') continue;
        let v = vals[p.name] ?? p.default;
        const l = u(`p_${p.name}`);
        const type = glslType(p);
        if (type === 'vec3') { if (l) gl.uniform3fv(l, hexToRgb(v)); continue; }
        if (type === 'int') { if (l) gl.uniform1i(l, Math.round(v)); continue; }
        v = Math.min(p.max, Math.max(p.min, v));
        if (p.step) v = Math.round(v / p.step) * p.step;
        if (l) gl.uniform1f(l, v);
        if (p.integrate) { t.phases[p.name] = (t.phases[p.name] ?? 0) + v * dt; set1f(`p_${p.name}_t`, t.phases[p.name]); }
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      input = t.a.tex;
    });

    // Till skärmen: effekten plus dansarna rena ovanpå.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.blend.program);
    const bu = (n) => this.blend.uniforms.get(n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input); gl.uniform1i(bu('t_fx'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.src); gl.uniform1i(bu('t_src'), 1);
    gl.uniform1f(bu('u_keep'), look.keep);
    gl.uniform1f(bu('u_fade'), fade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
