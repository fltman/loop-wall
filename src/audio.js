// Ljudet: Web Audio, allt syntetiserat, inga samplingar. Ett schema tittar
// lite framåt och lägger toner exakt på sextondelarna (Chris Wilsons "A tale
// of two clocks"). Varje lager har en egen kanal vars filter och rum följer
// dansens intensitet och spann.


const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const LOOKAHEAD = 0.12; // sekunder
const BASE = { bass: 38, chords: 50, melody: 62, arp: 62 }; // skalsteg 0: D2, D3, D4, D4
const ROOM = { drums: 0.08, perc: 0.12, bass: 0.03, chords: 0.4, melody: 0.3, arp: 0.25 };

export class Engine {
  constructor(cfg) {
    this.cfg = cfg;
    this.channels = new Map();
    this.scheduled = new Map(); // lager-id → takt schemat har kommit till
    this.liveK = null;
    this.countedBar = null;
    this.due = []; // toner som ska synas när de hörs
    this.stats = { notes: 0, live: 0, ticks: 0 };
    this.duckLevel = 1;
  }

  async start() {
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});

    this.bus = this.gain(0.7);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const out = this.gain(0.9);
    this.bus.connect(comp).connect(out).connect(ctx.destination);

    // Rum: genererat impulssvar, brus som klingar av.
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.4);
    this.verbIn = this.gain(1);
    this.verbIn.connect(verb).connect(this.gain(0.5)).connect(this.bus); // via bussen: tonar ut med resten

    // Eko på melodin, en punkterad åttondel.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = this.stepSec * 3;
    const fb = this.gain(0.32);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3500;
    this.delayIn = this.gain(1);
    this.delayIn.connect(delay);
    delay.connect(lp).connect(fb).connect(delay);
    delay.connect(this.gain(0.43)).connect(this.bus);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.t0 = ctx.currentTime + 0.05; // slag 0
    this.live = this.makeChannel(false);
  }

  get spb() { return 60 / this.cfg.bpm; }
  get stepSec() { return this.spb / this.cfg.stepsPerBeat; }
  now() { return this.ctx.currentTime; }
  beatAt(t) { return (t - this.t0) / this.spb; }
  timeAt(b) { return this.t0 + b * this.spb; }

  gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }

  makeChannel(duckable = true) {
    const ctx = this.ctx;
    const duck = this.gain(duckable ? this.duckLevel : 1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 8000;
    filter.Q.value = 0.5;
    const g = this.gain(0);
    g.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
    const verb = this.gain(0.15);
    duck.connect(filter).connect(g);
    g.connect(this.bus);
    g.connect(verb).connect(this.verbIn);
    return { input: duck, duck, duckable, filter, gain: g, verb };
  }

  // Medan någon dansar sänks lagren, så att den som dansar hör sig själv.
  duck(on) {
    const v = on ? 0.4 : 1;
    if (v === this.duckLevel) return;
    this.duckLevel = v;
    for (const ch of this.channels.values()) ch.duck.gain.setTargetAtTime(v, this.now(), 0.25);
  }

  addLayer(layer) {
    this.channels.set(layer.id, this.makeChannel());
    this.scheduled.set(layer.id, layer.startBeat + layer.loopBeats);
  }

  removeLayer(id) {
    const ch = this.channels.get(id);
    this.channels.delete(id);
    this.scheduled.delete(id);
    if (!ch) return;
    ch.gain.gain.setTargetAtTime(0, this.now(), 0.3);
    setTimeout(() => ch.gain.disconnect(), 2500);
  }

  // Schemat: körs var 25:e ms och lägger lagrens toner på sextondelarna strax framåt.
  tick(layers) {
    this.stats.ticks++;
    const now = this.now();
    const S = this.cfg.stepsPerBeat;
    const kNow = Math.ceil(this.beatAt(now) * S - 1e-9);
    const kAhead = Math.ceil(this.beatAt(now + LOOKAHEAD) * S - 1e-9);
    for (const layer of layers) {
      const ch = this.channels.get(layer.id);
      if (!ch) continue;
      const from = Math.max(Math.ceil(this.scheduled.get(layer.id) * S - 1e-9), kNow);
      const k0 = layer.startBeat * S;
      const N = layer.notes.length; // varje lager har sin egen längd
      for (let k = from; k < kAhead; k++) {
        const notes = layer.notes[(((k - k0) % N) + N) % N];
        if (notes.length) this.playNotes(ch, notes, this.timeAt(k / S), layer.id, layer.role);
      }
      if (kAhead > from) this.scheduled.set(layer.id, kAhead / S);
    }
  }

  // Den som dansar: tonerna på sextondelen k, eller genast om den redan har passerat.
  playLive(notes, k, instrument) {
    const t = Math.max(this.now() + 0.005, this.timeAt(k / this.cfg.stepsPerBeat));
    this.playNotes(this.live, notes, t, 'live', instrument);
    this.stats.live++;
  }

  playNotes(ch, notes, time, id, instrument) {
    // Händerna isär → ljusare. Rummet hör till instrumentet.
    const tone = notes[0]?.tone ?? 0.5;
    ch.filter.frequency.setTargetAtTime(700 * 2 ** (tone * 4.8), time, 0.03);
    ch.verb.gain.setTargetAtTime(ROOM[instrument] ?? 0.15, time, 0.1);
    for (const n of notes) {
      this.voice(n, time, ch);
      this.due.push({ time, id, role: n.role, voice: n.voice, vel: n.vel, source: n.source });
      this.stats.notes++;
    }
  }

  // Inräkningen: fyra mjuka knäpp i takten före tagningen.
  countIn(bar) {
    if (this.countedBar === bar) return;
    this.countedBar = bar;
    for (let i = 0; i < this.cfg.beatsPerBar; i++) {
      const t = this.timeAt(bar * this.cfg.beatsPerBar + i);
      if (t < this.now() - 0.01) continue;
      const o = this.osc('sine', i === 0 ? 1568 : 1175, t, t + 0.08);
      o.connect(this.amp(t, 0.09, 0.002, 0.05, this.bus));
    }
  }

  takeDue(now) {
    const ready = [], wait = [];
    for (const d of this.due) (d.time <= now ? ready : wait).push(d);
    this.due = wait;
    return ready;
  }

  degMidi(base, d) {
    const sc = this.cfg.scale;
    return base + 12 * Math.floor(d / sc.length) + sc[d % sc.length];
  }

  // --- röster -------------------------------------------------------------

  osc(type, f, t, stop) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(stop);
    return o;
  }

  amp(t, peak, attack, release, dst) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    g.connect(dst);
    return g;
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }

  filt(type, f, q = 1) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  voice(n, t, ch) {
    const dst = ch.input;
    const v = n.vel;
    const len = n.dur * this.stepSec;
    switch (n.voice) {
      case 'kick': {
        const o = this.osc('sine', 150, t, t + 0.5);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        o.connect(this.amp(t, v, 0.002, 0.42, dst));
        break;
      }
      case 'snare': {
        this.noiseSrc(t, 0.25).connect(this.filt('bandpass', 1900, 0.7)).connect(this.amp(t, v * 0.55, 0.001, 0.18, dst));
        const o = this.osc('triangle', 190, t, t + 0.15);
        o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
        o.connect(this.amp(t, v * 0.3, 0.001, 0.1, dst));
        break;
      }
      case 'hat':
        this.noiseSrc(t, 0.08).connect(this.filt('highpass', 7500)).connect(this.amp(t, v * 0.25, 0.001, 0.045, dst));
        break;
      case 'tom': {
        const f0 = (n.deg ? 190 : 120) * (n.pitch ?? 1);
        const o = this.osc('sine', f0, t, t + 0.4);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.2);
        o.connect(this.amp(t, v * 0.8, 0.002, 0.32, dst));
        break;
      }
      case 'clap': {
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        for (const dt of [0, 0.011, 0.022]) {
          g.gain.setValueAtTime(v * 0.6, t + dt);
          g.gain.linearRampToValueAtTime(0.05, t + dt + 0.009);
        }
        g.gain.setValueAtTime(v * 0.6, t + 0.031);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        g.connect(dst);
        this.noiseSrc(t, 0.25).connect(this.filt('bandpass', 1200, 1)).connect(g);
        break;
      }
      case 'shaker':
        this.noiseSrc(t, 0.12).connect(this.filt('bandpass', 6500, 1.5)).connect(this.amp(t, v * 0.2, 0.012, 0.07, dst));
        break;
      case 'bass': {
        // Vänster: rund och mjuk. Höger: morrande, med öppet filter.
        const tone = n.tone ?? 0.5;
        const f = mtof(this.degMidi(BASE.bass, n.deg));
        const top = f * (2 + 12 * tone) + 200;
        const lp = this.filt('lowpass', top, 2 + 10 * tone);
        lp.frequency.setValueAtTime(top, t);
        lp.frequency.exponentialRampToValueAtTime(f * 1.5 + 100, t + 0.2);
        const g = this.amp(t, v * 0.42, 0.006, Math.max(0.12, len * 0.9), dst);
        lp.connect(g);
        for (const [type, ff, det] of [['sawtooth', f, -7], ['sawtooth', f, 7], ['sine', f / 2, 0]]) {
          const o = this.osc(type, ff, t, t + len + 0.3);
          o.detune.value = det;
          o.connect(lp);
        }
        break;
      }
      case 'lead': {
        // Thereminen: tonen glider från förra tonen. Vänster mjuk (triangel),
        // höger vass (sågtand), däremellan en blandning.
        const tone = n.tone ?? 0.5;
        const f = mtof(this.degMidi(BASE.melody, n.deg));
        const from = ch.lastLead ?? f;
        ch.lastLead = f;
        const stop = t + len + 0.5;
        const lp = this.filt('lowpass', 1200 + 6000 * tone, 1.5);
        const g = this.amp(t, v * 0.2, 0.01, Math.max(0.15, len * 1.3), dst);
        g.connect(this.delayIn);
        lp.connect(g);
        for (const [type, mix] of [['triangle', 1 - tone], ['sawtooth', tone * 0.7]]) {
          const o = this.osc(type, from, t, stop);
          o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
          const m = this.gain(mix);
          o.connect(m).connect(lp);
        }
        break;
      }
      case 'vox': {
        // Röststöt: sågtand genom tre formantfilter (vokalen), kort som en chop.
        const f = mtof(n.midi);
        const len = n.len ?? 0.18;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v * 0.6, t + 0.012);
        g.gain.setTargetAtTime(0.0001, t + len, 0.04);
        g.connect(dst);
        const src = this.osc('sawtooth', f, t, t + len + 0.3);
        src.frequency.setValueAtTime(f * 0.97, t);
        src.frequency.linearRampToValueAtTime(f, t + 0.05); // lite glid in, som en röst
        const vib = this.osc('sine', 5.5, t, t + len + 0.3);
        vib.connect(this.gain(f * 0.012)).connect(src.frequency);
        n.vowel.forEach((fq, i) => {
          const bp = this.filt('bandpass', fq, [10, 12, 14][i]);
          src.connect(bp).connect(this.gain([1, 0.6, 0.35][i] * 2.2)).connect(g);
        });
        break;
      }
      case 'stab': {
        // Ackordstöt: korta sågtänder, eller långa mattor när längden är stor.
        const len = n.len ?? 0.2, att = n.attack ?? 0.005;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v * 0.05, t + att);
        g.gain.setTargetAtTime(0.0001, t + att + len * 0.3, len * 0.35 + 0.02);
        g.connect(dst);
        for (const m of n.notes) for (const det of [-8, 8]) {
          const o = this.osc('sawtooth', mtof(m), t, t + att + len * 2 + 0.3);
          o.detune.value = det;
          o.connect(g);
        }
        break;
      }
      case 'flowlead': {
        // Flödets melodi: mjuk fyrkant, ekot styrs av ratten.
        const f = mtof(n.midi);
        const g = this.amp(t, v * 0.5, 0.006, 0.22, dst); // jämnstark med trummor och bas
        const send = this.gain((n.echo ?? 0) * 0.9);
        g.connect(send).connect(this.delayIn);
        this.osc('square', f, t, t + 0.35).connect(this.gain(0.6)).connect(g);
        this.osc('triangle', f * 2, t, t + 0.35).connect(this.gain(0.4)).connect(g);
        break;
      }
      case 'flowpluck': {
        const f = mtof(n.midi);
        const g = this.amp(t, v * 0.4, 0.002, 0.16, dst);
        this.osc('sawtooth', f, t, t + 0.25).connect(g);
        break;
      }
      case 'harp': {
        // Harpsträng: mjuk attack, lång avklingning, ljusare ju hårdare svepet.
        const f = mtof(this.degMidi(BASE.melody, n.deg));
        const lp = this.filt('lowpass', 1800 + 5000 * v, 1);
        lp.frequency.setValueAtTime(1800 + 5000 * v, t);
        lp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
        const g = this.amp(t, v * 0.22, 0.003, 1.1, dst);
        g.connect(this.delayIn);
        lp.connect(g);
        this.osc('triangle', f, t, t + 1.3).connect(lp);
        this.osc('sine', f * 2, t, t + 1.3).connect(this.gain(0.25)).connect(lp);
        this.osc('sawtooth', f, t, t + 0.12).connect(this.gain(0.15 * v)).connect(lp);
        break;
      }
      case 'pluck': {
        // Knäpp till arpeggiot: vänster mjukt, höger glasigt.
        const tone = n.tone ?? 0.5;
        const f = mtof(this.degMidi(BASE.arp, n.deg));
        const lp = this.filt('lowpass', 1500 + 7000 * tone, 3);
        lp.frequency.setValueAtTime(1500 + 7000 * tone, t);
        lp.frequency.exponentialRampToValueAtTime(700, t + 0.18);
        const g = this.amp(t, v * 0.16, 0.002, 0.22, dst);
        g.connect(this.delayIn);
        lp.connect(g);
        this.osc('sawtooth', f, t, t + 0.3).connect(lp);
        this.osc('square', f * 2, t, t + 0.3).connect(this.gain(0.3 * tone)).connect(lp);
        break;
      }
      case 'pad': {
        const lp = this.filt('lowpass', 500 + 3500 * (n.tone ?? 0.5), 0.5);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v * 0.075, t + 0.12);
        g.gain.setValueAtTime(v * 0.075, t + Math.max(0.3, len));
        g.gain.linearRampToValueAtTime(0.0001, t + len + 0.4);
        lp.connect(g).connect(dst);
        for (const d of n.chord ?? [n.deg, n.deg + 2, n.deg + 4]) {
          const f = mtof(this.degMidi(BASE.chords, d));
          for (const det of [-9, 9]) {
            const o = this.osc('sawtooth', f, t, t + len + 0.5);
            o.detune.value = det;
            o.connect(lp);
          }
        }
        break;
      }
    }
  }
}
