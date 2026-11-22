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

test('own class is applied and ATT / M.ATT are one skill', () => {
  const T = Q.resolveTarget(preset('own-class'), { mage: true, ownClass: 'THF' });
  assert.equal(T.targets.ATT, 3);
  assert.equal(T.targets.MATT, undefined);
  assert.equal(T.targets.THF, 1);
  assert.equal(Q.resolveTarget({ targets: { DL: 3, WH: 3, REG: 3, MATT: 3, CD: 3, DMG: 3 } }, {}).targets.ATT, 3);
  assert.equal(Q.parseSkill('M.ATT Enhancement'), 'ATT');
  assert.equal(Q.normalizeItem({ slot: 'Hat', lines: ['MATT', 'DL', ''] }, 1).lines[0], 'ATT');
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

test('sockets come only from socket bases, lines only from fodder', () => {
  const asBases = planted.map((it) => ({ ...it, id: it.id + 100, kind: 'base', lines: ['', '', ''] }));
  const r0 = Q.solve(planted, preset('traditional'), {});
  assert.equal(r0.sockets.anyData, false); // fodder sockets are ignored
  const r = Q.solve([...planted, ...asBases], preset('traditional'), {});
  assert.equal(r.best, 18);
  assert.equal(r.itemCount, 6);
  assert.equal(r.baseCount, 6);
  assert.equal(r.sockets.prismatic, 4);
  assert.equal(r.sockets.stat, 13); // cape has a blue socket
  assert.equal(r.sockets.score, 17);
  assert.ok(r.sockets.slots.every((x) => x.items[0] > 100));
  const rb = Q.rateBase(['prismatic', 'red', 'blue'], ['red', 'green', 'gray']);
  assert.deepEqual([rb.p, rb.u, rb.wasted, rb.perfect], [1, 1, 1, false]);
});

test('CSV keeps the fodder / base type', () => {
  const csv = Q.toCSV([{ id: 1, kind: 'base', slot: 'Hat', lines: ['', '', ''], sockets: ['prismatic', 'red', 'green'], note: '' }]);
  assert.ok(csv.includes(',base'));
  assert.equal(Q.parseImport(csv).items[0].kind, 'base');
  assert.equal(Q.parseImport('slot,line1,line2,line3\nHat,DL,WH,REG').items[0].kind, 'lines');
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

test('OCR skill lines in the real tooltip format', () => {
  const k = (l) => { const r = Q.ocrSkillLine(l); return r && (r.skip ? 'skip' : r.key); };
  assert.equal(k('[Hologram] Bowman Attack Skill Level Lv. +1'), 'ARC');
  assert.equal(k('[Hologram] Warrior Attack Skill Level Ly. +1'), 'WAR');
  assert.equal(k('mem [HOlOgram) Magician Attack Skill Ly. +1 |'), 'MAG');
  assert.equal(k('[Hologram] Pirate Attack Skill Lv. +1'), 'PIR');
  assert.equal(k('[Hologram] Critical Damage Enhancement Skill Lv. +1'), 'CD');
  assert.equal(k('[Hologram] Attack Power & Magic ATT Enhancement'), 'ATT');
  assert.equal(k('Skill Lv. +1'), 'skip');
  assert.equal(k('Dimensional Leap Lv. +1'), 'DL');
  assert.equal(k('White Hole Lv. +1'), 'WH');
  assert.equal(k('Registry Lv. +1'), 'REG');
  assert.equal(k('[Hologram] Something New Skill Lv. +1'), 'OTHER');
  assert.equal(k('Required Level Ly. 160 i'), null);
  assert.equal(k('Attack Power +6 |'), null);
  assert.equal(k('Enemy DEF Ignored +5%'), null);
  assert.equal(k('Scroll Enhancement None'), null);
});

test('real OCR output of a Quanah tooltip becomes one Top piece', () => {
  // Tesseract's output for a real "Libae's Supercharged Top (Pirate)" screenshot, misreads included.
  const raw = `awww |
Libae's Supercharged Top (Pirate)
Heroic: Untradable
Interactive: Untradahble
Duration: 3/10/2027 00:00 UTC (Can't Extend)
<) + 111,003 |
=k Armor |!
Top
Required Joh Pirate :
Required Level Ly. 160 i
Set Effect Libae's Supercharged Equipment Set
STR +103 (50 +8 +45) :
DEX +73 (50 +8 +15)
Max MP +2400 (0 +2400)
Attack Power +6 |
Defense +3898 (325 +73)
quip Enemy DEF Ignored  +5%
[Hologram] Bowman Attack Skill Level Lv. +1
[Hologram] Warrior Attack Skill Level Ly. +1
mem [HOlOgram) Magician Attack Skill Ly. +1 |
M Potential : Unique
= Max MP +10% i
— " STR: +7% |
180% + Invincible for +1 sec After Taking Damage \\`;
  const p = Q.parseOcrText(raw);
  assert.equal(p.length, 1);
  assert.equal(p[0].slot, 'Top');
  assert.deepEqual(p[0].lines, ['ARC', 'WAR', 'MAG']);
  assert.deepEqual(p[0].warnings, []);
});

test('tooltips with unprefixed core skills and a wrapped ATT line', () => {
  const wrapped = `Libae's Supercharged Top (Pirate)
Armor
Top
Required Level Lv. 160
Enemy DEF Ignored +5%
[Hologram] Warrior Attack Skill Level Lv. +1
[Hologram] Bowman Attack Skill Level Lv. +1
[Hologram] Attack Power & Magic ATT Enhancement
Skill Lv. +1
Scroll Enhancement None`;
  assert.deepEqual(Q.parseOcrText(wrapped)[0].lines, ['WAR', 'ARC', 'ATT']);
  const mixed = `Libae's Supercharged Top (Pirate)
Top
Magic ATT +5 (0 +5)
Defense +484 (325 +114 +45)
[Hologram] Magician Attack Skill Lv. +1
White Hole Lv. +1
[Hologram] Bowman Attack Skill Level Lv. +1`;
  assert.deepEqual(Q.parseOcrText(mixed)[0].lines, ['MAG', 'WH', 'ARC']);
  const cape = `Libae's Supercharged Cape (Pirate)
Armor
Cape
Attack Power +9
Magic ATT +9
[Hologram] Pirate Attack Skill Lv. +1
[Hologram] Critical Damage Enhancement Skill Lv. +1
[Hologram] Magician Attack Skill Lv. +1`;
  const c = Q.parseOcrText(cape)[0];
  assert.equal(c.slot, 'Cape');
  assert.deepEqual(c.lines, ['PIR', 'CD', 'MAG']);
  const leap = `Libae's Supercharged Top (Pirate)
Dimensional Leap Lv. +1
[Hologram] Bowman Attack Skill Level Lv. +1
[Hologram] Pirate Attack Skill Lv. +1`;
  assert.deepEqual(Q.parseOcrText(leap)[0].lines, ['DL', 'ARC', 'PIR']);
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
