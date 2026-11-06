// Solfjädern: instrumentet syns som lysande föremål runt axlarna, i armens
// räckvidd, och man spelar genom att röra vid dem.
//
//   plattor  (trummor) – slå in i en platta; det låter när handen går in
//   strängar (melodi)  – dra handen genom strängarna; varje sträng är en ton
//
// Allt mäts i kroppens egna mått (en torsolängd = 1) och i vinkel från axeln:
// 0° = armen rakt ner, 90° = rakt ut, 180° = rakt upp. Högre upp i solfjädern
// betyder alltid högre eller ljusare. Hängande armar (under ~40°) når ingenting,
// så man kan vara tyst med flit. De två halvorna är spegelbilder.

const SH = { L: 11, R: 12 }, EL = { L: 13, R: 14 }, WR = { L: 15, R: 16 };
const OUT = { L: -1, R: 1 }; // utåt på skärmen (bilden är speglad)

export const LAYOUTS = {
  // Tre stora plattor per sida: kick vid höften, virvel rakt ut, hihat vid huvudet.
  drums: ['kick', 'snare', 'hat'].flatMap((voice, i) =>
    ['L', 'R'].map((side) => ({ id: `${side}${i}`, side, kind: 'pad', theta: [62, 102, 150][i], r: 1.15, size: 0.36, rank: i, note: { voice } }))),
  // Fem strängar per sida, en harpa: D F G A C, låg till hög.
  melody: [0, 1, 2, 3, 4].flatMap((deg, i) =>
    ['L', 'R'].map((side) => ({ id: `${side}${i}`, side, kind: 'string', theta: 55 + i * 26, r0: 0.55, r1: 1.45, rank: i, note: { voice: 'harp', deg } }))),
};

export const TUNING = {
  minPadSpeed: 1.0, // torsolängder/s: långsammare in i en platta låter inte
  padExit: 1.2, // plattan laddas om först när handen är 20 % utanför
  stringBand: 4, // grader på var sida om strängen som räknas som "på" strängen
  minSweep: 45, // grader/s: långsammare genom en sträng låter inte
  maxJump: 0.8, // torsolängder: längre hopp på en bild är spårningsfel, inte rörelse …
  maxJumpSpeed: 25, // … om det inte är kortare än så här fort (låg bildfrekvens)
  padRefractory: 0.12, // sekunder innan samma platta kan slå igen
  restrike: 0.15, // torsolängder handen ska dras tillbaka inne i plattan för att kunna slå igen
  stringArc: [25, 205], // strängarna nås bara med handen på utsidan av axeln
};

// Var handen är: lite förbi handleden, längs underarmen.
export function handOf(body, side) {
  const p = body.pts;
  const wx = p[2 * WR[side]], wy = p[2 * WR[side] + 1];
  const ex = p[2 * EL[side]], ey = p[2 * EL[side] + 1];
  const len = Math.hypot(wx - ex, wy - ey) || 1;
  // Förlängningen krymper när underarmen är förkortad (pekar mot kameran), annars blir riktningen brus.
  const k = 0.2 * Math.min(1, len / 0.3);
  return { x: wx + ((wx - ex) / len) * k, y: wy + ((wy - ey) / len) * k };
}

// Armens vinkel och räckvidd från axeln.
export function armOf(body, side) {
  const p = body.pts;
  const sx = p[2 * SH[side]], sy = p[2 * SH[side] + 1];
  const h = handOf(body, side);
  const vx = (h.x - sx) * OUT[side], vy = h.y - sy;
  // Vinkeln går från −90° till 270°, så att rakt upp (180°) och lite förbi inte
  // slår om till −180° och "korsar" alla strängar baklänges.
  let theta = (Math.atan2(vx, vy) * 180) / Math.PI;
  if (theta < -90) theta += 360;
  return { theta, r: Math.hypot(vx, vy), hand: h, shoulder: { x: sx, y: sy } };
}

// Föremålets plats i kroppens mått (för plattor: mitten).
export function placeOf(body, obj, radius = obj.r) {
  const p = body.pts;
  const sx = p[2 * SH[obj.side]], sy = p[2 * SH[obj.side] + 1];
  const a = (obj.theta * Math.PI) / 180;
  return { x: sx + OUT[obj.side] * Math.sin(a) * radius, y: sy + Math.cos(a) * radius };
}

export class Instrument {
  constructor(name, tuning = TUNING) {
    this.name = name;
    this.layout = LAYOUTS[name];
    this.tuning = tuning;
    this.reset();
  }

  reset() {
    this.prev = { L: null, R: null };
    this.lastHit = new Map(); // platta → tid för senaste slaget
    this.inside = new Set(); // plattor handen är inne i
    this.reach = new Map(); // platta → { max: yttersta räckvidd sedan slaget, armed }
    this.sideOf = new Map(); // sträng+hand → vilken sida av strängen handen är på (−1/+1)
  }

  // body: kroppen i egna mått, t: sekunder, seen: syns handleden { L, R } (osynlig =
  // fryst i bilden; då väntar instrumentet tills den syns igen). Ger föremålen som spelades nu.
  update(body, t, seen = { L: true, R: true }) {
    const hits = [];
    const T = this.tuning;
    for (const side of ['L', 'R']) {
      if (!seen[side]) continue;
      const arm = armOf(body, side);
      const prev = this.prev[side];
      this.prev[side] = { ...arm, t };
      if (!prev || !(t > prev.t)) { this.settle(body, side, arm); continue; }
      const dt = t - prev.t;
      const moved = Math.hypot(arm.hand.x - prev.hand.x, arm.hand.y - prev.hand.y);
      if (moved > Math.max(T.maxJump, T.maxJumpSpeed * dt) || dt > 0.3) { this.settle(body, side, arm); continue; } // spårningen hoppade
      // Vinkeln slår om vid −90°/270° (handen tvärs över bröstet): det är ingen rörelse genom strängarna.
      const dTheta = arm.theta - prev.theta;
      const seam = Math.abs(dTheta) > 180;
      const speed = moved / dt;
      for (const obj of this.layout) {
        if (obj.side !== side) continue;
        if (obj.kind === 'pad') {
          const c = placeOf(body, obj);
          const d = Math.hypot(arm.hand.x - c.x, arm.hand.y - c.y);
          const fresh = t - (this.lastHit.get(obj.id) ?? -Infinity) > T.padRefractory;
          const strike = () => {
            hits.push({ obj, vel: Math.min(1, 0.35 + speed / 8) });
            this.lastHit.set(obj.id, t);
            this.reach.set(obj.id, { max: arm.r, armed: false });
          };
          if (this.inside.has(obj.id)) {
            // Laddas om när handen dras tillbaka mot axeln eller glider ut åt sidan, inte när
            // den går ut genom bortre kanten (då skulle den slå igen på vägen tillbaka).
            const sideways = Math.abs(arm.theta - obj.theta) * (Math.PI / 180) * obj.r > obj.size;
            if (d > obj.size * T.padExit && (arm.r < obj.r || sideways)) {
              this.inside.delete(obj.id);
              this.reach.delete(obj.id);
            } else {
              // Trumslag studsar: dras handen tillbaka en bit inne i plattan och slår ut
              // igen blir det ett nytt slag, utan att lämna plattan.
              const st = this.reach.get(obj.id) ?? { max: arm.r, armed: false };
              st.max = Math.max(st.max, arm.r);
              if (st.max - arm.r >= T.restrike) st.armed = true;
              const outward = (arm.r - prev.r) / dt;
              this.reach.set(obj.id, st);
              if (st.armed && outward >= T.minPadSpeed && fresh) strike();
            }
          } else if (d < obj.size) {
            this.inside.add(obj.id);
            this.reach.set(obj.id, { max: arm.r, armed: false });
            if (speed >= T.minPadSpeed && fresh) strike();
          }
        } else {
          const key = obj.id;
          const rel = arm.theta - obj.theta;
          const reach = arm.r >= obj.r0 && arm.r <= obj.r1;
          const outer = (th) => th >= T.stringArc[0] && th <= T.stringArc[1];
          const was = this.sideOf.get(key);
          const now = rel > T.stringBand ? 1 : rel < -T.stringBand ? -1 : 0; // 0 = på strängen
          if (now !== 0) {
            const sweep = Math.abs(dTheta) / dt;
            if (was && was !== now && !seam && reach && outer(arm.theta) && outer(prev.theta) && sweep >= T.minSweep) {
              hits.push({ obj, vel: Math.min(1, 0.4 + sweep / 600) });
            }
            this.sideOf.set(key, now);
          }
        }
      }
    }
    return hits;
  }

  // Handen dök upp eller hoppade: notera var den är, utan att något låter.
  settle(body, side, arm) {
    for (const obj of this.layout) {
      if (obj.side !== side) continue;
      if (obj.kind === 'pad') {
        const c = placeOf(body, obj);
        if (Math.hypot(arm.hand.x - c.x, arm.hand.y - c.y) < obj.size) this.inside.add(obj.id);
        else this.inside.delete(obj.id);
      } else {
        const rel = arm.theta - obj.theta;
        if (Math.abs(rel) > this.tuning.stringBand) this.sideOf.set(obj.id, Math.sign(rel));
        else this.sideOf.delete(obj.id);
      }
    }
  }
}
