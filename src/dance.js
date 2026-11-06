// Kroppen blir fem mjuka mått mellan 0 och 1: armhöjd, armrörelse,
// benrörelse, intensitet och spann. Inga gester och inga triggers, bara
// hur man rör sig.
//
// Koordinater: x i bildhöjder (0..aspect), speglad så att din vänstra hand
// syns till vänster; y i bildhöjder nedåt. Landmärken enligt MediaPipe Pose.

export const LM = {
  nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28,
};

const vis = (p) => !!p && (p.v ?? 1) > 0.5;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const range01 = (v, [lo, hi]) => clamp01((v - lo) / (hi - lo));

// Kroppens mitt och storlek. Skalan är torsolängden (axlar till höfter), eller
// en uppskattning från axelbredden när höfterna inte syns (nära en laptop).
export function bodyFrame(lm) {
  if (!lm) return null;
  const ls = lm[LM.lSh], rs = lm[LM.rSh];
  if (!vis(ls) || !vis(rs)) return null;
  const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2;
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const lh = lm[LM.lHip], rh = lm[LM.rHip];
  const hips = vis(lh) && vis(rh);
  let scale, cx, cy;
  if (hips) {
    const hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
    scale = Math.max(Math.hypot(hx - sx, hy - sy), shoulderW * 0.8);
    cx = (sx + hx) / 2;
    cy = (sy + hy) / 2;
  } else {
    scale = shoulderW * 1.25;
    cx = sx;
    cy = sy + scale * 0.5;
  }
  if (!(scale > 0.01)) return null;
  return { sx, sy, cx, cy, scale, hips, shoulderW };
}

// Kameran gissar ibland kroppsdelar den inte ser (ben under ett bord eller
// utanför bild) och påstår att gissningen är säker. Det här sållar bort det
// en kropp inte kan: punkter utanför bilden, höfter uppe vid axlarna, lemmar
// som är för korta eller för långa, knän högt över höfterna, fötter ovanför
// höfterna och ben som har korsat till fel sida. Det bortsållade räknas som
// osynligt (och står då still i bilden). Gränserna är i torsolängder.
// Lår och smalben får vara korta: ett knälyft rakt mot kameran förkortar dem på bilden.
// Men väggen är byggd för en stående dansare: knät ligger under höften, foten
// under knät och klart under höften, och benet sticker inte långt ut åt sidan.
// Det fångar kamerans gissningar när någon sitter (ben rakt ut i höfthöjd).
export const LIMITS = {
  thigh: [0.15, 1.5], shin: [0.25, 1.5], upperArm: [0, 1.1], forearm: [0, 1.1],
  kneeBelowHip: 0.25, ankleBelowHip: 0.9, kneeOut: 0.9, ankleOut: 1.2, crossLeg: 0.35,
};

export function plausible(lm, aspect = Infinity) {
  const out = lm.map((p) => (p ? { ...p } : p));
  const hide = (...idx) => { for (const i of idx) if (out[i]) out[i].v = 0; };
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (p && (p.y < -0.02 || p.y > 1.02 || p.x < -0.02 || p.x > aspect + 0.02)) p.v = 0;
  }
  const ls = out[LM.lSh], rs = out[LM.rSh];
  if (!vis(ls) || !vis(rs)) return out;
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (!(shoulderW > 0.005)) return out;
  const side = Math.sign(rs.x - ls.x) || 1; // +1 vänd mot kameran, −1 med ryggen till
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inside = (v, [lo, hi]) => v >= lo && v <= hi;
  const LEG = { l: [LM.lHip, LM.lKn, LM.lAn, 29, 31], r: [LM.rHip, LM.rKn, LM.rAn, 30, 32] };

  // Höfterna: under axlarna, och lagom brett isär.
  const lh = out[LM.lHip], rh = out[LM.rHip];
  let hipsOk = vis(lh) && vis(rh);
  if (hipsOk) {
    const down = (lh.y + rh.y - ls.y - rs.y) / 2;
    // Höfterna ska ligga under axlarna. Ingen övre gräns i axelbredder: i profil krymper
    // axelbredden och då skulle riktiga höfter underkännas.
    hipsOk = down > 0.6 * shoulderW && down < 0.6 && inside(dist(lh, rh) / shoulderW, [0.3, 1.3]);
  }
  if (!hipsOk) hide(...LEG.l, ...LEG.r);
  const T = hipsOk ? Math.hypot((lh.x + rh.x - ls.x - rs.x) / 2, (lh.y + rh.y - ls.y - rs.y) / 2) : shoulderW * 1.25;

  if (hipsOk) {
    const hipX = (lh.x + rh.x) / 2;
    for (const [key, [hip, knee, ankle, heel, foot]] of Object.entries(LEG)) {
      const H = out[hip], K = out[knee], A = out[ankle];
      const outward = key === 'l' ? -1 : 1; // vänster ben hör hemma till vänster om höfterna
      const wrongSide = (p) => (p.x - hipX) * side * outward < -LIMITS.crossLeg * T;
      if (!vis(K) || !inside(dist(H, K) / T, LIMITS.thigh) || K.y < H.y + LIMITS.kneeBelowHip * T
        || Math.abs(K.x - H.x) > LIMITS.kneeOut * T || wrongSide(K)) {
        hide(knee, ankle, heel, foot);
        continue;
      }
      if (!vis(A) || !inside(dist(K, A) / T, LIMITS.shin) || A.y < K.y || A.y < H.y + LIMITS.ankleBelowHip * T
        || Math.abs(A.x - H.x) > LIMITS.ankleOut * T || wrongSide(A)) hide(ankle, heel, foot);
      else for (const i of [heel, foot]) if (vis(out[i]) && dist(out[i], A) > 0.5 * T) hide(i);
    }
  }

  // Armarna rör sig fritt, men blir aldrig längre än en arm.
  for (const [sh, el, wr, hand] of [[LM.lSh, LM.lEl, LM.lWr, [17, 19, 21]], [LM.rSh, LM.rEl, LM.rWr, [18, 20, 22]]]) {
    const S = out[sh], E = out[el], W = out[wr];
    if (vis(E) && !inside(dist(S, E) / T, LIMITS.upperArm)) { hide(el, wr, ...hand); continue; }
    if (vis(E) && vis(W) && !inside(dist(E, W) / T, LIMITS.forearm)) hide(wr, ...hand);
  }
  return out;
}

// En person i taget: den som står i ringen. Den som redan dansar behåller
// platsen även om någon större kliver in bakom.
export function pickPerformer(poses, aspect, cfg, prev = null) {
  let best = null, bestScore = -Infinity;
  for (const lm of poses) {
    const f = bodyFrame(lm);
    if (!f) continue;
    const u = f.cx / aspect;
    if (u < cfg.presence.xMin || u > cfg.presence.xMax || f.scale < cfg.presence.minScale) continue;
    let score = f.scale;
    if (prev && Math.hypot(f.cx - prev.cx, f.cy - prev.cy) / f.scale < 1) score += 10;
    if (score > bestScore) { bestScore = score; best = { lm, frame: f }; }
  }
  return best;
}

// Kroppen i egna mått: mitten i origo, en torsolängd = 1. Det är så spöken sparas.
export function normalizePose(lm, f) {
  const pts = new Float32Array(66), v = new Uint8Array(33);
  for (let i = 0; i < 33; i++) {
    const p = lm[i];
    if (!p) continue;
    pts[2 * i] = (p.x - f.cx) / f.scale;
    pts[2 * i + 1] = (p.y - f.cy) / f.scale;
    v[i] = vis(p) ? 1 : 0;
  }
  return { pts, vis: v };
}

// Kamerans punkter darrar några pixlar även när man står helt still. Det här
// är ett One Euro-filter (Casiez m.fl. 2012) per punkt: tungt utjämnande vid
// låg fart, nästan ingen fördröjning vid hög. Farten mäts i torsolängder per
// sekund, så att det beter sig likadant nära och långt från kameran.
// Bara för bilden: dansmåtten har sin egen utjämning.
export class PoseSmoother {
  constructor({ minCutoff = 0.5, beta = 1.2, dCutoff = 1.0, jump = 0.6 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff, jump });
    this.reset();
  }

  reset() {
    this.pts = new Array(33).fill(null);
    this.center = null;
    this.scale = null;
    this.ratio = 1.25; // torsolängd / axelbredd, lärs när höfterna syns
    this.t = null;
  }

  euro(s, x, y, t, scale) {
    const dt = t - s.t;
    if (!(dt > 0)) return s;
    const alpha = (cutoff) => { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); };
    const ad = alpha(this.dCutoff);
    s.dx += ((x - s.x) / dt - s.dx) * ad;
    s.dy += ((y - s.y) / dt - s.dy) * ad;
    const a = alpha(this.minCutoff + (this.beta * Math.hypot(s.dx, s.dy)) / scale);
    s.x += (x - s.x) * a;
    s.y += (y - s.y) * a;
    s.t = t;
    return s;
  }

  // Punkterna, utjämnade. Osynliga punkter lämnas orörda (BodyFiller håller dem stilla).
  filter(lm, t, scale) {
    return lm.map((p, i) => {
      if (!vis(p)) return p;
      let s = this.pts[i];
      // Ett hårt hopp (spårningen bytte hand eller person) ska vara ett hopp, inte en
      // glidning över flera bilder som ser ut som en rörelse.
      const jumped = s && Math.hypot(p.x - s.x, p.y - s.y) > this.jump * scale;
      if (!s || t - s.t > 0.5 || jumped) s = this.pts[i] = { t, x: p.x, y: p.y, dx: 0, dy: 0 };
      else this.euro(s, p.x, p.y, t, scale);
      return { x: s.x, y: s.y, v: p.v };
    });
  }

  // Kroppens mitt och storlek, utjämnade. När höfterna blinkar in och ut (nära
  // en laptop) räknas storleken från axlarna med kroppens egna proportioner,
  // så att gubben inte hoppar mellan två storlekar.
  frame(lm, t) {
    const f = bodyFrame(lm);
    if (!f) return null;
    if (f.hips) this.ratio += (f.scale / f.shoulderW - this.ratio) * 0.05;
    else {
      f.scale = f.shoulderW * this.ratio;
      f.cy = f.sy + f.scale * 0.5;
    }
    const dt = this.t == null ? 0 : t - this.t;
    this.t = t;
    if (this.scale == null || dt > 0.5 || dt < 0) {
      this.scale = f.scale;
      this.center = { t, x: f.cx, y: f.cy, dx: 0, dy: 0 };
    } else {
      this.scale += (f.scale - this.scale) * (1 - Math.exp(-dt / 0.4));
      this.euro(this.center, f.cx, f.cy, t, this.scale);
    }
    return { ...f, cx: this.center.x, cy: this.center.y, scale: this.scale };
  }
}

// En kropp som står still med armarna längs sidorna, i samma egna mått.
const REST = (() => {
  const p = new Float32Array(66);
  const set = (i, x, y) => { p[2 * i] = x; p[2 * i + 1] = y; };
  set(0, 0, -1.12);
  for (let i = 1; i <= 10; i++) set(i, (i <= 5 ? -1 : 1) * 0.05 * ((i % 5) + 1), -1.18 + (i > 8 ? 0.12 : 0));
  set(11, -0.42, -0.5); set(12, 0.42, -0.5);
  set(13, -0.55, 0.05); set(14, 0.55, 0.05);
  set(15, -0.55, 0.45); set(16, 0.55, 0.45);
  for (const i of [17, 19, 21]) set(i, -0.57, 0.53);
  for (const i of [18, 20, 22]) set(i, 0.57, 0.53);
  set(23, -0.26, 0.5); set(24, 0.26, 0.5);
  set(25, -0.28, 1.25); set(26, 0.28, 1.25);
  set(27, -0.3, 2.0); set(28, 0.3, 2.0);
  set(29, -0.3, 2.06); set(30, 0.3, 2.06);
  set(31, -0.36, 2.08); set(32, 0.36, 2.08);
  return p;
})();
const WHOLE = new Uint8Array(33).fill(1);

// Gubben blir aldrig halv: en kroppsdel som inte syns står kvar där den
// senast sågs, och en del som aldrig har synts (benen nära en laptop) står
// i vila. Delarna sitter fast i kroppen, så de följer med när den rör sig.
export class BodyFiller {
  constructor() { this.reset(); }
  reset() { this.mem = Float32Array.from(REST); }
  fill(lm, f) {
    const pts = new Float32Array(66);
    for (let i = 0; i < 33; i++) {
      const p = lm[i];
      if (vis(p)) {
        this.mem[2 * i] = (p.x - f.cx) / f.scale;
        this.mem[2 * i + 1] = (p.y - f.cy) / f.scale;
      }
      pts[2 * i] = this.mem[2 * i];
      pts[2 * i + 1] = this.mem[2 * i + 1];
    }
    return { pts, vis: WHOLE };
  }
}

// Spökets kropp vid fas p (0..1) i loopen, mjukt mellan de sparade bilderna.
export function poseAt(frames, p) {
  const n = frames.length;
  if (!n) return null;
  if (n === 1) return frames[0];
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (frames[m].p <= p) lo = m + 1; else hi = m;
  }
  const a = frames[(lo - 1 + n) % n], b = frames[lo % n];
  const pa = lo === 0 ? a.p - 1 : a.p;
  const pb = lo === n ? b.p + 1 : b.p;
  const u = pb > pa ? (p - pa) / (pb - pa) : 0;
  const pts = new Float32Array(a.pts.length);
  for (let i = 0; i < pts.length; i++) pts[i] = a.pts[i] + (b.pts[i] - a.pts[i]) * u;
  return { pts, vis: u < 0.5 ? a.vis : b.vis };
}

const WRISTS = [LM.lWr, LM.rWr];
const ALL = [LM.nose, LM.lEl, LM.rEl, LM.lWr, LM.rWr, LM.lKn, LM.rKn, LM.lAn, LM.rAn];

const mean = (xs) => {
  let s = 0, n = 0;
  for (const x of xs) if (x != null) { s += x; n++; }
  return n ? s / n : null;
};

export class DanceMeter {
  constructor(cfg) {
    this.c = cfg.meter;
    this.reset();
  }

  reset() {
    this.t = null;
    this.scale = null;
    this.pos = new Map();
    this.center = null;
    this.f = { arms: 0.2, side: 0.5, armsMove: 0, legs: 0, energy: 0, spread: 0, hL: 0.2, hR: 0.2, vL: 0, vR: 0 };
    this.peak = 0;
    this.gain = 1;
    this.absY = new Map();
    this.det = {};
  }

  // Ingen kropp: rörelsen är slut, armhöjden får ligga kvar.
  lose() {
    this.t = null;
    this.pos.clear();
    this.center = null;
    this.f.armsMove = this.f.legs = this.f.energy = this.f.vL = this.f.vR = 0;
    this.peak = 0; // ny kropp, ny känslighet
    this.gain = 1;
  }

  update(lm, frame, t) {
    const c = this.c;
    let dt = this.t == null ? 0 : t - this.t;
    this.t = t;
    if (dt > 0.3 || dt < 0) { this.pos.clear(); this.center = null; dt = 0; }

    this.scale = this.scale == null ? frame.scale : this.scale + (frame.scale - this.scale) * (1 - Math.exp(-dt / 0.5));
    const s = this.scale;
    const aPos = dt > 0 ? 1 - Math.exp(-dt / c.posTau) : 1;

    // Studs: hur fort kroppens mitt rör sig upp och ner.
    let bounce = 0, bounceDown = 0;
    if (this.center && dt > 0) {
      const nx = this.center.x + (frame.cx - this.center.x) * aPos;
      const ny = this.center.y + (frame.cy - this.center.y) * aPos;
      bounce = (Math.abs(ny - this.center.y) / dt / s) * 2.5;
      bounceDown = ((ny - this.center.y) / dt / s) * 1.5;
      this.center = { x: nx, y: ny };
    } else {
      this.center = { x: frame.cx, y: frame.cy };
    }

    // Fart per kroppsdel, relativt kroppens mitt, i torsolängder per sekund.
    const speed = {};
    for (const i of ALL) {
      const p = lm[i];
      if (!vis(p)) { this.pos.delete(i); speed[i] = null; continue; }
      const rx = (p.x - frame.cx) / s, ry = (p.y - frame.cy) / s;
      const old = this.pos.get(i);
      if (!old || dt <= 0) { this.pos.set(i, { x: rx, y: ry }); speed[i] = null; continue; }
      const nx = old.x + (rx - old.x) * aPos, ny = old.y + (ry - old.y) * aPos;
      this.pos.set(i, { x: nx, y: ny });
      speed[i] = Math.hypot(nx - old.x, ny - old.y) / dt;
    }

    // Den snabbare handen och det snabbare benet räknas: man vinkar med en
    // arm och stampar med ett ben i taget.
    const fastest = (xs) => (xs.some((x) => x != null) ? Math.max(...xs.filter((x) => x != null)) : null);
    const wristV = fastest(WRISTS.map((i) => speed[i]));
    const legV = fastest([mean([speed[LM.lKn], speed[LM.lAn]]), mean([speed[LM.rKn], speed[LM.rAn]])]);
    // Intensitet: all rörelse i kroppen tillsammans, inte ett medelvärde,
    // så att hela kroppen i rörelse blir mer än bara armarna.
    // Varje del har en dödzon, annars blir kamerans darrning gånger nio en dans.
    let allV = 0;
    for (const i of ALL) allV += Math.max(0, (speed[i] ?? 0) - c.deadZone);
    allV /= 3;
    const heights = WRISTS.filter((i) => vis(lm[i])).map((i) => (frame.sy - lm[i].y) / s);
    const armsH = heights.length ? mean(heights) : null;
    const spreadD = vis(lm[LM.lWr]) && vis(lm[LM.rWr])
      ? Math.hypot(lm[LM.lWr].x - lm[LM.rWr].x, lm[LM.lWr].y - lm[LM.rWr].y) / s
      : null;
    // Syns inte benen (nära en laptop) får studsen i kroppen stå för dem.
    const legsRaw = legV != null ? Math.max(legV, bounce) : bounce;

    // Sidan: var händerna är, vänster–höger om kroppens mitt (din högra sida = 1).
    const xs = WRISTS.filter((i) => vis(lm[i])).map((i) => (lm[i].x - frame.cx) / s);
    const sideX = xs.length ? mean(xs) : null;

    // Varje hand för sig: höjd och fart (för debug).
    const handH = (i) => (vis(lm[i]) ? range01((frame.sy - lm[i].y) / s, c.arms) : null);
    const handV = (i) => (speed[i] != null ? range01(speed[i], c.armsMove) : null);

    const ema = (k, target, tau) => {
      if (target == null || dt <= 0) return;
      this.f[k] += (target - this.f[k]) * (1 - Math.exp(-dt / tau));
    };
    ema('arms', armsH != null ? range01(armsH, c.arms) : null, c.handTau);
    ema('side', sideX != null ? range01(sideX, c.side) : null, c.handTau);
    ema('armsMove', wristV != null ? range01(wristV, c.armsMove) : null, c.moveTau);
    ema('hL', handH(LM.lWr), c.handTau);
    ema('hR', handH(LM.rWr), c.handTau);
    ema('vL', handV(LM.lWr), c.handMoveTau);
    ema('vR', handV(LM.rWr), c.handMoveTau);
    ema('legs', range01(legsRaw, c.legs), c.moveTau);
    ema('energy', range01(Math.max(allV, bounce), c.energy), c.moveTau * 2);
    ema('spread', spreadD != null ? range01(spreadD, c.spread) : null, c.armsTau);

    // Känsligheten: den som dansar försiktigt ska också höras. Rörelsen över
    // stillhetsgolvet lyfts så att dansarens starkaste rörelse på sistone når
    // målet. Förhållandena mellan måtten, och därmed rollen, ändras inte.
    const g = c.gain;
    const raw = Math.max(this.f.armsMove, this.f.legs, this.f.energy);
    this.peak = Math.max(raw, this.peak * (dt > 0 ? 0.5 ** (dt / g.halfLife) : 1));
    this.gain = Math.min(g.maxGain, Math.max(1, g.target / Math.max(this.peak - g.floor, 0.01)));
    const lift = (x) => Math.min(1, Math.max(0, x - g.floor) * this.gain + Math.min(x, g.floor));
    // Rytmen: slag i rörelsen, från tre källor var för sig, så att två händer kan
    // slå samtidigt: vänster hand (L), höger hand (R), och fötter eller studs (B).
    // En källa som rör sig nedåt fortare än gränsen ger ett slag där rörelsen
    // stannar (foten landar, handen bottnar). Gränsen sänks för den som dansar
    // försiktigt (känsligheten).
    const downOf = (i) => {
      const p = lm[i];
      if (!vis(p)) { this.absY.delete(i); return 0; }
      const old = this.absY.get(i);
      if (old == null || dt <= 0) { this.absY.set(i, p.y); return 0; }
      const ny = old + (p.y - old) * aPos;
      this.absY.set(i, ny);
      return (ny - old) / dt / s;
    };
    const downs = { L: downOf(LM.lWr), R: downOf(LM.rWr), B: Math.max(bounceDown, downOf(LM.lAn), downOf(LM.rAn)) };
    const ac = c.accent;
    const on = ac.on / Math.sqrt(this.gain);
    const accents = [];
    for (const src of ['L', 'R', 'B']) {
      const d = (this.det[src] ??= { down: 0, armed: true, peak: 0, last: -Infinity });
      d.down = dt > 0 ? d.down + (downs[src] - d.down) * (1 - Math.exp(-dt / 0.03)) : downs[src];
      if (d.armed && d.down > on) {
        d.armed = false;
        d.peak = d.down;
      } else if (d.peak) {
        d.peak = Math.max(d.peak, d.down);
        if (d.down < d.peak * 0.5) {
          if (t - d.last > ac.refractory) {
            accents.push({ source: src, strength: Math.min(1, 0.4 + (d.peak - on) / (2 * on)) });
            d.last = t;
          }
          d.peak = 0;
        }
      } else if (!d.armed && d.down < on * ac.rearm) {
        d.armed = true;
      }
    }

    const pace = Math.max(this.f.armsMove, this.f.legs, this.f.energy);
    return {
      accents,
      ...this.f,
      // Helkroppsthereminen: armarnas höjd, sida, hur mycket kroppen rör sig
      // (lyft för den som dansar försiktigt) och kroppens verkliga fart.
      height: this.f.arms,
      move: lift(pace),
      pace,
      armsMove: lift(this.f.armsMove), legs: lift(this.f.legs), energy: lift(this.f.energy),
      // v = om handen hörs (lyft för den som dansar försiktigt),
      // s = handens verkliga fart, som avgör hur ofta den spelar.
      vL: lift(this.f.vL), vR: lift(this.f.vR), sL: this.f.vL, sR: this.f.vR,
    };
  }
}
