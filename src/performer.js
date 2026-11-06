// Den som står i ringen, och lagren som blir kvar efter dem.
//
//   away → wait → count (en takt inräkning) → rec (så länge man dansar) → rest → count …
//
// Ingen ångra-knapp och inga kommandon. Varje slag i rörelsen blir en ton (låst
// till närmaste sextondel), och lagret blir så långt som man dansar: står man
// still en stund är det klart. Sedan vilar ringen, och står man kvar räknas
// nästa lager in. Allt här är ren logik med klockan som indata, så att det går
// att testa utan kamera.

import { CAP, INSTRUMENTS, ON, accentNotes, countHits, notesFromHits } from './music.js';

export class Performer {
  constructor(cfg) {
    this.cfg = cfg;
    this.layers = [];
    this.phase = 'away';
    this.present = false;
    this.seenSince = null;
    this.lostSince = null;
    this.take = null;
    this.open = null; // senast lämnade lagret tar emot de sista, sena slagen och bilderna
    this.countBar = 0;
    this.style = null;
    this.liveUntil = -Infinity; // takten där den levande rösten tystnar
    this.count = 0; // slag hittills i tagningen (arpeggiot går ett steg per slag)
    this.nextId = 1;
    this.lastBeat = 0;
  }

  // Hörs den som dansar just nu? Före och under tagningen, inte efter.
  liveActive(beat) {
    if (!this.present) return false;
    return this.phase === 'wait' || this.phase === 'count' || this.phase === 'rec' || beat < this.liveUntil;
  }

  // Nästa instrument i ordningen. Finns alla redan tar nästa dansare över det äldsta.
  nextStyle() {
    const have = new Set(this.layers.map((l) => l.role));
    const instrument = INSTRUMENTS.find((i) => !have.has(i)) ?? this.layers[0].role;
    return { instrument, seed: this.nextId, bars: this.cfg.fixedBars };
  }

  // features: kroppsmåtten, accents: slagen i rörelsen just nu ([{ source, strength }]).
  update({ t, beat, seen, features = null, body = null, accents = [] }) {
    const out = [];
    const cfg = this.cfg;
    const B = cfg.beatsPerBar;
    const S = cfg.stepsPerBeat;
    this.lastBeat = beat;

    if (seen) {
      this.lostSince = null;
      if (!this.present) {
        this.seenSince ??= t;
        if (t - this.seenSince >= cfg.presence.enter) this.arrive(beat, out);
      }
    } else {
      this.seenSince = null;
      if (this.present) {
        this.lostSince ??= t;
        if (t - this.lostSince >= cfg.presence.leave) this.leave(out);
      }
    }

    const bar = Math.floor(beat / B);
    if (this.present) {
      if ((this.phase === 'wait' || this.phase === 'rest') && bar >= this.countBar) this.setPhase('count', out);
      if (this.phase === 'count' && bar >= this.countBar + 1) {
        this.take = this.newTake((this.countBar + 1) * B);
        this.count = 0;
        this.setPhase('rec', out);
      }
    }

    // Rörelsen hände en stund innan vi såg den.
    const hb = beat - (cfg.latency * cfg.bpm) / 60;
    if (features && seen) {
      if (this.take) this.recordFrame(this.take, hb, body);
      if (this.open) this.recordFrame(this.open.take, hb, body);
    }

    // Ett slag: låst till närmaste sextondel, spelas direkt och spelas in.
    if (accents.length && features && seen && this.liveActive(beat)) {
      const k = Math.round(hb * S);
      const target = this.take ?? this.open?.take;
      const inst = this.style.instrument;
      for (const a of accents) {
        const hit = { hL: features.hL, hR: features.hR, spread: features.spread, strength: a.strength, source: a.source };
        if (target) this.recordHit(target, k - target.startBeat * S, hit);
        out.push({ type: 'accent', k, source: a.source, notes: accentNotes(inst, hit, Math.min(4, CAP[inst] ?? 4), this.count++) });
      }
    }

    if (this.phase === 'rec') {
      const take = this.take;
      if (features && seen && (features.move >= ON || accents.length)) take.lastMove = hb;
      // Längst: maxBars (eller den fasta längden). Tagningen lämnas till schemat
      // lite före slutet, så att lagrets första slag kommer i tid.
      if (beat >= take.startBeat + take.maxBeats - cfg.commitAhead) this.finishTake(t, out, take.maxBeats / B);
      else if (!take.fixed) {
        // Annars: när man har stått still en stund. Har man inte rört sig alls
        // väntar ringen en hel takt innan den ger upp.
        const moved = take.lastMove != null;
        const stillFor = hb - (moved ? take.lastMove : take.startBeat);
        if (stillFor >= (moved ? cfg.stillBeats : B)) {
          // Avrundat uppåt till 1, 2, 4 eller 8 takter, så att looparna inte glider isär.
          const danced = Math.max(1, Math.round(((take.lastMove ?? take.startBeat) - take.startBeat) / B));
          const bars = [1, 2, 4, 8].find((n) => n >= danced && n <= cfg.maxBars) ?? cfg.maxBars;
          this.finishTake(t, out, bars);
        }
      }
    }
    if (this.open && t >= this.open.until) {
      this.open.layer.notes = this.layerNotes(this.open.take);
      this.open = null;
    }
    return out;
  }

  arrive(beat, out) {
    this.present = true;
    this.style = this.nextStyle();
    this.countBar = Math.floor(beat / this.cfg.beatsPerBar) + 1;
    this.setPhase('wait', out);
  }

  leave(out) {
    this.present = false;
    if (this.take) out.push({ type: 'discard', reason: 'left' });
    this.take = null;
    this.setPhase('away', out);
  }

  setPhase(phase, out) {
    this.phase = phase;
    out.push({ type: 'phase', phase, countBar: this.countBar });
  }

  newTake(startBeat) {
    const fixed = this.style.bars != null;
    const maxBeats = (fixed ? this.style.bars : this.cfg.maxBars) * this.cfg.beatsPerBar;
    const steps = maxBeats * this.cfg.stepsPerBeat;
    return { startBeat, maxBeats, fixed, lastMove: null, style: this.style, hits: new Array(steps + 1).fill(null), frames: [] };
  }

  // Ett slag i steget s. Samma källa två gånger i samma sextondel blir ett slag.
  recordHit(take, s, hit) {
    const limit = take.loopBeats ? take.loopBeats * this.cfg.stepsPerBeat : take.hits.length - 1;
    if (s < 0 || s > limit) return;
    const list = (take.hits[s] ??= []);
    const same = list.findIndex((h) => h.source === hit.source);
    if (same < 0) list.push(hit);
    else if (list[same].strength < hit.strength) list[same] = hit;
  }

  recordFrame(take, hb, body) {
    const rel = hb - take.startBeat;
    if (!body || rel < 0 || rel >= (take.loopBeats ?? take.maxBeats)) return;
    take.frames.push({ rel, p: rel / (take.loopBeats ?? take.maxBeats), pts: body.pts, vis: body.vis });
  }

  // Slagen i de takter man dansade. Ett slag precis på slutet hör till loopens början.
  layerNotes(take) {
    const steps = take.loopBeats * this.cfg.stepsPerBeat;
    const hits = take.hits.slice(0, steps).map((l) => (l ? [...l] : null));
    for (const h of take.hits[steps] ?? []) {
      const list = (hits[0] ??= []);
      if (!list.some((x) => x.source === h.source)) list.push(h);
    }
    return notesFromHits(hits, take.style);
  }

  finishTake(t, out, bars) {
    const cfg = this.cfg;
    const take = this.take;
    this.take = null;
    take.loopBeats = bars * cfg.beatsPerBar;
    take.frames = take.frames.filter((f) => f.rel < take.loopBeats);
    for (const f of take.frames) f.p = f.rel / take.loopBeats;
    const endBeat = take.startBeat + take.loopBeats;
    const endBar = endBeat / cfg.beatsPerBar;
    const notes = this.layerNotes(take);

    const nowBar = Math.floor(this.lastBeat / cfg.beatsPerBar);
    this.countBar = Math.max(endBar + Math.min(cfg.restBars, bars), nowBar + 1);
    if (countHits(notes) < cfg.minNotes) {
      out.push({ type: 'discard', reason: 'still' });
      this.setPhase('rest', out);
      return;
    }

    // Ett lager per instrument: det nya tar över efter det gamla.
    const instrument = take.style.instrument;
    const old = this.layers.findIndex((l) => l.role === instrument);
    if (old >= 0) {
      const [gone] = this.layers.splice(old, 1);
      out.push({ type: 'remove', id: gone.id, slot: gone.slot, role: gone.role });
    }
    const layer = {
      id: this.nextId++,
      startBeat: take.startBeat,
      loopBeats: take.loopBeats,
      notes,
      style: take.style,
      role: instrument,
      frames: take.frames,
      slot: INSTRUMENTS.indexOf(instrument), // varje instrument har sin plats i kören
      born: t,
    };
    this.layers.push(layer);
    this.liveUntil = endBeat;
    // Slutade tagningen före sitt slut tar lagret emot de sista, sena slagen.
    if (this.lastBeat < endBeat + 0.5) this.open = { layer, take, until: t + (Math.max(0, endBeat - this.lastBeat) * 60) / cfg.bpm + cfg.latency + 0.15 };
    out.push({ type: 'commit', layer });
    this.style = this.nextStyle();
    this.setPhase('rest', out);
  }

  clear() {
    const ids = this.layers.map((l) => l.id);
    this.layers = [];
    this.open = null;
    return ids;
  }
}
