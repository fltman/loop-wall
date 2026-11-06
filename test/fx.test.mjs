import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, pickRound } from '../src/fx.js';
import EFFECTS from '../src/vendor/patchwerk/nodes/effects.js';

test('finalen: fyra olika looks per runda, och ingen från förra rundan', () => {
  for (let n = 1; n < 40; n++) {
    const now = pickRound(n), prev = pickRound(n - 1);
    assert.equal(new Set(now).size, 4, `runda ${n}`);
    assert.ok(now.every((i) => !prev.includes(i)), `runda ${n} upprepar ${now.filter((i) => prev.includes(i))}`);
  }
});

test('finalen: varje look använder Patchwerk-noder som finns, med parametrar som finns', () => {
  const defs = Object.fromEntries(EFFECTS.map((d) => [d.type, d]));
  for (const look of LOOKS) {
    assert.ok(['ring', 'row', 'center', 'grid'].includes(look.layout), look.name);
    for (const [type, base, mod] of look.chain) {
      assert.ok(defs[type], `${look.name}: ${type}`);
      const names = new Set(defs[type].params.map((p) => p.name));
      for (const k of Object.keys({ ...base, ...mod({ kick: 1, beat: 3, bar: 2, phase: 0.5, energy: 0.5 }) })) assert.ok(names.has(k), `${look.name}/${type}: ${k}`);
    }
  }
});
