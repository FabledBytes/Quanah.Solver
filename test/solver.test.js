// Run with: node test/solver.test.js
const assert = require('node:assert/strict');
const Q = require('../solver.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); process.exitCode = 1; }
}
let nextId = 1;
const item = (slot, lines, sockets = ['', '', '']) => ({ id: nextId++, slot, lines, sockets, note: '' });
const preset = (id) => Q.PRESETS.find((p) => p.id === id);

// A planted Traditional 18/18.
const planted = [
  item('Hat', ['DL', 'WH', 'WAR'], ['prismatic', 'red', 'red']),
  item('Top', ['REG', 'ATT', 'MAG'], ['red', 'green', 'gray']),
  item('Bottom', ['DL', 'REG', 'CD'], ['prismatic', 'green', 'red']),
  item('Gloves', ['WH', 'ATT', 'ARC'], ['red', 'red', 'gray']),
  item('Shoes', ['DL', 'ATT', 'THF'], ['prismatic', 'gray', 'green']),
  item('Cape', ['WH', 'REG', 'PIR'], ['prismatic', 'red', 'blue']),
];

test('every preset resolves to 18 lines with the expected prismatic count', () => {
  const expected = { traditional: 4, eu: 6, chinese: 5, 'own-class': 5 };
  for (const p of Q.PRESETS) {
    const T = Q.resolveTarget(p, {});
    assert.equal(T.valid, true, `${p.id}: ${T.errors}`);
    assert.equal(T.total, 18);
    assert.equal(T.prismatic, expected[p.id], p.id);
  }
});

test('mage toggle swaps ATT for M.ATT and own class is applied', () => {
  const T = Q.resolveTarget(preset('own-class'), { mage: true, ownClass: 'THF' });
  assert.equal(T.targets.MATT, 3);
  assert.equal(T.targets.ATT, undefined);
  assert.equal(T.targets.THF, 1);
});

test('invalid custom targets are reported', () => {
  const T = Q.resolveTarget({ targets: { DL: 4, WAR: 2 } }, {});
  assert.equal(T.valid, false);
  assert.ok(T.errors.length >= 3);
});

test('finds the planted traditional 18/18', () => {
  const r = Q.solve(planted, preset('traditional'), {});
  assert.equal(r.best, 18);
  assert.equal(r.exactCount, 1);
  assert.deepEqual(r.combos[0].analysis.missing.keys, []);
});

test('sockets: 4 prismatic + 14 stat on the planted set', () => {
  const r = Q.solve(planted, preset('traditional'), {});
  assert.equal(r.sockets.prismatic, 4);
  assert.equal(r.sockets.stat, 13); // cape has a blue socket
  assert.equal(r.sockets.score, 17);
});

test('partial match reports missing skill, wasted line and the slot to replace', () => {
  const inv = planted.map((it) => ({ ...it, lines: it.lines.slice() }));
  inv[3] = { ...inv[3], lines: ['WH', 'ATT', 'DL'] }; // Gloves: Archer replaced by a 4th Dimensional Leap
  const r = Q.solve(inv, preset('traditional'), {});
  assert.equal(r.best, 17);
  assert.equal(r.exactCount, 0);
  const a = r.combos[0].analysis;
  assert.deepEqual(a.missing.keys, ['ARC']);
  assert.ok(a.status.flat().includes('over'));
  const glovesFix = a.fixes.find((f) => Q.SLOTS[f.slotIndex] === 'Gloves');
  assert.equal(glovesFix.reach, 18);
  // Wishlist should contain a Gloves (or any DL slot) piece including Archer.
  assert.ok(r.wishlist.entries.some((e) => e.need.includes('ARC')));
});

test('modified chinese accepts any three distinct class lines', () => {
  const inv = [
    item('Hat', ['DL', 'WH', 'REG']), item('Top', ['DL', 'WH', 'REG']), item('Bottom', ['DL', 'WH', 'REG']),
    item('Gloves', ['ATT', 'ATT', 'ATT']), item('Shoes', ['CD', 'CD', 'CD']), item('Cape', ['MAG', 'PIR', 'PIR']),
  ];
  let r = Q.solve(inv, preset('chinese'), {});
  assert.equal(r.best, 17); // duplicate Pirate does not count twice
  assert.equal(r.combos[0].analysis.missing.anyClass, 1);
  inv.push(item('Cape', ['MAG', 'PIR', 'THF']));
  r = Q.solve(inv, preset('chinese'), {});
  assert.equal(r.best, 18);
});

test('empty slots still produce partial matches', () => {
  const r = Q.solve(planted.slice(0, 5), preset('traditional'), {});
  assert.equal(r.best, 15);
  assert.equal(r.combos[0].slots[5].empty, true);
  assert.ok(r.wishlist.entries.some((e) => e.slot === 'Cape' && e.need.join() === 'PIR,REG,WH'));
});

test('branch and bound matches brute force on a random inventory', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const keys = ['DL', 'WH', 'REG', 'ATT', 'CD', 'DMG', 'WAR', 'MAG', 'ARC', 'THF', 'PIR', 'OTHER'];
  const inv = [];
  for (const slot of Q.SLOTS) for (let n = 0; n < 6; n++) inv.push(item(slot, [0, 1, 2].map(() => keys[Math.floor(rnd() * keys.length)])));
  for (const p of Q.PRESETS) {
    const T = Q.resolveTarget(p, {});
    const per = Q.SLOTS.map((s) => inv.filter((it) => it.slot === s));
    let best = 0, exact = 0;
    (function rec(d, acc) {
      if (d === 6) { const sc = Q.scoreCounts(Q.countLines(acc), T); best = Math.max(best, sc); if (sc === 18) exact++; return; }
      for (const it of per[d]) rec(d + 1, acc.concat([it.lines]));
    })(0, []);
    const r = Q.solve(inv, p, {});
    assert.equal(r.best, best, p.id);
    assert.equal(r.exactVariants, exact, p.id);
  }
});

test('import parses CSV with names and aliases, and JSON round-trips', () => {
  const csv = 'slot,line1,line2,line3,socket1,socket2,socket3,note\nHelmet,Dim Leap,White Hole,Crit Damage,P,R,Grey,"base, good"\nfoo,DL,DL,DL,,,,\n';
  const r = Q.parseImport(csv);
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.skipped, [2]);
  assert.deepEqual(r.items[0].lines, ['DL', 'WH', 'CD']);
  assert.deepEqual(r.items[0].sockets, ['prismatic', 'red', 'gray']);
  assert.equal(r.items[0].note, 'base, good');
  const back = Q.parseImport(Q.toCSV(planted));
  assert.deepEqual(back.items.map((i) => i.lines), planted.map((i) => i.lines));
  const json = Q.parseImport(JSON.stringify({ items: planted, settings: { mage: true } }));
  assert.equal(json.items.length, 6);
  assert.equal(json.settings.mage, true);
});

test('large inventory solves quickly', () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const keys = ['DL', 'WH', 'REG', 'ATT', 'CD', 'DMG', 'WAR', 'MAG', 'ARC', 'THF', 'PIR', 'OTHER', 'OTHER'];
  const inv = [];
  for (const slot of Q.SLOTS) for (let n = 0; n < 60; n++) inv.push(item(slot, [0, 1, 2].map(() => keys[Math.floor(rnd() * keys.length)])));
  const t = Date.now();
  const all = Q.checkAll(inv, Q.PRESETS, {});
  const ms = Date.now() - t;
  console.log(`     360 items, 4 presets + wishlists: ${ms} ms; best = ${all.map((a) => a.best).join('/')}; nodes = ${all.map((a) => a.nodes).join('/')}`);
  assert.ok(all.every((a) => !a.truncated));
});

console.log(`\n${passed} passed`);
