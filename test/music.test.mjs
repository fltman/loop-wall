import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, accentNotes, countHits, notesFromHits } from '../src/music.js';

const hit = (o) => ({ hL: 0.5, hR: 0.5, spread: 0.5, strength: 0.6, source: 'R', ...o });
const one = (inst, o, dur, count) => accentNotes(inst, hit(o), dur, count)[0];

test('instrumentet bestäms av lagret, inte av kroppen', () => {
  const v = { drums: ['kick', 'snare', 'hat'], perc: ['tom', 'clap', 'shaker'], bass: ['bass'], chords: ['pad'], melody: ['lead'], arp: ['pluck'] };
  for (const i of INSTRUMENTS) for (const o of [{ hR: 0.05 }, { hR: 0.95, source: 'L', hL: 0.9 }, { source: 'B' }]) {
    assert.ok(accentNotes(i, hit(o)).every((n) => v[i].includes(n.voice)), i);
  }
});

test('handen som slår spelar sin egen höjd', () => {
  const notes = (o) => one('melody', o).deg;
  assert.ok(notes({ source: 'L', hL: 0.1, hR: 0.9 }) < notes({ source: 'R', hL: 0.1, hR: 0.9 }), 'vänster låg, höger hög');
  assert.equal(notes({ source: 'L', hL: 0.9, hR: 0.1 }), notes({ source: 'R', hL: 0.1, hR: 0.9 }), 'samma höjd, samma ton');
  assert.ok(one('bass', { source: 'R', hR: 0.95 }).deg > one('bass', { source: 'R', hR: 0.05 }).deg);
});

test('trummor i luften: varje hand slår trumman på sin höjd, foten slår kick', () => {
  assert.equal(one('drums', { source: 'L', hL: 0.1 }).voice, 'kick');
  assert.equal(one('drums', { source: 'R', hR: 0.5 }).voice, 'snare');
  assert.equal(one('drums', { source: 'R', hR: 0.9 }).voice, 'hat');
  assert.equal(one('drums', { source: 'B', hL: 0.9, hR: 0.9 }).voice, 'kick');
  assert.equal(one('perc', { source: 'R', hR: 0.9 }).voice, 'shaker');
});

test('förhållandet mellan händerna: ackordet spänns upp mellan dem', () => {
  const level = one('chords', { hL: 0.2, hR: 0.2 }).chord;
  const tilted = one('chords', { hL: 0.1, hR: 0.95 }).chord;
  assert.equal(level.length, 3, 'jämna händer: tätt ackord');
  assert.equal(tilted.length, 4, 'snett: den höga handens ton överst');
  assert.ok(Math.max(...tilted) - Math.min(...tilted) > Math.max(...level) - Math.min(...level));
  assert.deepEqual(one('chords', { hL: 0.1, hR: 0.95 }).chord, one('chords', { hL: 0.95, hR: 0.1 }).chord, 'spegelvänt ger samma ackord');
});

test('arpeggiot går mellan händernas toner, ett steg per slag', () => {
  const run = [0, 1, 2, 3, 4].map((c) => one('arp', { hL: 0.1, hR: 0.9 }, 2, c).deg);
  assert.ok(run[1] > run[0] && run[2] > run[1], `${run}`);
});

test('avståndet mellan händerna ger storlek: starkare och ljusare', () => {
  const close = one('melody', { spread: 0.1 }), wide = one('melody', { spread: 0.9 });
  assert.ok(wide.vel > close.vel && wide.tone > close.tone);
});

test('ett lagers toner: bara där det slogs, och tonen klingar till nästa slag', () => {
  const hits = Array(16).fill(null);
  hits[0] = [hit({ source: 'L' })];
  hits[6] = [hit({ source: 'L' }), hit({ source: 'B' })];
  const notes = notesFromHits(hits, { instrument: 'bass' });
  assert.deepEqual(notes.map((n, s) => (n.length ? s : null)).filter((x) => x != null), [0, 6]);
  assert.equal(notes[6].length, 2, 'hand och fot samtidigt');
  assert.equal(notes[0][0].dur, 4, 'sex steg till nästa, men basen klingar högst fyra');
  assert.equal(countHits(notes), 3);
  const melody = notesFromHits(hits, { instrument: 'chords' });
  assert.equal(melody[6][0].dur, 10, 'runt loopen till första slaget igen');
});
