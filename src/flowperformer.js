// Den som står i ringen och vrider på rattarna, och lagren som blir kvar.
//
//   away → ready (instrumentet svarar på armarna direkt, inget spelas in)
//        → armed (en arm lyftes: inspelningen börjar på nästa taktslag)
//        → rec (så länge man spelar) → rest → ready …
//
// När alla sex lager finns blir det final ('show'): låten spelas upp i en minut med
// en visuell show, inget spelas in, och sedan börjar allt om (reset()).
//
// Det som spelas in är rattarnas rörelse, steg för steg. Tagningen slutar när alla
// tre rattarna (båda armarna och händernas avstånd) har legat nere en stund; längden avrundas uppåt till 1, 2,
// 4 eller 8 takter, och själva sänkningen spelas inte in: lagret behåller
// rattarnas läge från precis innan. Ren logik med klockan som indata.

import { INSTRUMENTS, defaultSeq } from './flow.js';

export const ACTIVE = 0.12; // en ratt över det här räknas som att man spelar
export const LIFT = 0.18; // en arm lyft så här mycket startar inspelningen
export const SPREAD_ON = 0.3; // händernas avstånd räknas som spel först över det här

export class FlowPerformer {
  constructor(cfg) {
    this.cfg = cfg;
    this.layers = [];
    this.phase = 'away';
    this.present = false;
    this.seenSince = null;
    this.lostSince = null;
    this.take = null;
    this.instrument = null;
    this.restUntil = 0;
    this.restBars = 0;
    this.nextId = 1;
  }

  // Nästa instrument i ordningen; finns alla tar nästa dansare över det äldsta.
  nextInstrument() {
    const have = new Set(this.layers.map((l) => l.instrument));
    return INSTRUMENTS.find((i) => !have.has(i)) ?? this.layers[0].instrument;
  }

  // Hörs den som står i ringen? I alla lägen utom vilan efter en tagning.
  live() { return this.present && this.phase !== 'rest'; }

  update({ t, beat, seen, knobs = null, body = null }) {
    const out = [];
    if (this.phase === 'show') return out; // finalen: ingen spelar in
    const cfg = this.cfg;
    const B = cfg.beatsPerBar, S = cfg.stepsPerBeat;

    if (seen) {
      this.lostSince = null;
      if (!this.present) {
        this.seenSince ??= t;
        if (t - this.seenSince >= cfg.presence.enter) {
          this.present = true;
          this.instrument = this.nextInstrument();
          this.seq = this.startSeq(this.instrument);
          this.template = this.seq ? structuredClone(this.seq) : null;
          this.set('ready', out);
        }
      }
    } else {
      this.seenSince = null;
      if (this.present) {
        this.lostSince ??= t;
        if (t - this.lostSince >= cfg.presence.leave) {
          this.present = false;
          if (this.take) this.finish(t, beat, out, cfg.fixedBars ?? null); // gick man mitt i: det som spelats blir kvar
          this.set('away', out);
        }
      }
    }
    if (!this.present) return out;

    const hb = beat - (cfg.latency * cfg.bpm) / 60; // rörelsen hände en stund innan vi såg den
    // Hur mycket man spelar: armarna, och händernas avstånd när de är klart isär.
    const level = (k) => Math.max(k.a, k.b, (k.c ?? 0) > SPREAD_ON ? k.c : 0);
    const playing = knobs && seen && level(knobs) > ACTIVE;

    if (this.phase === 'rest' && beat >= this.restUntil) this.set('ready', out);
    if (this.phase === 'ready' && knobs && seen && level(knobs) > LIFT) {
      this.take = this.newTake((Math.floor(beat / B) + 1) * B);
      this.set('armed', out);
    }
    if (this.phase === 'armed' && beat >= this.take.startBeat) this.set('rec', out);

    if (this.take && knobs && seen) this.record(hb, knobs, body);
    if (this.phase === 'rec') {
      const take = this.take;
      if (playing) take.lastActive = hb;
      const maxBeats = (cfg.fixedBars ?? cfg.maxBars) * B;
      if (beat >= take.startBeat + maxBeats - cfg.commitAhead) this.finish(t, beat, out, maxBeats / B);
      else if (!cfg.fixedBars && hb - (take.lastActive ?? take.startBeat) >= cfg.stillBeats) this.finish(t, beat, out);
    }
    void S;
    return out;
  }

  set(phase, out) {
    this.phase = phase;
    out.push({ type: 'phase', phase, instrument: this.instrument });
  }

  newTake(startBeat) {
    const steps = (this.cfg.fixedBars ?? this.cfg.maxBars) * this.cfg.beatsPerBar * this.cfg.stepsPerBeat;
    const sums = Array.from({ length: steps }, () => ({ a: 0, b: 0, c: 0, n: 0 }));
    return { startBeat, instrument: this.instrument, sums, frames: [], lastActive: null };
  }

  record(hb, knobs, body) {
    const take = this.take;
    const rel = hb - take.startBeat;
    const s = Math.floor(rel * this.cfg.stepsPerBeat);
    if (s < 0 || s >= take.sums.length) return;
    const acc = take.sums[s];
    for (const key of ['a', 'b', 'c']) acc[key] += knobs[key] ?? 0;
    acc.n++;
    if (body) take.frames.push({ rel, pts: body.pts, vis: body.vis });
  }

  finish(t, beat, out, forcedBars = null) {
    const cfg = this.cfg;
    const B = cfg.beatsPerBar, S = cfg.stepsPerBeat;
    const take = this.take;
    this.take = null;
    const hbNow = beat - (cfg.latency * cfg.bpm) / 60;
    const start = take.startBeat;

    // Var sänkningen började: minst ett slag före sista rörelsen, och längre bakåt
    // så länge rattarna sjönk (en lugn sänkning tar mer än ett slag).
    const all = take.sums.map((x) => (x.n ? { a: x.a / x.n, b: x.b / x.n, c: x.c / x.n } : null));
    const level = (x) => (x ? Math.max(x.a, x.b, x.c > SPREAD_ON ? x.c : 0) : 0);
    const stillPlaying = take.lastActive != null && hbNow - take.lastActive < 0.5;
    let hold = Math.max(0, Math.floor(((take.lastActive ?? start) - start - 1) * S));
    if (take.lastActive != null) {
      for (let walked = 0; hold > 0 && walked < 3 * S; walked++) {
        const prev = all[hold - 1], here = all[hold];
        if (!prev || !here || level(prev) <= level(here) + 0.015) break;
        hold--;
      }
    }
    if (forcedBars) {
      // Tvingat slut (maxlängden): sjönk rattarna på slutet räknas sänkningen bort
      // därifrån; annars spelade man ända till slutet.
      let end = all.length - 1;
      while (end > 0 && !all[end]) end--;
      let h = end;
      for (let walked = 0; h > 0 && walked < 3 * S; walked++) {
        const prev = all[h - 1], here = all[h];
        if (!prev || !here || level(prev) <= level(here) + 0.015) break;
        h--;
      }
      hold = end - h >= 2 ? h : forcedBars * B * S;
    }
    void stillPlaying;

    // Längden räknas till där sänkningen började, avrundad uppåt till 1, 2, 4 eller 8
    // takter (en sextondel över en taktgräns räknas inte).
    const danced = hold / S / B;
    const bars = forcedBars ?? [1, 2, 4, 8].find((n) => n >= Math.max(1, Math.ceil(danced - 1 / (S * B))) && n <= cfg.maxBars) ?? cfg.maxBars;
    const loopBeats = bars * B;
    const steps = loopBeats * S;
    hold = Math.min(hold, steps);

    // Rattarnas läge per steg; tomma steg fylls från steget före, och efter
    // sänkningens början hålls läget från precis innan.
    let last = all.find(Boolean) ?? { a: 0, b: 0, c: 0 };
    const auto = all.slice(0, steps).map((x, i) => {
      if (i < hold && x) last = x;
      return i < hold ? (x ?? last) : last;
    });
    while (auto.length < steps) auto.push(last);

    if (take.lastActive == null || hold < S) { // spelade nästan inget: inget lager, prova igen direkt
      out.push({ type: 'discard', reason: 'still' });
      if (this.present) this.set('ready', out);
      return;
    }
    this.restBars = Math.min(cfg.restBars, bars);
    this.restUntil = Math.ceil(beat / B + 1e-9) * B + this.restBars * B;
    if (this.present) this.set('rest', out);

    // Spökets kropp: fram till sänkningen, sedan står den kvar i sin sista pose,
    // som rattarna gör.
    const holdBeat = hold / S;
    const frames = take.frames.filter((f) => f.rel < Math.min(holdBeat, loopBeats)).map((f) => ({ ...f, p: f.rel / loopBeats }));
    if (frames.length && holdBeat < loopBeats) frames.push({ ...frames[frames.length - 1], p: 1 - 1e-6 });

    const old = this.layers.findIndex((l) => l.instrument === take.instrument);
    if (old >= 0) out.push({ type: 'remove', id: this.layers.splice(old, 1)[0].id });
    const seq = this.seq ? structuredClone(this.seq) : null; // sekvensen som den var när man slutade
    const layer = { id: this.nextId++, instrument: take.instrument, startBeat: start, loopBeats, auto, seq, frames, slot: INSTRUMENTS.indexOf(take.instrument), born: t };
    this.layers.push(layer);
    out.push({ type: 'commit', layer });
    if (this.layers.length === INSTRUMENTS.length) { // alla sex: final
      this.present = false;
      this.set('show', out);
      out.push({ type: 'finale' });
      return;
    }
    this.instrument = this.nextInstrument();
    this.seq = this.startSeq(this.instrument);
    this.template = this.seq ? structuredClone(this.seq) : null;
  }

  // Sekvensen man börjar skriva i: lagrets om instrumentet redan finns, annars grundmönstret.
  startSeq(inst) {
    const layer = this.layers.find((l) => l.instrument === inst);
    return layer?.seq ? structuredClone(layer.seq) : defaultSeq(inst);
  }

  // Börja om: tom vägg, ingen i ringen.
  reset() {
    const ids = this.layers.map((l) => l.id);
    Object.assign(this, { layers: [], phase: 'away', present: false, seenSince: null, lostSince: null, take: null, instrument: null, seq: null });
    return ids;
  }

  // Rattarna för ett lager på steget k (globalt sextondelsindex).
  static knobsAt(layer, k, S = 4) {
    const N = layer.auto.length;
    const s = (((k - layer.startBeat * S) % N) + N) % N;
    return layer.auto[s];
  }
}
