// Grundflödet: musiken går hela tiden, som racket i Soundwerk, och kroppen vrider
// på rattarna. Sex instrument i D-moll spelar sina mönster på sextondelar; varje
// steg läser instrumentets rattar just då: från den som dansar, från ett inspelat
// lager (spöket), eller (trummorna, innan någon har dansat) en dämpad grundpuls.
//
// Varje instrument har tre rattar: A (vänster arm), B (höger arm) och C (avståndet
// mellan händerna), och alla följer samma regel: nere/nära är mörkt och glest,
// uppe/isär ljust och tätt. Vad varje ratt gör står i KNOB_NAMES.

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const LOOKAHEAD = 0.12;
const D = 38; // D2

export const INSTRUMENTS = ['drums', 'bass', 'chords', 'melody', 'perc', 'arp'];
export const COLOR = { drums: '#ff4d6d', bass: '#8a6bff', chords: '#ffc857', melody: '#2de2e6', perc: '#5cff9d', arp: '#ff8a3d' };
export const NAME = { drums: 'trummor', bass: 'bas', chords: 'ackord', melody: 'melodi', perc: 'slagverk', arp: 'arpeggio' };
export const KNOB_NAMES = {
  drums: ['ENERGI', 'TON', 'VOCALS'], bass: ['CUTOFF', 'TONER', 'SQUELCH'], chords: ['CUTOFF', 'ACKORD', 'LÄNGD'],
  melody: ['CUTOFF', 'TONER', 'EKO'], perc: ['ENERGI', 'TONHÖJD', 'BITCRUSH'], arp: ['CUTOFF', 'TONER', 'OKTAVER'],
};
// Rummet ligger fast per instrument.
export const ROOM = { drums: 0.1, perc: 0.14, bass: 0.04, chords: 0.4, melody: 0.3, arp: 0.25 };
// Instrumenten med en sekvens man kan skriva i: höger arm skriver tonerna, vänster formar ljudet.
export const TONAL = ['bass', 'chords', 'melody', 'arp'];
export const PEN = 0.15; // höger arm över det här skriver i sekvensern

// Röststötar: vokalerna och en liten fras i D-moll; offbeat, fler med mer vocals.
export const VOWELS = { a: [730, 1090, 2440], e: [530, 1840, 2480], o: [570, 840, 2410], i: [270, 2290, 3010], u: [300, 870, 2240] };
const VOWEL_ORDER = ['a', 'e', 'o', 'a', 'i', 'o', 'u', 'e'];
const VOX_NOTES = [62, 65, 69, 67, 65, 62, 60, 62];
export function voxHits(b, amount) {
  if (amount < 0.15) return false;
  if (b % 4 === 2) return true;
  if (amount > 0.55 && (b === 7 || b === 15)) return true;
  if (amount > 0.8 && b % 2 === 1) return true;
  return false;
}
// Grundpulsen: trummorna innan någon har dansat (bara kick, dämpad).
export const PULSE = { a: 0, b: 0.3, c: 0 };

// --- mönstren (rena funktioner, så att de går att testa) ---------------------

// Trummor: energin lägger till lager efter lager.
export function drumHits(b, energy) {
  const out = [];
  if (b % 4 === 0) out.push(['kick', 0.95]);
  if (energy > 0.2 && b % 4 === 2) out.push(['hat', 0.55]);
  if (energy > 0.4 && (b === 4 || b === 12)) out.push(['clap', 0.75]);
  if (energy > 0.6 && b % 2 === 1) out.push(['hat', 0.25]);
  if (energy > 0.8 && (b === 14 || b === 7)) out.push(['kick', 0.6]);
  if (energy > 0.9 && b === 15) out.push(['snare', 0.4]);
  return out;
}

// Slagverk: congas, shaker, tätare med energin.
export function percHits(b, energy) {
  const out = [];
  if (b === 0 || b === 10) out.push(['tom', 0.8, 0]);
  if (energy > 0.25 && (b === 3 || b === 6)) out.push(['tom', 0.6, 1]);
  if (energy > 0.45 && b % 4 === 2) out.push(['shaker', 0.5, 0]);
  if (energy > 0.65 && (b === 7 || b === 13)) out.push(['tom', 0.55, 1]);
  if (energy > 0.8 && b % 2 === 1) out.push(['shaker', 0.3, 0]);
  return out;
}

// Acid: 16 steg, halvtoner över D2. a = accent, s = glid till nästa.
export const ACID = [
  { n: 0, a: 1 }, { n: 0 }, { n: 12, s: 1 }, { n: 0 },
  { n: 3, a: 1 }, null, { n: 10 }, { n: 12, a: 1, s: 1 },
  { n: 0 }, { n: 7 }, null, { n: 5, a: 1 },
  { n: 0 }, { n: 12, s: 1 }, { n: 3 }, { n: 5, a: 1 },
];
// Ackord: Dm7-stötar på offbeat, som i house.
export const CHORD = [50, 53, 57, 60]; // D3 F3 A3 C4
export const CHORD_STEPS = [2, 6, 10, 14];
// Melodi: två takter pentatonik.
export const MELODY = [
  74, null, 72, null, 69, null, 72, 74, null, 77, null, 74, 72, null, 69, null,
  67, null, 69, null, 72, null, 69, 67, null, 65, null, 67, 69, null, null, null,
];
// Arpeggio: Dm7 uppåt i två oktaver.
export const ARP = [62, 65, 69, 72];
export const arpNote = (k, b) => {
  const octaves = 1 + Math.round(b * 2);
  const n = ARP.length * octaves;
  const i = ((k % n) + n) % n;
  return ARP[i % ARP.length] + 12 * Math.floor(i / ARP.length);
};

// Arpeggiots oktavratt: nära händer = som skrivet; isär = vartannat steg en oktav
// upp; helt isär = upp till två oktaver.
export const arpSpread = (k, c) => {
  const i = ((k % 4) + 4) % 4;
  if (c > 0.66) return [0, 12, 24, 12][i];
  if (c > 0.33) return i % 2 ? 12 : 0;
  return 0;
};

// --- sekvensern ----------------------------------------------------------------

const PENTA = [0, 3, 5, 7, 10]; // D-moll pentatonisk
const degree = (d) => 12 * Math.floor(d / 5) + PENTA[d % 5];
// Ackorden höger arm väljer mellan, alla i D-moll: Dm7 Fmaj7 Gm7 Am7 B♭maj7 C7.
export const CHORDS = [[50, 53, 57, 60], [53, 57, 60, 64], [55, 58, 62, 65], [57, 60, 64, 67], [58, 62, 65, 69], [48, 52, 55, 58]];
export const CHORD_NAMES = ['Dm7', 'Fmaj7', 'Gm7', 'Am7', 'B♭maj7', 'C7'];

// Sekvensen ett instrument börjar med.
export function defaultSeq(inst) {
  if (inst === 'bass') return ACID.map((s) => (s ? { ...s } : null));
  if (inst === 'melody') return MELODY.slice();
  if (inst === 'arp') return Array.from({ length: 16 }, (_, i) => ARP[i % 4] + (Math.floor(i / 4) % 2) * 12);
  if (inst === 'chords') return [0, 0, 0, 0];
  return null;
}

// Pennan flyttar tonerna i skalan i stället för att skriva över dem: armen rakt ut
// är ingen ändring, högre flyttar uppåt, lägre nedåt (−4 … +5 skalsteg). Håller man
// armen stilla transponeras melodin och kurvan finns kvar; rör man armen böjs formen.
// För ackorden väljer armen ackordet direkt.
export function penShift(b) {
  const x = Math.min(1, Math.max(0, (b - PEN) / (1 - PEN)));
  return Math.round(x * 9) - 4;
}
const toDegree = (semi) => { // halvtoner över D → närmaste skalsteg
  const oct = Math.floor(semi / 12), r = ((semi % 12) + 12) % 12;
  let best = 0;
  for (let i = 0; i < 5; i++) if (Math.abs(PENTA[i] - r) < Math.abs(PENTA[best] - r)) best = i;
  return oct * 5 + best;
};
const shift = (semi, by) => degree(Math.min(14, Math.max(0, toDegree(semi) + by))); // aldrig under grundtonen eller över tre oktaver
export function penValue(inst, b, from) {
  const x = Math.min(1, Math.max(0, (b - PEN) / (1 - PEN)));
  if (inst === 'chords') return Math.min(CHORDS.length - 1, Math.floor(x * CHORDS.length));
  const by = penShift(b);
  if (inst === 'bass') return shift(from ?? 0, by); // halvtoner över D2
  return 62 + shift((from ?? 62) - 62, by); // midi, D4 som grund
}

// Vilket steg i sekvensen som spelas på det globala sextondelssteget k.
export function seqIndex(inst, k) {
  if (inst === 'chords') { const b = ((k % 16) + 16) % 16; const i = CHORD_STEPS.indexOf(b); return i; }
  const n = inst === 'melody' ? 32 : 16;
  return ((k % n) + n) % n;
}

// Skriv i sekvensen på steg k om pennan är uppe, utifrån mallen (sekvensen som
// den var när tagningen började). Pauser förblir pauser. Ger true om något skrevs.
export function penWrite(inst, seq, k, b, template = seq) {
  if (!seq || b <= PEN) return false;
  const i = seqIndex(inst, k);
  if (i < 0) return false;
  if (inst === 'chords') { seq[i] = penValue(inst, b); return true; }
  const from = template[i];
  if (from == null) return false;
  if (inst === 'bass') seq[i] = { ...from, n: penValue(inst, b, from.n) };
  else seq[i] = penValue(inst, b, from);
  return true;
}

// --- ljudet ------------------------------------------------------------------

export class Flow {
  constructor(engine) {
    this.engine = engine;
    this.k = null;
    this.source = () => null; // (instrument, steg) → { a, b, c, seq } eller null (tyst)
    this.stats = { steps: 0, played: {} };
  }

  start() {
    const e = this.engine, ctx = e.ctx;
    this.ch = Object.fromEntries(INSTRUMENTS.map((i) => [i, e.makeChannel(false)]));
    // Melodins eko tas efter kanalens filter, så att det låter som tonen.
    this.ch.melody.echoSend = e.gain(0);
    this.ch.melody.gain.connect(this.ch.melody.echoSend).connect(e.delayIn);
    // Bitcrusher på slagverket: ett torrt och ett krossat spår, blandade.
    const crushCurve = new Float32Array(4096);
    for (let i = 0; i < crushCurve.length; i++) {
      const x = (i / (crushCurve.length - 1)) * 2 - 1;
      crushCurve[i] = Math.round(Math.tanh(x * 2.5) * 5) / 5; // ungefär tre bitar, mättat
    }
    for (const inst of ['perc']) {
      const c = this.ch[inst];
      c.filter.disconnect();
      c.dry = e.gain(1);
      c.wet = e.gain(0);
      c.shaper = ctx.createWaveShaper();
      c.shaper.curve = crushCurve;
      c.filter.connect(c.dry).connect(c.gain);
      c.filter.connect(c.shaper).connect(c.wet).connect(c.gain);
    }
    // Acid: en sågtand genom resonanta lågpassfilter, som en monosynt.
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.f1 = ctx.createBiquadFilter(); this.f1.type = 'lowpass';
    this.f2 = ctx.createBiquadFilter(); this.f2.type = 'lowpass'; this.f2.Q.value = 0.7;
    this.vca = e.gain(0);
    this.osc.connect(this.f1).connect(this.f2).connect(this.vca).connect(e.gain(0.55)).connect(this.ch.bass.input);
    this.osc.start();
  }

  tick() {
    const e = this.engine;
    const S = e.cfg.stepsPerBeat;
    const now = e.now();
    const kNow = Math.ceil(e.beatAt(now) * S - 1e-9);
    const kAhead = Math.ceil(e.beatAt(now + LOOKAHEAD) * S - 1e-9);
    const from = Math.max(this.k ?? kNow, kNow);
    for (let k = from; k < kAhead; k++) {
      const t = e.timeAt(k / S);
      this.stats.steps++;
      for (const inst of INSTRUMENTS) {
        const knobs = this.source(inst, k);
        if (knobs) this.play(inst, k, t, knobs);
      }
    }
    this.k = Math.max(from, kAhead);
  }

  count(inst) { this.stats.played[inst] = (this.stats.played[inst] ?? 0) + 1; }

  play(inst, k, t, { a, b: kb, c = 0, seq }) {
    const e = this.engine;
    const ch = this.ch[inst];
    const b = ((k % 16) + 16) % 16;
    const open = (x, lo, hi) => lo * (hi / lo) ** x; // ratt 0..1 → frekvens, exponentiellt
    ch.verb.gain.setTargetAtTime(ROOM[inst], t, 0.1);

    if (inst === 'drums') {
      ch.filter.frequency.setTargetAtTime(open(kb, 500, 18000), t, 0.02);
      for (const [voice, vel] of drumHits(b, a)) { e.voice({ voice, vel }, t, ch); this.count(inst); }
      if (voxHits(b, c)) { // C: röststötar
        const vowel = VOWEL_ORDER[(((Math.floor(k / 16) % 8) + 8) % 8)];
        const note = VOX_NOTES[(((Math.floor(k / 4) % 8) + 8) % 8)] - 12;
        e.voice({ voice: 'vox', vel: 0.35 + 0.5 * c, midi: note, vowel: VOWELS[vowel], len: 0.12 + 0.15 * c }, t, ch);
        this.count('drums-vox');
      }
    } else if (inst === 'perc') {
      ch.filter.frequency.setTargetAtTime(10000, t, 0.05);
      ch.wet.gain.setTargetAtTime(c * 0.9, t, 0.03); // C: bitcrush
      ch.dry.gain.setTargetAtTime(1 - c * 0.75, t, 0.03);
      for (const [voice, vel, deg] of percHits(b, a)) { e.voice({ voice, vel, deg, pitch: 0.7 + kb * 0.9 }, t, ch); this.count(inst); }
    } else if (inst === 'bass') {
      this.acid(b, t, a, 0.05 + 0.9 * c, seq ?? ACID); // A: cutoff, C: squelch
    } else if (inst === 'chords') {
      ch.filter.frequency.setTargetAtTime(open(a, 300, 7000), t, 0.03);
      const i = CHORD_STEPS.indexOf(b);
      if (i >= 0) { // C: från korta stötar till långa mattor
        const chord = CHORDS[(seq ?? [0, 0, 0, 0])[i] ?? 0];
        e.voice({ voice: 'stab', vel: 0.6, notes: chord, len: 0.08 + c * 1.5, attack: 0.004 + c * 0.14 }, t, ch);
        this.count(inst);
      }
    } else if (inst === 'melody') {
      ch.filter.frequency.setTargetAtTime(open(a, 400, 9000), t, 0.03);
      const note = (seq ?? MELODY)[((k % 32) + 32) % 32];
      ch.echoSend.gain.setTargetAtTime(c * 0.9, t, 0.03); // C: eko
      if (note != null) { e.voice({ voice: 'flowlead', vel: 0.55, midi: note, echo: 0 }, t, ch); this.count(inst); }
    } else if (inst === 'arp') {
      const up = arpSpread(k, c); // C: oktaver
      ch.filter.frequency.setValueAtTime(Math.min(12000, open(a, 400, 9000) * 2 ** (up / 12)), t); // filtret följer med upp
      let note = (seq ? seq[((k % 16) + 16) % 16] : arpNote(k, 0.5)) + up;
      while (note > 98) note -= 12; // aldrig gälla, skärande toner
      e.voice({ voice: 'flowpluck', vel: 0.45, midi: note }, t, ch);
      this.count(inst);
    }
  }

  acid(b, t, cutoff, squelch, seq = ACID) {
    const e = this.engine;
    const step = seq[b];
    if (!step) return;
    const prev = seq[(b + 15) % 16];
    const f = mtof(D + step.n);
    // Rensa det som redan ligger schemalagt framåt, annars krockar stegens kurvor.
    this.osc.frequency.cancelScheduledValues(t);
    this.f1.frequency.cancelScheduledValues(t);
    this.f1.Q.cancelScheduledValues(t);
    this.f2.frequency.cancelScheduledValues(t);
    if (prev?.s) { // glid från förra tonen
      this.osc.frequency.setValueAtTime(mtof(D + prev.n), t);
      this.osc.frequency.linearRampToValueAtTime(f, t + 0.06);
    } else this.osc.frequency.setValueAtTime(f, t);
    const base = 180 * 2 ** (cutoff * 4.5); // 180 Hz … ca 4 kHz
    const acc = step.a ? 1 : 0;
    const peak = Math.min(16000, base * (2 + 4 * squelch + 3 * acc));
    const decay = 0.08 + squelch * 0.45 + acc * 0.1;
    this.f1.Q.setValueAtTime(2 + squelch * 16 + acc * 3, t);
    this.f1.frequency.setValueAtTime(peak, t);
    this.f1.frequency.setTargetAtTime(Math.max(60, base), t, decay / 3); // börjar vid t, så nästa stegs cancel låter svepet vara
    this.f2.frequency.setValueAtTime(Math.min(18000, base * 6), t);
    const len = e.stepSec * (step.s ? 1.05 : 0.6);
    const g = this.vca.gain;
    const level = 0.5 + 0.35 * acc;
    g.cancelScheduledValues(t);
    if (prev?.s) g.setValueAtTime(level, t); // glid: grinden står öppen
    else { g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(level, t + 0.004); }
    g.setTargetAtTime(0.0001, t + len, 0.02);
    this.count('bass');
  }
}
