// Bilden: en kör av spöken som dansar sina lager, den som står i ringen
// längst fram, och en ring på golvet som räknar in. Ingen text: färgen
// berättar vilken roll man spelar.

import { COLOR } from './music.js';
import { handOf, placeOf } from './instrument.js';

const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32],
];
const SLOTS = [-0.24, 0.24, -0.38, 0.38, -0.12, 0.12, -0.45, 0.45];
const WHITE = [235, 240, 255];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const RGB = Object.fromEntries(Object.entries(COLOR).map(([k, v]) => [k, rgb(v)]));
const css = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

export class Visuals {
  constructor(canvas, countEl = null) {
    this.canvas = canvas;
    this.countEl = countEl;
    this.g = canvas.getContext('2d', { alpha: false }); // ogenomskinlig: det som ligger under syns aldrig
    this.particles = [];
    this.blooms = [];
    this.flash = new Map();
    this.plucks = new Map(); // id → senaste knäppen på strängen
    this.pulse = 0;
    this.last = null;
    this.frames = 0;
    this.places = new Map(); // id → var kroppen ritades senast, för toner som tänds
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.W = this.canvas.width;
    this.H = this.canvas.height;
  }

  ghostPlace(slot) {
    return { x: this.W * (0.5 + SLOTS[slot % SLOTS.length]), y: this.H * 0.44, unit: this.H * 0.1 };
  }

  livePlace(live) {
    const u = live.cx / live.aspect;
    return { x: this.W * (0.5 + (u - 0.5) * 0.6), y: this.H * 0.56, unit: this.H * 0.16 };
  }

  // Händelser från performern: ett spöke föds eller försvinner.
  born(layer) {
    const p = this.ghostPlace(layer.slot);
    const c = RGB[layer.role];
    this.burst(p.x, p.y, c, 60, this.H * 0.5);
    this.blooms.push({ x: p.x, y: p.y, c, age: 0, life: 1.2, r0: p.unit, grow: this.H * 0.6 });
  }

  gone(slot, role) {
    const p = this.ghostPlace(slot);
    this.burst(p.x, p.y, RGB[role] ?? WHITE, 40, this.H * 0.25);
  }

  burst(x, y, c, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.2 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.8, age: 0, c, size: 1 + Math.random() * 3 });
    }
  }

  // Var på kroppen en ton tänds: i handen som slog, i fötterna för en fot eller
  // studs, och mitt på strängen för ackord.
  partOf(body, place, d) {
    const at = (i) => ({ x: place.x + body.pts[2 * i] * place.unit, y: place.y + body.pts[2 * i + 1] * place.unit });
    const mid = (i, j) => { const a = at(i), b = at(j); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    if (d.role === 'chords') return mid(15, 16);
    if (d.source === 'L') return at(15);
    if (d.source === 'R') return at(16);
    return mid(27, 28);
  }

  // Strängen mellan händerna är instrumentet: höjden är tonen, lutningen är
  // förhållandet mellan händerna och längden är storleken. Den knäpps och
  // vibrerar när en ton hörs.
  string(body, place, c, alpha, pluck, now) {
    const g = this.g;
    const ax = place.x + body.pts[30] * place.unit, ay = place.y + body.pts[31] * place.unit;
    const bx = place.x + body.pts[32] * place.unit, by = place.y + body.pts[33] * place.unit;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len, ny = (bx - ax) / len; // vinkelrätt mot strängen
    const age = pluck ? now - pluck.t : Infinity;
    const amp = age < 1.5 ? pluck.amp * len * 0.12 * Math.exp(-age * 4) * Math.sin(age * 55) : 0;
    const mx = (ax + bx) / 2 + nx * amp * 2, my = (ay + by) / 2 + ny * amp * 2;
    const k = Math.min(1, alpha * (0.5 + len / (place.unit * 3)));
    for (const [w, a] of [[place.unit * 0.16, k * 0.15], [place.unit * 0.045, k * 0.95]]) {
      g.strokeStyle = css(c, a);
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo(mx, my, bx, by);
      g.stroke();
    }
  }

  // Solfjädern runt axlarna: plattor och strängar som lyser upp när de spelas.
  drawInstrument(body, place, instr, now) {
    const g = this.g;
    const c = rgb(instr.color);
    const S = (p) => ({ x: place.x + p.x * place.unit, y: place.y + p.y * place.unit });
    for (const obj of instr.layout) {
      const fl = instr.flashes.get(obj.id);
      const age = fl ? now - fl.t : Infinity;
      const k = age >= 0 && age < 0.6 ? (1 - age / 0.6) * fl.vel : 0;
      if (age >= 0 && age < 0.1 && !fl.bloomed) {
        fl.bloomed = true;
        const p = S(obj.kind === 'pad' ? placeOf(body, obj) : placeOf(body, obj, (obj.r0 + obj.r1) / 2));
        this.burst(p.x, p.y, c, 8, place.unit * 1.5);
      }
      if (obj.kind === 'pad') {
        const p = S(placeOf(body, obj));
        const r = obj.size * place.unit * (1 + 0.15 * k);
        g.fillStyle = css(c, 0.05 + 0.5 * k);
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = css(c, 0.4 + 0.6 * k);
        g.lineWidth = place.unit * (0.03 + 0.04 * k);
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
      } else {
        const a = S(placeOf(body, obj, obj.r0)), b = S(placeOf(body, obj, obj.r1));
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const wob = k ? Math.sin(age * 70) * k * place.unit * 0.12 : 0;
        for (const [w, al] of [[place.unit * 0.12, 0.1 + 0.3 * k], [place.unit * 0.03, 0.45 + 0.55 * k]]) {
          g.strokeStyle = css(c, al);
          g.lineWidth = w;
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.quadraticCurveTo((a.x + b.x) / 2 + nx * wob, (a.y + b.y) / 2 + ny * wob, b.x, b.y);
          g.stroke();
        }
      }
    }
  }

  // Livejammet: sex zoner på rad, en per instrument. Golvet visar zonerna i sina
  // färger; i varje zon står dess spelare med rattbågar, avståndslinje och (för de
  // tonala) en liten sekvens ovanför huvudet. En tom zon andas och bjuder in.
  drawJam({ now, beat, zones }) {
    const { g, W, H } = this;
    this.last = now;
    this.frames++;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(3,3,9,0.35)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const n = zones.length, zw = W / n;
    const frac = ((beat % 1) + 1) % 1;
    zones.forEach((z, i) => {
      const c = rgb(z.color);
      const cx = zw * (i + 0.5);
      // Golvet: zonens band, starkare när någon spelar.
      g.fillStyle = css(c, z.present ? 0.35 : 0.08 + 0.08 * Math.exp(-frac * 3));
      g.fillRect(zw * i + 4, H * 0.93, zw - 8, H * 0.012);
      if (i) { g.fillStyle = css(WHITE, 0.05); g.fillRect(zw * i, H * 0.15, 1, H * 0.8); }
      const place = { x: cx, y: H * 0.56, unit: Math.min(H * 0.12, zw * 0.22) };
      if (!z.present || !z.body) {
        g.strokeStyle = css(c, 0.15 + 0.15 * Math.exp(-frac * 3));
        g.lineWidth = 2;
        g.beginPath(); g.ellipse(cx, H * 0.88, zw * 0.3, zw * 0.05, 0, 0, Math.PI * 2); g.stroke();
        return;
      }
      // Människor lyser och får en spotlight och en markör; dockor är dämpade.
      const human = z.human;
      if (human) {
        const top = H * 0.02, foot = H * 0.88;
        const grad = g.createLinearGradient(0, top, 0, foot);
        grad.addColorStop(0, css(c, 0));
        grad.addColorStop(1, css(c, 0.16));
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(cx - zw * 0.08, top); g.lineTo(cx + zw * 0.08, top); g.lineTo(cx + zw * 0.36, foot); g.lineTo(cx - zw * 0.36, foot); g.closePath(); g.fill();
        g.fillStyle = css(c, 0.35 + 0.2 * Math.exp(-frac * 3));
        g.beginPath(); g.ellipse(cx, H * 0.88, zw * 0.3, zw * 0.05, 0, 0, Math.PI * 2); g.fill();
        const head = { x: place.x + z.body.pts[0] * place.unit, y: place.y + z.body.pts[1] * place.unit - place.unit * 0.55 };
        g.fillStyle = css(WHITE, 0.9);
        g.beginPath(); g.moveTo(head.x, head.y - place.unit * 0.12); g.lineTo(head.x + place.unit * 0.09, head.y); g.lineTo(head.x, head.y + place.unit * 0.12); g.lineTo(head.x - place.unit * 0.09, head.y); g.closePath(); g.fill();
      }
      this.drawKnobs(z.body, place, { color: z.color, values: z.live }, human ? 1 : 0.45);
      this.drawSpread(z.body, place, z.inst, z.color, z.live.c, human ? 1 : 0.45);
      if (human) this.figure(z.body, place, WHITE, 0.85, place.unit * 0.11, [{ bones: BONES, c, k: 0.5 + 0.5 * Math.max(z.live.a, z.live.b) }]);
      else this.figure(z.body, place, c, 0.4, place.unit * 0.07);
      if (z.seq) this.drawSeq(z.seq, { x0: zw * i + zw * 0.1, w: zw * 0.8, y: H * 0.13, h: H * 0.07 });
    });
    if (this.countEl) this.countEl.style.opacity = '0';
  }

  // Finalen: dansarna i en formation (ring, rad, mitten, rutnät) som pulserar på
  // kicken. Effekterna läggs på i src/fx.js; här ritas bara dansarna, rena.
  // När formationen byts glider varje dansare till sin nya plats.
  drawShow({ now, beat, ghosts, layout, kick, fade = 1, elapsed = 0 }) {
    const { g, W, H } = this;
    const dt = this.last == null ? 0 : Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    this.frames++;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#030309';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const n = Math.max(1, ghosts.length);
    const spot = (i) => {
      if (layout === 'row') return { x: W * (0.1 + (0.8 * (i + 0.5)) / n), y: H * 0.48, unit: H * 0.12 };
      if (layout === 'center') return { x: W / 2 + (i - (n - 1) / 2) * H * 0.05, y: H * 0.5, unit: H * 0.2 };
      if (layout === 'grid') return { x: W * (0.2 + 0.3 * (i % 3)), y: H * (0.3 + 0.42 * Math.floor(i / 3)), unit: H * 0.1 };
      const a = (i / n) * Math.PI * 2 + elapsed * 0.25; // ring
      return { x: W / 2 + Math.cos(a) * H * 0.28, y: H / 2 + Math.sin(a) * H * 0.28, unit: H * 0.085 };
    };
    this.showPos ??= new Map();
    const k = 1 - Math.exp(-dt / 0.25);
    ghosts.forEach((gh, i) => {
      if (!gh.body) return;
      const target = spot(i);
      const pos = this.showPos.get(gh.layer.id) ?? this.ghostPlace(gh.layer.slot);
      pos.x += (target.x - pos.x) * k; pos.y += (target.y - pos.y) * k; pos.unit += (target.unit - pos.unit) * k;
      this.showPos.set(gh.layer.id, pos);
      const place = { ...pos, unit: pos.unit * (1 + 0.1 * kick) };
      this.figure(gh.body, place, rgb(COLOR[gh.layer.role]), (0.8 + 0.2 * kick) * fade, place.unit * 0.11);
    });
    if (this.countEl) this.countEl.style.opacity = '0';
  }

  // Sekvensern: en rad steg överst. Stapelns höjd är tonen, markören är steget som
  // spelas nu; skriver höger arm lyser markörens steg upp i instrumentets färg.
  drawSeq(seq, rect = null) {
    const g = this.g, W = this.W, H = this.H;
    const c = rgb(seq.color);
    const n = seq.steps.length;
    const { x0, w, y, h } = rect ?? { x0: W * 0.2, w: W * 0.6, y: H * 0.2, h: H * 0.12 };
    const cell = w / n;
    const norm = (v) => {
      if (v == null) return null;
      if (seq.inst === 'chords') return (v + 1) / 6;
      const midi = seq.inst === 'bass' ? 38 + v.n : v;
      const lo = seq.inst === 'bass' ? 38 : 60, hi = lo + 26;
      return Math.min(1, Math.max(0.05, (midi - lo) / (hi - lo)));
    };
    for (let i = 0; i < n; i++) {
      const v = norm(seq.steps[i]);
      const here = i === seq.play;
      const x = x0 + i * cell + cell * 0.15, bw = cell * 0.7;
      const hit = here && seq.writing;
      if (v == null) {
        g.fillStyle = css(c, here ? 0.6 : 0.2);
        g.fillRect(x + bw / 2 - 2, y - 2, 4, 4);
        continue;
      }
      g.fillStyle = css(hit ? WHITE : c, hit ? 1 : here ? 0.9 : 0.35);
      g.fillRect(x, y - v * h, bw, v * h);
    }
    if (seq.play >= 0) {
      g.strokeStyle = css(c, 0.8);
      g.lineWidth = 2;
      g.strokeRect(x0 + seq.play * cell, y - h - 6, cell, h + 10);
    }
  }

  // Tredje ratten, avståndet mellan händerna: en linje mellan dem som blir starkare
  // ju längre isär, med instrumentets egen karaktär (röstvåg, pixlar, ekon …).
  drawSpread(body, place, inst, color, c, alpha = 1) {
    if (c < 0.03) return;
    const g = this.g, col = rgb(color);
    const at = (i) => ({ x: place.x + body.pts[2 * i] * place.unit, y: place.y + body.pts[2 * i + 1] * place.unit });
    const h1 = at(15), h2 = at(16);
    const dx = h2.x - h1.x, dy = h2.y - h1.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const line = (off, w, al, wave = 0, freq = 0) => {
      g.strokeStyle = css(col, al * alpha);
      g.lineWidth = w;
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const f = i / 24, s = Math.sin(f * Math.PI) * wave * Math.sin(f * freq * Math.PI * 2 + this.frames * 0.3);
        const x = h1.x + dx * f + nx * (off + s), y = h1.y + dy * f + ny * (off + s);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    if (inst === 'perc') { // bitcrush: smulig pixellinje
      const n = 8 + Math.round(c * 24);
      for (let i = 0; i <= n; i++) {
        const f = i / n, s = place.unit * (0.04 + 0.1 * c * Math.random()), j = place.unit * 0.25 * c;
        g.fillStyle = css(col, (0.35 + 0.65 * Math.random()) * alpha);
        g.fillRect(h1.x + dx * f + (Math.random() - 0.5) * j, h1.y + dy * f + (Math.random() - 0.5) * j, s, s);
      }
      return;
    }
    if (inst === 'melody') { for (let e = 0; e < 3; e++) line(e * place.unit * 0.12, place.unit * 0.04, (0.7 - e * 0.2) * c); return; } // eko
    if (inst === 'arp') { for (let o = 0; o <= Math.round(c * 2); o++) line(-o * place.unit * 0.14, place.unit * 0.04, 0.8 * c); return; } // oktaver
    const wave = inst === 'drums' || inst === 'bass' ? place.unit * 0.12 * c : 0; // röst och squelch vibrerar
    line(0, place.unit * (0.06 + 0.12 * c), 0.25 * c, wave, inst === 'bass' ? 6 : 3);
    line(0, place.unit * 0.04, 0.5 + 0.5 * c, wave, inst === 'bass' ? 6 : 3);
  }

  // Rattarna: en båge runt varje axel, från armen hängande (0) till rakt upp (1),
  // fylld så långt som ratten står. Armen är visaren. knobs = { color, values: { a, b } }
  // (ratt C ritas av drawSpread).
  drawKnobs(body, place, knobs, alpha = 1) {
    const g = this.g;
    const c = rgb(knobs.color);
    for (const [side, v] of [['L', knobs.values.a], ['R', knobs.values.b]]) {
      const sh = side === 'L' ? 11 : 12, out = side === 'L' ? -1 : 1;
      const cx = place.x + body.pts[2 * sh] * place.unit, cy = place.y + body.pts[2 * sh + 1] * place.unit;
      const R = place.unit * 1.45;
      // Vinkel från "rakt ner" utåt; canvas mäter från x-axeln.
      const ang = (deg) => (out > 0 ? Math.PI / 2 - (deg * Math.PI) / 180 : Math.PI / 2 + (deg * Math.PI) / 180);
      const a0 = ang(15), a1 = ang(175), av = ang(15 + v * 160);
      const ccw = out > 0;
      g.lineCap = 'round';
      g.strokeStyle = css(c, 0.15 * alpha);
      g.lineWidth = place.unit * 0.08;
      g.beginPath(); g.arc(cx, cy, R, a0, a1, ccw); g.stroke();
      for (const [w, al] of [[place.unit * 0.3, 0.15 + 0.2 * v], [place.unit * 0.09, 0.6 + 0.4 * v]]) {
        g.strokeStyle = css(c, al * alpha);
        g.lineWidth = w;
        g.beginPath(); g.arc(cx, cy, R, a0, av, ccw); g.stroke();
      }
      g.fillStyle = css(c, alpha);
      g.beginPath(); g.arc(cx + Math.cos(av) * R, cy + Math.sin(av) * R, place.unit * 0.1, 0, Math.PI * 2); g.fill();
    }
  }

  // Där handen räknas (lite förbi handleden): det man ser är det som träffar.
  drawHands(body, place, c) {
    const g = this.g;
    for (const side of ['L', 'R']) {
      const h = handOf(body, side);
      g.fillStyle = css(c, 0.9);
      g.beginPath();
      g.arc(place.x + h.x * place.unit, place.y + h.y * place.unit, place.unit * 0.07, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Hela kroppen lyser upp i instrumentets färg en stund efter varje ton.
  glow(id, instrument) {
    const f = this.flash.get(id) ?? 0;
    return f > 0.05 ? [{ bones: BONES, c: RGB[instrument], k: Math.min(1, f) }] : [];
  }

  draw(scene) {
    const { g, W, H } = this;
    const now = scene.now;
    const dt = this.last == null ? 0 : Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    this.frames++;

    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(3,3,9,0.3)';
    g.fillRect(0, 0, W, H);

    this.pulse *= Math.exp(-dt * 7);
    for (const [id, v] of this.flash) this.flash.set(id, v * Math.exp(-dt * 6));
    if (this.pulse > 0.01) {
      const grad = g.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.9);
      grad.addColorStop(0, css(RGB.drums, 0.22 * this.pulse));
      grad.addColorStop(1, css(RGB.drums, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }

    g.globalCompositeOperation = 'lighter';

    // Spökena, äldst först och svagast.
    const n = scene.ghosts.length;
    for (const gh of scene.ghosts) {
      if (!gh.body) continue;
      const place = this.ghostPlace(gh.layer.slot);
      this.places.set(gh.layer.id, { body: gh.body, place });
      const age = n > 1 ? gh.rank / (n - 1) : 1;
      const a = 0.3 + 0.4 * age + 0.3 * (this.flash.get(gh.layer.id) ?? 0);
      if (!gh.knobs) this.string(gh.body, place, RGB[gh.layer.role], a, this.plucks.get(gh.layer.id), now);
      this.figure(gh.body, place, RGB[gh.layer.role], Math.min(1, a), place.unit * 0.09, this.glow(gh.layer.id, gh.layer.role));
      if (gh.knobs) this.drawKnobs(gh.body, place, { color: COLOR[gh.layer.role], values: gh.knobs }, Math.min(1, a));
      if (gh.knobs) this.drawSpread(gh.body, place, gh.layer.role, COLOR[gh.layer.role], gh.knobs.c ?? 0, Math.min(1, a));
    }

    // Den som dansar nu.
    const live = scene.live;
    let liveColor = WHITE;
    if (live) {
      const place = this.livePlace(live);
      this.places.set('live', { body: live.body, place });
      // Instrumentet är bestämt i förväg, så färgen syns redan innan man börjar.
      const inst = scene.style?.instrument;
      liveColor = inst && scene.phase !== 'rest' ? RGB[inst] : WHITE;
      const a = scene.phase === 'rec' ? 1 : scene.phase === 'rest' ? 0.45 : 0.75;
      if (scene.liveActive && inst) this.string(live.body, place, RGB[inst], 0.9, this.plucks.get('live'), now);
      if (scene.instrument) this.drawInstrument(live.body, place, scene.instrument, now);
      if (scene.knobs) this.drawKnobs(live.body, place, scene.knobs);
      if (scene.seq) this.drawSeq(scene.seq);
      if (scene.spread) this.drawSpread(live.body, place, scene.spread.inst, scene.spread.color, scene.spread.c);
      this.figure(live.body, place, WHITE, a * 0.6, place.unit * 0.1, inst ? this.glow('live', inst) : []);
      if (scene.instrument) this.drawHands(live.body, place, rgb(scene.instrument.color));
    } else {
      this.places.delete('live');
    }

    // Tonerna tänds där de hör hemma på kroppen.
    for (const d of scene.due) {
      if (d.voice === 'kick' || d.voice === 'tom') this.pulse = Math.max(this.pulse, d.vel);
      this.flash.set(d.id, Math.max(this.flash.get(d.id) ?? 0, d.vel));
      if (d.role !== 'drums' && d.role !== 'perc' || d.source !== 'B') this.plucks.set(d.id, { t: now, amp: d.vel });
      const at = this.places.get(d.id);
      if (!at) continue;
      const p = this.partOf(at.body, at.place, d);
      const c = RGB[d.role];
      const big = d.role === 'pad';
      this.blooms.push({ x: p.x, y: p.y, c, age: 0, life: big ? 1.4 : 0.5, r0: at.place.unit * (big ? 0.5 : 0.12), grow: at.place.unit * (big ? 2.5 : 1.6) * d.vel });
      if (!big) this.burst(p.x, p.y, c, 3 + Math.round(d.vel * 5), at.place.unit * 1.5);
    }

    this.ring(scene, liveColor);
    this.countdown(scene, liveColor);

    for (const b of this.blooms) {
      b.age += dt;
      const k = b.age / b.life;
      if (k >= 1) continue;
      g.strokeStyle = css(b.c, (1 - k) * 0.8);
      g.lineWidth = Math.max(1, b.r0 * 0.25 * (1 - k));
      g.beginPath();
      g.arc(b.x, b.y, b.r0 + b.grow * k, 0, Math.PI * 2);
      g.stroke();
    }
    this.blooms = this.blooms.filter((b) => b.age < b.life);

    for (const p of this.particles) {
      p.age += dt;
      p.vx *= Math.exp(-dt * 2);
      p.vy = p.vy * Math.exp(-dt * 2) + H * 0.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      if (k >= 1) continue;
      g.fillStyle = css(p.c, 1 - k);
      g.fillRect(p.x, p.y, p.size * (this.H / 900), p.size * (this.H / 900));
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    if (this.particles.length > 3000) this.particles.splice(0, this.particles.length - 3000);
  }

  figure(body, place, c, alpha, width, parts = []) {
    const g = this.g;
    const X = (i) => place.x + body.pts[2 * i] * place.unit;
    const Y = (i) => place.y + body.pts[2 * i + 1] * place.unit;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [w, a] of [[width * 3.2, alpha * 0.16], [width, alpha * 0.9]]) {
      g.strokeStyle = css(c, a);
      g.lineWidth = w;
      g.beginPath();
      for (const [i, j] of BONES) {
        if (!body.vis[i] || !body.vis[j]) continue;
        g.moveTo(X(i), Y(i));
        g.lineTo(X(j), Y(j));
      }
      if (body.vis[0]) {
        g.moveTo(X(0) + place.unit * 0.24, Y(0));
        g.arc(X(0), Y(0), place.unit * 0.24, 0, Math.PI * 2);
      }
      g.stroke();
    }
    g.fillStyle = css(c, alpha);
    for (const i of [15, 16]) {
      if (!body.vis[i]) continue;
      g.beginPath();
      g.arc(X(i), Y(i), width * 0.9, 0, Math.PI * 2);
      g.fill();
    }
    // Delarna som spelar, ovanpå, i sin färg.
    for (const part of parts) {
      for (const [w, a] of [[width * 4, part.k * 0.25], [width * 1.3, part.k]]) {
        g.strokeStyle = css(part.c, a);
        g.lineWidth = w;
        g.beginPath();
        for (const [i, j] of part.bones) { g.moveTo(X(i), Y(i)); g.lineTo(X(j), Y(j)); }
        g.stroke();
      }
    }
  }

  // Nedräkning: stora siffror 4–3–2–1 i takten före tagningen, små i
  // tagningens sista takt så att man vet när den tar slut.
  countdown(scene, color) {
    const el = this.countEl;
    if (!el) return;
    const beat = scene.beat;
    let n = 0, size = 0, alpha = 0;
    if (scene.phase === 'count') {
      n = 4 - Math.floor(beat - scene.countBar * 4);
      size = 24;
      alpha = 1;
    } else if (scene.phase === 'rec') {
      const left = scene.takeStart + scene.takeMax - beat; // bara när tagningen närmar sig sin längsta
      if (left > 0 && left <= 4) { n = Math.ceil(left); size = 10; alpha = 0.7; }
    }
    if (n < 1 || n > 4) { el.style.opacity = '0'; return; }
    // Eget lager ovanpå duken, så att siffrorna inte drar spår efter sig.
    const frac = ((beat % 1) + 1) % 1;
    const [r, g, b] = color;
    el.textContent = String(n);
    el.style.fontSize = `${size}vh`;
    el.style.opacity = String(alpha * (1 - frac * 0.55));
    el.style.transform = `translate(-50%, -50%) scale(${1 + 0.25 * Math.exp(-frac * 6)})`;
    el.style.color = `rgb(${r},${g},${b})`;
    el.style.textShadow = `0 0 ${size * 0.15}vh rgba(${r},${g},${b},0.8), 0 0 ${size * 0.4}vh rgba(${r},${g},${b},0.4)`;
  }

  // Ringen på golvet: andas när ingen står där, fylls slag för slag under
  // inräkningen, och en båge går runt under de fyra takterna.
  ring(scene, color) {
    const { g, W, H } = this;
    const cx = W / 2, cy = H * 0.9, rx = W * 0.15, ry = rx * 0.16;
    const beat = scene.beat;
    const frac = ((beat % 1) + 1) % 1;
    const arc = (a0, a1, c, a, w) => {
      g.strokeStyle = css(c, a);
      g.lineWidth = w;
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, a0, a1);
      g.stroke();
    };
    const top = -Math.PI / 2, full = Math.PI * 2, thin = H * 0.004, thick = H * 0.009;

    switch (scene.phase) {
      case 'count': {
        const lit = Math.min(4, Math.floor(beat - scene.countBar * 4) + 1);
        for (let i = 0; i < 4; i++) {
          const a0 = top + (i * full) / 4 + 0.06, a1 = top + ((i + 1) * full) / 4 - 0.06;
          arc(a0, a1, color, i < lit ? 0.9 : 0.15, i < lit ? thick : thin);
        }
        break;
      }
      case 'rec': {
        // Ringen fylls takt för takt så länge man dansar; strecken är takterna.
        const bars = scene.takeMax / 4;
        const k = Math.min(1, Math.max(0, (beat - scene.takeStart) / scene.takeMax));
        arc(0, full, color, 0.3, thin);
        arc(top, top + k * full, color, 1, thick);
        for (let i = 1; i < bars; i++) {
          const a = top + (i / bars) * full;
          arc(a - 0.012, a + 0.012, WHITE, 0.6, thick * 1.4);
        }
        break;
      }
      case 'rest': {
        // Vilan: en tunn båge fylls tills nästa inräkning.
        const restBeats = scene.restBars * 4;
        const k = restBeats > 0 ? Math.min(1, Math.max(0, (beat - (scene.countBar * 4 - restBeats)) / restBeats)) : 1;
        arc(0, full, color, 0.2 + 0.1 * Math.exp(-frac * 3), thin);
        arc(top, top + k * full, WHITE, 0.55, thin * 1.6);
        break;
      }
      case 'wait':
        arc(0, full, WHITE, 0.3, thin);
        break;
      default:
        arc(0, full, WHITE, 0.1 + 0.2 * Math.exp(-frac * 3), thin);
    }
  }
}
