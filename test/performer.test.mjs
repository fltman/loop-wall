import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { Performer } from '../src/performer.js';
import { puppetPose } from '../src/puppet.js';
import { simulate } from './sim.mjs';

const dancer = (style) => (t) => [puppetPose(t, { style })];
const nobody = () => [];

test('en dans blir ett lager, i takt, och sedan vilar ringen', () => {
  const { performer, actions, cfg } = simulate({ seconds: 26, poses: dancer('stomp') });
  const phases = actions.filter((a) => a.type === 'phase').map((a) => a.phase);
  assert.deepEqual(phases.slice(0, 4), ['wait', 'count', 'rec', 'rest']);
  assert.equal(performer.layers.length, 1);
  const layer = performer.layers[0];
  const commit = actions.find((a) => a.type === 'commit');
  const endBeat = layer.startBeat + layer.loopBeats;
  assert.ok(commit.beat < endBeat, 'lagret lämnas över innan dess första slag');
  assert.equal(layer.startBeat % cfg.beatsPerBar, 0);
  assert.equal(layer.notes.length, 128, 'dansar man hela tiden blir lagret högst åtta takter');
  assert.equal(layer.role, 'drums', 'tom vägg: första lagret är trummor');
  assert.ok(layer.frames.length > 200);
  assert.ok(layer.frames.every((f, i) => i === 0 || f.p >= layer.frames[i - 1].p));
});

test('sena bilder når lagret efter överlämningen', () => {
  const { performer } = simulate({ seconds: 26, poses: dancer('stomp') });
  const take = performer.layers[0];
  assert.ok(take.frames.at(-1).p > 0.98, `sista bilden vid ${take.frames.at(-1).p}`);
});

test('lagren kommer i bestämd ordning, oavsett dans', () => {
  const cfg = makeConfig('');
  const p = new Performer(cfg);
  const dances = ['stomp', 'pump', 'groove', 'stomp', 'pump', 'groove'];
  for (const style of dances) {
    simulate({ cfg, seconds: 30, poses: dancer(style), performer: p }); // en 8-takters tagning med inräkning ryms
    simulate({ cfg, seconds: 3, poses: nobody, performer: p });
  }
  assert.deepEqual(p.layers.map((l) => l.role), ['drums', 'bass', 'chords', 'melody', 'perc', 'arp']);
  assert.deepEqual(p.layers.map((l) => l.slot), [0, 1, 2, 3, 4, 5], 'varje instrument har sin plats');
});

test('den som står still lämnar inget lager, ringen räknar in igen', () => {
  const still = (t) => [puppetPose(0, { style: 'none', noise: 0.002 * Math.sin(t) })];
  const { performer, actions } = simulate({ seconds: 30, poses: still });
  assert.equal(performer.layers.length, 0);
  assert.ok(actions.some((a) => a.type === 'discard' && a.reason === 'still'));
  assert.ok(actions.filter((a) => a.phase === 'count').length >= 2);
});

test('går man mitt i tagningen blir lagret så långt man hann dansa', () => {
  const { performer } = simulate({ seconds: 14, poses: (t) => (t < 7.5 ? dancer('stomp')(t) : []) });
  assert.equal(performer.layers.length, 1);
  assert.ok(performer.layers[0].loopBeats <= 8, `${performer.layers[0].loopBeats / 4} takter`);
  assert.equal(performer.phase, 'away');
});

test('högst sex lager: sedan tar nästa dansare över det äldsta instrumentet', () => {
  const cfg = makeConfig('');
  const { performer, actions } = simulate({ cfg, seconds: 240, poses: dancer('pump') });
  assert.equal(performer.layers.length, 6, 'ett lager per instrument');
  assert.equal(new Set(performer.layers.map((l) => l.role)).size, 6);
  const removed = actions.filter((a) => a.type === 'remove').map((a) => a.role);
  assert.deepEqual(removed.slice(0, 2), ['drums', 'bass'], 'trummorna förnyas först, sedan basen');
  assert.equal(performer.layers.at(-1).role, 'bass');
});

test('latensen räknas bort: slaget hamnar i sextondelen där det hände', () => {
  const cfg = makeConfig('');
  const p = new Performer(cfg);
  p.present = true;
  p.style = p.nextStyle();
  p.take = p.newTake(8);
  p.phase = 'rec';
  const lat = (cfg.latency * cfg.bpm) / 60;
  const f = { hL: 0.5, hR: 0.5, spread: 0.5, move: 0.5, height: 0.5 };
  // Sett vid 8,3 + latensen, hände vid 8,3 slag = sextondel 33 = steg 1 i tagningen.
  const out = p.update({ t: 10, beat: 8.3 + lat, seen: true, features: f, accents: [{ source: 'R', strength: 0.6 }] });
  assert.equal(p.take.hits[1]?.[0]?.source, 'R');
  assert.equal(out.find((a) => a.type === 'accent').k, 33, 'spelas på sin sextondel');
});

test('den som står kvar och dansar får ett lager per varv, ingen fastnar', () => {
  const { performer, actions } = simulate({ seconds: 55, poses: dancer('groove') });
  assert.ok(performer.layers.length >= 2, `${performer.layers.length} lager`);
  assert.equal(actions.filter((a) => a.type === 'discard').length, 0);
});

test('försiktig dans blir också ett lager', () => {
  // Det här fastnade förut: andra besöket kastades som "stod still" om och om igen.
  const cfg = makeConfig('');
  const p = new Performer(cfg);
  simulate({ cfg, seconds: 26, poses: (t) => [puppetPose(t, { style: 'stomp', amp: 0.4 })], performer: p });
  simulate({ cfg, seconds: 3, poses: nobody, performer: p });
  for (const [style, role] of [['groove', 'bass'], ['pump', 'chords']]) {
    const before = p.layers.length;
    const r = simulate({ cfg, seconds: 30, poses: (t) => [puppetPose(t, { style, amp: 0.4 })], performer: p });
    simulate({ cfg, seconds: 3, poses: nobody, performer: p });
    assert.ok(!r.actions.some((a) => a.type === 'discard' && a.reason === 'still'), `${style}: räknades som stilla`);
    assert.equal(p.layers.length, before + 1, style);
    assert.equal(p.layers.at(-1).role, role, style);
  }
  assert.equal(p.layers[0].role, 'drums');
});

test('fast längd: ?bars=8 ger åtta takter även om man stannar', () => {
  const cfg = makeConfig('?bars=8');
  const p = new Performer(cfg);
  const { performer } = simulate({ cfg, seconds: 26, poses: dancesFor(p, cfg, 2), performer: p });
  assert.equal(performer.layers.length, 1);
  assert.equal(performer.layers[0].notes.length, 128);
  assert.ok(performer.layers[0].frames.at(-1).p > 0.98);
});

// Dansar tills tagningen har pågått `bars` takter, står sedan still.
function dancesFor(p, cfg, bars, style = 'stomp') {
  const still = puppetPose(0, { style: 'none', noise: 0.002 });
  let stopped = false;
  return (t) => {
    const beat = (t * cfg.bpm) / 60;
    if (p.take && beat - p.take.startBeat >= bars * 4) stopped = true;
    if (p.phase === 'rest') stopped = false;
    return [stopped ? still : puppetPose(t, { style })];
  };
}

test('står man still slutar tagningen, avrundat uppåt till 1, 2, 4 eller 8 takter', () => {
  const cfg = makeConfig('');
  const p = new Performer(cfg);
  const { actions } = simulate({ cfg, seconds: 20, poses: dancesFor(p, cfg, 3), performer: p });
  assert.equal(p.layers.length, 1);
  assert.equal(p.layers[0].loopBeats, 16, 'tre takter dans blir fyra takter loop');
  assert.equal(p.layers[0].notes.length, 64);
  const rec = actions.find((a) => a.phase === 'rec'), commit = actions.find((a) => a.type === 'commit');
  const after = commit.beat - (rec.countBar + 1) * 4 - 12;
  assert.ok(after > 1.5 && after < 3.5, `slutade ${after.toFixed(2)} slag efter att dansen slutade`);
});

test('kort trumloop under lång basgång: dansaren bestämmer längden', () => {
  const cfg = makeConfig('');
  const p = new Performer(cfg);
  simulate({ cfg, seconds: 14, poses: dancesFor(p, cfg, 2), performer: p });
  simulate({ cfg, seconds: 3, poses: nobody, performer: p });
  simulate({ cfg, seconds: 30, poses: dancer('groove'), performer: p });
  const [drums, bass] = p.layers;
  assert.equal(drums.role, 'drums');
  assert.equal(drums.loopBeats, 8, 'trummor: två takter');
  assert.equal(bass.loopBeats, 32, 'bas: åtta takter');
});

test('den som aldrig rör sig väntar inte åtta takter', () => {
  const still = () => [puppetPose(0, { style: 'none', noise: 0.002 })];
  const { actions } = simulate({ seconds: 12, poses: still });
  const rec = actions.find((a) => a.phase === 'rec'), discard = actions.find((a) => a.type === 'discard');
  assert.ok(discard && discard.beat - (rec.countBar + 1) * 4 <= 4.5, 'ger upp efter en takt');
});
