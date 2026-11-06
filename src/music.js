// Lagren är bestämda i förväg: först trummor (som sätter takten), sedan bas,
// ackord, melodi, slagverk och arpeggio, högst sex lager. Kroppen väljer aldrig
// instrument, bara hur det spelas:
//
//   varje hands höjd          → den handens ton (trummor: lågt kick, mitten virvel,
//                               högt hihat). Förhållandet mellan händerna hörs:
//                               båda upp, båda ner, en upp och en ner.
//   rytmen i rörelsen         → när tonerna kommer: en hand som slår spelar sin ton,
//                               en fot eller en studs spelar den lägre handens ton
//                               (trummor: kick). Allt låst till närmaste sextondel.
//   avståndet mellan händerna → storlek: nära är tyst och mörkt, isär starkt och ljust
//
// Tonerna ligger i en pentatonisk skala, så att ingen dans kan låta fel.

export const INSTRUMENTS = ['drums', 'bass', 'chords', 'melody', 'perc', 'arp'];
export const COLOR = { drums: '#ff4d6d', bass: '#8a6bff', chords: '#ffc857', melody: '#2de2e6', perc: '#5cff9d', arp: '#ff8a3d' };
export const NAME = { drums: 'trummor', bass: 'bas', chords: 'ackord', melody: 'melodi', perc: 'slagverk', arp: 'arpeggio' };

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x) => clamp(x, 0, 1);

export const ON = 0.15; // mindre rörelse än så räknas som att stå still

// Skalsteg från armarnas höjd, per instrument.
export const RANGE = { bass: 8, chords: 8, melody: 11, arp: 8 };
export const degreeOf = (instrument, height) => Math.round(clamp01(height) * (RANGE[instrument] - 1));

// Trummans eller slagverkets ljud från höjden: tre zoner.
export const zoneOf = (height) => (height < 0.35 ? 0 : height < 0.65 ? 1 : 2);
const DRUM = ['kick', 'snare', 'hat'];
const PERC = ['tom', 'clap', 'shaker'];

// Längsta ton, i sextondelar: en ton klingar till nästa slag, men högst så här länge.
export const CAP = { bass: 4, chords: 16, melody: 4, arp: 2 };

// Tonerna för ett slag i rörelsen. hit = { hL, hR, spread, strength, source },
// där source är 'L' eller 'R' (en hand slog) eller 'B' (fot eller studs).
// dur = steg till nästa slag, count = vilket slag i ordningen (för arpeggiot).
export function accentNotes(instrument, hit, dur = 4, count = 0) {
  const vel = clamp(0.3 + 0.45 * hit.spread + 0.25 * hit.strength, 0.2, 1);
  const note = (voice, deg = 0, d = 1) => ({ role: instrument, voice, vel, deg, dur: d, tone: hit.spread, source: hit.source });
  const lo = Math.min(hit.hL, hit.hR), hi = Math.max(hit.hL, hit.hR);
  // Handen som slog; fot och studs spelar den lägre handen.
  const h = hit.source === 'L' ? hit.hL : hit.source === 'R' ? hit.hR : lo;
  const body = hit.source === 'B';
  switch (instrument) {
    case 'drums': return [note(body ? 'kick' : DRUM[zoneOf(h)])];
    case 'perc': return [body ? note('tom', 0, 1) : note(PERC[zoneOf(h)], h < 0.2 ? 0 : 1)];
    case 'bass': return [note('bass', degreeOf('bass', h), Math.min(dur, CAP.bass))];
    case 'melody': return [note('lead', degreeOf('melody', body ? hi : h), Math.min(dur, CAP.melody))];
    case 'chords': {
      // Ackordet spänns upp mellan händerna: grundton vid den lägre handen, och
      // når den högre handen längre upp kommer dess ton med överst.
      const a = degreeOf('chords', lo), b = degreeOf('chords', hi);
      const tones = [a, a + 2, a + 4];
      if (b > a + 4) tones.push(b);
      return [{ ...note('pad', a, Math.min(dur, CAP.chords)), chord: tones }];
    }
    case 'arp': {
      // Arpeggiot går mellan händernas toner, ett steg per slag.
      const a = degreeOf('arp', lo), b = degreeOf('arp', hi);
      const run = b - a >= 2 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a, a + 2, a + 4, a + 5];
      return [note('pluck', run[count % run.length], Math.min(dur, CAP.arp))];
    }
    default: return [];
  }
}

// Ett lagers toner, steg för steg, från slagen i tagningen (en lista per steg,
// en hand och en fot kan slå samtidigt). En ton klingar till nästa slag, högst CAP.
export function notesFromHits(hits, style) {
  const N = hits.length;
  const out = Array.from({ length: N }, () => []);
  const at = [];
  for (let i = 0; i < N; i++) if (hits[i]?.length) at.push(i);
  let count = 0;
  at.forEach((i, j) => {
    const next = at.length > 1 ? at[(j + 1) % at.length] : i + N;
    const gap = ((next - i + N - 1) % N) + 1;
    for (const hit of hits[i]) out[i].push(...accentNotes(style.instrument, hit, gap, count++));
  });
  return out;
}

export const countHits = (hits) => hits.reduce((n, h) => n + (h?.length ?? 0), 0);
