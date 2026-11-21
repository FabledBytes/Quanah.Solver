/*
 * Quanah Hologram Solver – core logic.
 *
 * Works as a browser global (window.QuanahSolver / self.QuanahSolver inside a
 * Web Worker) and as a CommonJS module for Node tests.
 *
 * Model
 *   item   = { id, slot, lines: [skillKey x3], sockets: [socketKey x3], note }
 *   target = 18 skill "slots": fixed counts per skill + an optional number of
 *            "any class" lines (distinct class skills that are not otherwise
 *            targeted, used by the Modified Chinese build).
 *   score  = Σ min(count, target) (+ wildcard class lines), max 18.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QuanahSolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TOTAL_LINES = 18;
  const SLOTS = ['Hat', 'Top', 'Bottom', 'Gloves', 'Shoes', 'Cape'];

  const SKILLS = [
    { key: 'DL', name: 'Dimensional Leap', short: 'DL', cap: 3, group: 'core' },
    { key: 'WH', name: 'White Hole', short: 'WH', cap: 3, group: 'core' },
    { key: 'REG', name: 'Registry', short: 'REG', cap: 3, group: 'core' },
    { key: 'ATT', name: 'ATT Enhancement', short: 'ATT', cap: 3, group: 'core' },
    { key: 'MATT', name: 'M.ATT Enhancement', short: 'MATT', cap: 3, group: 'core' },
    { key: 'CD', name: 'Critical Damage', short: 'CD', cap: 3, group: 'secondary' },
    { key: 'DMG', name: 'Damage', short: 'DMG', cap: 3, group: 'secondary' },
    { key: 'WAR', name: 'Warrior', short: 'WAR', cap: 1, group: 'class' },
    { key: 'MAG', name: 'Mage', short: 'MAG', cap: 1, group: 'class' },
    { key: 'ARC', name: 'Archer', short: 'ARC', cap: 1, group: 'class' },
    { key: 'THF', name: 'Thief', short: 'THF', cap: 1, group: 'class' },
    { key: 'PIR', name: 'Pirate', short: 'PIR', cap: 1, group: 'class' },
    { key: 'OTHER', name: 'Other skill', short: 'OTHER', cap: 0, group: 'junk' },
  ];
  const SCORED = SKILLS.filter((s) => s.group !== 'junk');
  const N = SCORED.length;
  const IDX = Object.create(null);
  SCORED.forEach((s, i) => { IDX[s.key] = i; });
  const SKILL_BY_KEY = Object.create(null);
  SKILLS.forEach((s) => { SKILL_BY_KEY[s.key] = s; });
  const CLASS_KEYS = SCORED.filter((s) => s.group === 'class').map((s) => s.key);
  const CLASS_IDX = CLASS_KEYS.map((k) => IDX[k]);
  const IS_CLASS = new Uint8Array(N);
  CLASS_IDX.forEach((i) => { IS_CLASS[i] = 1; });

  const SOCKETS = [
    { key: 'prismatic', name: 'Prismatic', short: 'P' },
    { key: 'red', name: 'Red', short: 'R' },
    { key: 'green', name: 'Green', short: 'G' },
    { key: 'gray', name: 'Gray', short: 'Gy' },
    { key: 'blue', name: 'Blue', short: 'B' },
    { key: 'purple', name: 'Purple', short: 'Pu' },
  ];
  const DEFAULT_STAT_COLORS = ['red', 'green', 'gray'];

  // '@ATT' resolves to ATT or M.ATT Enhancement, '@OWN' to the player's own class line.
  const PRESETS = [
    {
      id: 'traditional', name: 'Traditional 18/18', tagline: 'Easiest RNG',
      targets: { DL: 3, WH: 3, REG: 3, '@ATT': 3, CD: 1, WAR: 1, MAG: 1, ARC: 1, THF: 1, PIR: 1 },
    },
    {
      id: 'eu', name: 'EU Build', tagline: 'Highest bossing damage',
      targets: { DL: 3, WH: 3, REG: 3, '@ATT': 3, CD: 3, DMG: 3 },
    },
    {
      id: 'chinese', name: 'Modified Chinese', tagline: 'Any 3 class lines',
      targets: { DL: 3, WH: 3, REG: 3, '@ATT': 3, CD: 3 }, anyClass: 3,
    },
    {
      id: 'own-class', name: 'Class-Specific', tagline: 'Damage ×2 + your own class line (Shade: Pirate)',
      targets: { DL: 3, WH: 3, REG: 3, '@ATT': 3, CD: 3, DMG: 2, '@OWN': 1 },
    },
  ];

  /* ------------------------------------------------------------------ */
  /* Targets                                                             */
  /* ------------------------------------------------------------------ */

  function resolveTarget(def, settings) {
    settings = settings || {};
    const counts = new Array(N).fill(0);
    const errors = [];
    const attKey = settings.mage ? 'MATT' : 'ATT';
    const own = CLASS_KEYS.includes(settings.ownClass) ? settings.ownClass : 'PIR';
    for (const [rawKey, rawN] of Object.entries((def && def.targets) || {})) {
      const key = rawKey === '@ATT' ? attKey : rawKey === '@OWN' ? own : rawKey;
      const n = Math.max(0, Math.floor(Number(rawN) || 0));
      if (!(key in IDX)) { if (n) errors.push(`Unknown skill "${rawKey}".`); continue; }
      counts[IDX[key]] += n;
    }
    SCORED.forEach((s, i) => {
      if (counts[i] > s.cap) errors.push(`${s.name} caps at ${s.cap} from gear (target is ${counts[i]}).`);
    });
    const anyClass = Math.max(0, Math.floor(Number(def && def.anyClass) || 0));
    const freeClasses = CLASS_IDX.filter((i) => counts[i] === 0).length;
    if (anyClass > freeClasses) {
      errors.push(`"Any class" asks for ${anyClass} lines but only ${freeClasses} class skills are not already targeted.`);
    }
    const total = counts.reduce((a, b) => a + b, 0) + anyClass;
    if (total !== TOTAL_LINES) errors.push(`Targets add up to ${total}; they must add up to ${TOTAL_LINES}.`);
    const targets = {};
    SCORED.forEach((s, i) => { if (counts[i]) targets[s.key] = counts[i]; });
    const prismatic = counts.filter((c) => c === 3).length;
    return {
      id: def && def.id, name: def && def.name, counts, anyClass, total, targets,
      prismatic, stat: TOTAL_LINES - prismatic, errors, valid: errors.length === 0,
    };
  }

  function usefulMask(T) {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) m[i] = T.counts[i] > 0 || (T.anyClass > 0 && IS_CLASS[i]) ? 1 : 0;
    return m;
  }

  function scoreCounts(C, T) {
    const t = T.counts;
    let s = 0;
    for (let i = 0; i < N; i++) s += C[i] < t[i] ? C[i] : t[i];
    if (T.anyClass) {
      let w = 0;
      for (let k = 0; k < CLASS_IDX.length; k++) {
        const i = CLASS_IDX[k];
        if (t[i] === 0 && C[i] > 0) w++;
      }
      s += w < T.anyClass ? w : T.anyClass;
    }
    return s;
  }

  /** What is still missing for counts C: concrete skills + wildcard class lines. */
  function deficits(C, T) {
    const keys = [];
    for (let i = 0; i < N; i++) {
      for (let n = T.counts[i] - Math.min(C[i], T.counts[i]); n > 0; n--) keys.push(SCORED[i].key);
    }
    let anyClass = 0;
    const classOptions = [];
    if (T.anyClass) {
      let w = 0;
      for (const i of CLASS_IDX) {
        if (T.counts[i] !== 0) continue;
        if (C[i] > 0) w++; else classOptions.push(SCORED[i].key);
      }
      anyClass = T.anyClass - Math.min(w, T.anyClass);
    }
    return { keys, anyClass, classOptions, total: keys.length + anyClass };
  }

  function countLines(lineSets) {
    const C = new Int32Array(N);
    for (const lines of lineSets) for (const k of lines || []) { const i = IDX[k]; if (i !== undefined) C[i]++; }
    return C;
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */

  function isSubMultiset(a, b) { // a ⊆ b, both sorted
    let j = 0;
    for (let i = 0; i < a.length; i++) {
      while (j < b.length && b[j] < a[i]) j++;
      if (j >= b.length || b[j] !== a[i]) return false;
      j++;
    }
    return true;
  }

  /**
   * Groups items per slot by their *useful* lines for this target. Items with
   * identical useful lines are interchangeable; groups whose lines are a strict
   * sub-multiset of another group's are dominated (never score higher) and dropped.
   */
  function buildSlotGroups(items, T, slotNames) {
    const mask = usefulMask(T);
    return (slotNames || SLOTS).map((slot) => {
      const map = new Map();
      for (const it of items) {
        if (it.slot !== slot) continue;
        const idx = [];
        for (const k of it.lines || []) { const i = IDX[k]; if (i !== undefined && mask[i]) idx.push(i); }
        idx.sort((a, b) => a - b);
        const key = idx.join(',');
        let g = map.get(key);
        if (!g) { g = { lines: idx, useful: idx.length, items: [] }; map.set(key, g); }
        g.items.push(it.id);
      }
      let groups = [...map.values()];
      groups = groups.filter((g) => !groups.some((o) => o !== g && o.useful > g.useful && isSubMultiset(g.lines, o.lines)));
      groups.sort((a, b) => b.useful - a.useful);
      if (!groups.length) groups.push({ lines: [], useful: 0, items: [], empty: true });
      return groups;
    });
  }

  /**
   * Branch-and-bound over one group per slot. Returns the top `limit` combos by
   * score (≥ minScore) plus a count of exact (18/18) combos.
   */
  function search(slotGroups, T, opts) {
    opts = opts || {};
    const limit = opts.limit == null ? 50 : opts.limit;
    const minScore = opts.minScore || 0;
    const maxNodes = opts.maxNodes || 20000000;
    const S = slotGroups.length;
    const order = [...Array(S).keys()].sort((a, b) => slotGroups[a].length - slotGroups[b].length);
    const suffix = new Array(S + 1).fill(0);
    for (let d = S - 1; d >= 0; d--) {
      let m = 0;
      for (const g of slotGroups[order[d]]) if (g.useful > m) m = g.useful;
      suffix[d] = suffix[d + 1] + m;
    }
    const C = new Int32Array(N);
    const pick = new Array(S).fill(0);
    const results = [];
    let nodes = 0, truncated = false, exact = 0, exactVariants = 0;

    function record(score) {
      if (score === T.total) {
        exact++;
        let v = 1;
        for (let s = 0; s < S; s++) v *= Math.max(1, slotGroups[s][pick[s]].items.length);
        exactVariants += v;
      }
      if (score < minScore || limit <= 0) return;
      if (results.length >= limit && score <= results[results.length - 1].score) return;
      let pos = results.length;
      while (pos > 0 && results[pos - 1].score < score) pos--;
      results.splice(pos, 0, { score, pick: pick.slice() });
      if (results.length > limit) results.pop();
    }

    function dfs(d) {
      if (++nodes > maxNodes) { truncated = true; return; }
      const cur = scoreCounts(C, T);
      if (d === S) { record(cur); return; }
      const bound = Math.min(T.total, cur + suffix[d]);
      if (bound < minScore) return;
      if (limit > 0 && results.length >= limit) {
        const th = results[results.length - 1].score;
        if (bound < th || (bound === th && th < T.total)) return;
      } else if (limit <= 0 && bound < T.total) {
        return; // only counting exact combos
      }
      const slot = order[d];
      const groups = slotGroups[slot];
      for (let gi = 0; gi < groups.length; gi++) {
        const lines = groups[gi].lines;
        for (let k = 0; k < lines.length; k++) C[lines[k]]++;
        pick[slot] = gi;
        dfs(d + 1);
        for (let k = 0; k < lines.length; k++) C[lines[k]]--;
        if (truncated) return;
      }
    }

    dfs(0);
    return { results, exact, exactVariants, nodes, truncated };
  }

  /* ------------------------------------------------------------------ */
  /* Analysis                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Line-by-line breakdown of a 6-piece combo.
   * status per line: used | over (useful skill past its cap) | off (not in this build) | junk | empty
   * fixes: for each slot, what a single replacement piece would need and the score it reaches.
   */
  function analyzeCombo(lineSets, T) {
    const C = countLines(lineSets);
    const score = scoreCounts(C, T);
    const remaining = T.counts.slice();
    let wildLeft = T.anyClass;
    const wildUsed = new Set();
    const status = lineSets.map((lines) => (lines || []).map((k) => {
      const i = IDX[k];
      if (i === undefined) return k ? 'junk' : 'empty';
      if (remaining[i] > 0) { remaining[i]--; return 'used'; }
      if (wildLeft > 0 && IS_CLASS[i] && T.counts[i] === 0 && !wildUsed.has(i)) {
        wildUsed.add(i); wildLeft--; return 'used';
      }
      if (T.counts[i] > 0 || (T.anyClass > 0 && IS_CLASS[i])) return 'over';
      return 'off';
    }));
    const missing = deficits(C, T);
    const fixes = [];
    if (score < T.total) {
      lineSets.forEach((lines, s) => {
        const C2 = C.slice();
        for (const k of lines || []) { const i = IDX[k]; if (i !== undefined) C2[i]--; }
        const base = scoreCounts(C2, T);
        const d = deficits(C2, T);
        const reach = base + Math.min(3, d.total);
        if (reach <= score) return;
        const need = d.keys.slice(0, 3);
        const anyClass = Math.min(3 - need.length, d.anyClass);
        fixes.push({
          slotIndex: s, reach, need, anyClass, classOptions: d.classOptions,
          free: 3 - need.length - anyClass,
        });
      });
      fixes.sort((a, b) => b.reach - a.reach || a.slotIndex - b.slotIndex);
    }
    return { score, total: T.total, status, missing, fixes, wildUsed: [...wildUsed].map((i) => SCORED[i].key) };
  }

  /**
   * "One piece away": for each slot, find combos of the other five slots that
   * reach ≥ 15 and list the exact 3-line piece that would complete them.
   */
  function buildWishlist(T, groups, opts) {
    opts = opts || {};
    const perSlotLimit = opts.wishlistLimit || 300;
    const agg = new Map();
    let truncated = false;
    for (let j = 0; j < SLOTS.length; j++) {
      const subIdx = SLOTS.map((_, s) => s).filter((s) => s !== j);
      const sub = subIdx.map((s) => groups[s]);
      const r = search(sub, T, { limit: perSlotLimit, minScore: T.total - 3, maxNodes: opts.maxNodes || 4000000 });
      if (r.truncated || r.results.length >= perSlotLimit) truncated = true;
      for (const res of r.results) {
        const C = new Int32Array(N);
        let variants = 1;
        res.pick.forEach((gi, k) => {
          const g = sub[k][gi];
          for (const i of g.lines) C[i]++;
          variants *= Math.max(1, g.items.length);
        });
        // Skip if an owned piece in slot j already completes it (that is an exact combo).
        const owned = groups[j].some((g) => {
          if (g.empty) return false;
          for (const i of g.lines) C[i]++;
          const sc = scoreCounts(C, T);
          for (const i of g.lines) C[i]--;
          return sc === T.total;
        });
        if (owned) continue;
        const d = deficits(C, T);
        if (d.total > 3) continue;
        const need = d.keys.slice().sort();
        const key = `${j}|${need.join(',')}|${d.anyClass}|${d.anyClass ? d.classOptions.join(',') : ''}`;
        let e = agg.get(key);
        if (!e) {
          const example = {};
          res.pick.forEach((gi, k) => { example[SLOTS[subIdx[k]]] = sub[k][gi].items.slice(); });
          e = {
            slotIndex: j, slot: SLOTS[j], need, anyClass: d.anyClass,
            classOptions: d.anyClass ? d.classOptions : [], free: 3 - need.length - d.anyClass,
            combos: 0, variants: 0, example,
          };
          agg.set(key, e);
        }
        e.combos++;
        e.variants += variants;
      }
    }
    const list = [...agg.values()].sort((a, b) => (b.free - a.free) || (b.variants - a.variants) || (a.slotIndex - b.slotIndex));
    return { entries: list, truncated };
  }

  /* ------------------------------------------------------------------ */
  /* Socket bases                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Picks one socket base per slot. Score = min(P, prismatics) + min(18-P, useful colored),
   * so extra prismatics beyond the build's maxed skills and off-color sockets count as waste.
   */
  function solveSockets(items, T, statColors) {
    const P = T.prismatic, S = TOTAL_LINES - P;
    const colors = new Set(statColors && statColors.length ? statColors : DEFAULT_STAT_COLORS);
    let anyData = false;
    const perSlot = SLOTS.map((slot) => {
      const map = new Map();
      for (const it of items) {
        if (it.slot !== slot) continue;
        const socks = it.sockets || [];
        if (!socks.some(Boolean)) continue;
        anyData = true;
        let p = 0, u = 0, known = 0;
        for (const s of socks) { if (!s) continue; known++; if (s === 'prismatic') p++; else if (colors.has(s)) u++; }
        const key = `${p}:${u}`;
        let o = map.get(key);
        if (!o) { o = { p, u, items: [] }; map.set(key, o); }
        o.items.push(it.id);
      }
      const opts = [...map.values()].sort((a, b) => (b.p + b.u) - (a.p + a.u) || b.p - a.p);
      if (!opts.length) opts.push({ p: 0, u: 0, items: [], empty: true });
      return opts;
    });
    let best = -1, bestPick = null, bestP = 0, bestU = 0, perfect = 0;
    const pick = new Array(SLOTS.length).fill(0);
    (function rec(d, sp, su) {
      if (d === SLOTS.length) {
        const sc = Math.min(P, sp) + Math.min(S, su);
        if (sc === TOTAL_LINES) perfect++;
        if (sc > best || (sc === best && Math.abs(sp - P) < Math.abs(bestP - P))) {
          best = sc; bestPick = pick.slice(); bestP = sp; bestU = su;
        }
        return;
      }
      for (let i = 0; i < perSlot[d].length; i++) {
        pick[d] = i;
        rec(d + 1, sp + perSlot[d][i].p, su + perSlot[d][i].u);
      }
    })(0, 0, 0);
    return {
      prismaticNeeded: P, statNeeded: S, score: best, prismatic: bestP, stat: bestU, perfect, anyData,
      slots: SLOTS.map((slot, s) => {
        const o = perSlot[s][bestPick[s]];
        return { slot, p: o.p, u: o.u, items: o.items.slice(), empty: !!o.empty };
      }),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Top-level API                                                       */
  /* ------------------------------------------------------------------ */

  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  function solve(items, def, settings, opts) {
    opts = opts || {};
    settings = settings || {};
    const t0 = now();
    const T = resolveTarget(def, settings);
    if (!T.valid) return { target: T, error: T.errors.join(' ') };
    const clean = (items || []).filter((it) => it && SLOTS.includes(it.slot));
    const byId = new Map(clean.map((it) => [it.id, it]));
    const groups = buildSlotGroups(clean, T, SLOTS);
    const res = search(groups, T, { limit: opts.limit == null ? 60 : opts.limit, maxNodes: opts.maxNodes });
    const combos = res.results.map((r) => {
      let variants = 1;
      const slots = SLOTS.map((slot, s) => {
        const g = groups[s][r.pick[s]];
        variants *= Math.max(1, g.items.length);
        const rep = g.items.length ? byId.get(g.items[0]) : null;
        return { slot, itemIds: g.items.slice(), lines: rep ? padLines(rep.lines) : ['', '', ''], empty: !rep };
      });
      return { score: r.score, slots, variants, analysis: analyzeCombo(slots.map((x) => x.lines), T) };
    });
    const wishlist = opts.wishlist === false ? null : buildWishlist(T, groups, opts);
    const sockets = solveSockets(clean, T, settings.statColors);
    return {
      target: T,
      best: combos.length ? combos[0].score : 0,
      exactCount: res.exact,
      exactVariants: res.exactVariants,
      combos, wishlist, sockets,
      nodes: res.nodes, truncated: res.truncated,
      itemCount: clean.length,
      ms: Math.round(now() - t0),
    };
  }

  function checkAll(items, defs, settings, opts) {
    return (defs || PRESETS).map((def) => {
      const r = solve(items, def, settings, Object.assign({ limit: 1 }, opts));
      return Object.assign({ presetId: def.id }, r);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Parsing / import / export                                           */
  /* ------------------------------------------------------------------ */

  const SKILL_ALIASES = {
    dl: 'DL', dimensionalleap: 'DL', dimleap: 'DL', leap: 'DL',
    wh: 'WH', whitehole: 'WH',
    reg: 'REG', registry: 'REG',
    att: 'ATT', attenhancement: 'ATT', attack: 'ATT', attmattenhancement: 'ATT', attmatt: 'ATT',
    matt: 'MATT', mattenhancement: 'MATT', magicattack: 'MATT', magicattenhancement: 'MATT',
    cd: 'CD', crit: 'CD', critdmg: 'CD', critdamage: 'CD', criticaldamage: 'CD', critical: 'CD',
    dmg: 'DMG', damage: 'DMG',
    war: 'WAR', warrior: 'WAR',
    mag: 'MAG', mage: 'MAG', magician: 'MAG',
    arc: 'ARC', archer: 'ARC', bowman: 'ARC',
    thf: 'THF', thief: 'THF',
    pir: 'PIR', pirate: 'PIR',
    other: 'OTHER', junk: 'OTHER', useless: 'OTHER', otherskill: 'OTHER',
    none: '', empty: '', na: '',
  };
  /** Exact alias match (for quick entry); returns a skill key, '' for explicit none, or null. */
  function matchSkill(v) {
    const n = String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
    return n && n in SKILL_ALIASES ? SKILL_ALIASES[n] : null;
  }
  function matchSocket(v) {
    const n = String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
    return SOCKET_ALIASES[n] || null;
  }
  function parseSkill(v) {
    const n = String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
    if (n in SKILL_ALIASES) return SKILL_ALIASES[n];
    return n ? 'OTHER' : '';
  }
  const SOCKET_ALIASES = {
    p: 'prismatic', prism: 'prismatic', prismatic: 'prismatic', rainbow: 'prismatic',
    r: 'red', red: 'red', g: 'green', green: 'green',
    gy: 'gray', gray: 'gray', grey: 'gray', b: 'blue', blue: 'blue',
    pu: 'purple', purple: 'purple', violet: 'purple',
  };
  function parseSocket(v) {
    const n = String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
    return SOCKET_ALIASES[n] || '';
  }
  const SLOT_ALIASES = {
    hat: 'Hat', helm: 'Hat', helmet: 'Hat', head: 'Hat',
    top: 'Top', overall: 'Top', shirt: 'Top', chest: 'Top',
    bottom: 'Bottom', bottoms: 'Bottom', pants: 'Bottom',
    glove: 'Gloves', gloves: 'Gloves',
    shoe: 'Shoes', shoes: 'Shoes', boots: 'Shoes',
    cape: 'Cape', cloak: 'Cape',
  };
  function parseSlot(v) {
    return SLOT_ALIASES[String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '')] || '';
  }
  function padLines(a) { const r = (a || []).slice(0, 3); while (r.length < 3) r.push(''); return r; }

  function normalizeItem(raw, id) {
    raw = raw || {};
    const lines = Array.isArray(raw.lines) ? raw.lines : [raw.line1, raw.line2, raw.line3];
    const sockets = Array.isArray(raw.sockets) ? raw.sockets : [raw.socket1, raw.socket2, raw.socket3];
    return {
      id,
      slot: SLOTS.includes(raw.slot) ? raw.slot : parseSlot(raw.slot),
      lines: padLines(lines.map(parseSkill)),
      sockets: padLines(sockets.map(parseSocket)),
      note: raw.note == null ? '' : String(raw.note).slice(0, 200),
    };
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    return rows;
  }

  /** Accepts the JSON export, a bare JSON array of items, or CSV. Returns { items, settings }. */
  function parseImport(text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('Nothing to import: the text is empty.');
    let rawItems, settings = null;
    if (t[0] === '{' || t[0] === '[') {
      let data;
      try { data = JSON.parse(t); } catch (e) { throw new Error(`That looks like JSON but could not be read: ${e.message}`); }
      rawItems = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(rawItems)) throw new Error('The JSON has no "items" list.');
      if (!Array.isArray(data) && data.settings && typeof data.settings === 'object') settings = data.settings;
    } else {
      const rows = parseCSV(t);
      const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
      const hasHeader = head.includes('slot');
      const col = (names, fallback) => {
        if (!hasHeader) return fallback;
        for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
        return -1;
      };
      const ci = {
        slot: col(['slot'], 0),
        l: [col(['line1', 'skill1', 'l1'], 1), col(['line2', 'skill2', 'l2'], 2), col(['line3', 'skill3', 'l3'], 3)],
        s: [col(['socket1', 's1', 'jewel1'], 4), col(['socket2', 's2', 'jewel2'], 5), col(['socket3', 's3', 'jewel3'], 6)],
        note: col(['note', 'notes', 'comment'], 7),
      };
      const get = (r, i) => (i >= 0 && i < r.length ? r[i].trim() : '');
      rawItems = rows.slice(hasHeader ? 1 : 0).map((r) => ({
        slot: get(r, ci.slot), lines: ci.l.map((i) => get(r, i)), sockets: ci.s.map((i) => get(r, i)), note: get(r, ci.note),
      }));
    }
    const items = [];
    const skipped = [];
    rawItems.forEach((raw, n) => {
      const it = normalizeItem(raw, 0);
      if (!it.slot) skipped.push(n + 1); else items.push(it);
    });
    return { items, settings, skipped };
  }

  /* ------------------------------------------------------------------ */
  /* OCR text → pieces (used by the on-device screenshot reader)         */
  /* ------------------------------------------------------------------ */

  // Long names are fuzzy-matched inside the joined letters of a line; short ones per word.
  const OCR_LONG = [
    ['magicattackenhancement', 'MATT'], ['attackenhancement', 'ATT'], ['dimensionalleap', 'DL'],
    ['criticaldamage', 'CD'], ['attenhancement', 'ATT'], ['whitehole', 'WH'],
  ];
  const OCR_SHORT = [
    ['registry', 'REG'], ['magician', 'MAG'], ['warrior', 'WAR'], ['damage', 'DMG'], ['archer', 'ARC'],
    ['bowman', 'ARC'], ['pirate', 'PIR'], ['thief', 'THF'], ['mage', 'MAG'],
  ];
  const OCR_STOP = new Set(['lv', 'lvl', 'level', 'skill', 'hologram', 'max']);
  const OCR_SLOT_RE = /\b(hat|helmet|helm|top|overall|bottoms?|pants|gloves?|shoes?|boots|cape|cloak)\b/;

  function editDistance(a, b) {
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  /** Best approximate occurrence of pattern inside text: {dist, end} (end exclusive). */
  function approxFind(pattern, text) {
    const m = pattern.length, n = text.length;
    let prev = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (pattern[i - 1] === text[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    let best = Infinity, end = 0;
    for (let j = 0; j <= n; j++) if (prev[j] < best) { best = prev[j]; end = j; }
    return { dist: best, end };
  }

  /** Skill keys found on one OCR line, in reading order ([] when the line isn't a skill line). */
  function ocrLineSkills(line) {
    const words = String(line).toLowerCase().replace(/[^a-z\s.]/g, ' ').split(/[\s.]+/).filter((w) => w && !OCR_STOP.has(w) && (w.length > 1 || w === 'm'));
    if (!words.length) return [];
    let joined = words.join('');
    if (joined.length > 48) return []; // descriptions, not skill lines
    const total = joined.length;
    const found = [];
    let covered = 0;
    for (const [pat, key] of OCR_LONG) {
      const tol = Math.min(3, Math.floor(pat.length / 6));
      for (let guard = 0; guard < 3; guard++) {
        const r = approxFind(pat, joined);
        if (r.dist > tol) break;
        let start = Math.max(0, r.end - pat.length);
        let k = key;
        if (key === 'ATT' && start > 0 && joined[start - 1] === 'm') { k = 'MATT'; start--; } // M.ATT vs ATT
        found.push({ key: k, pos: start });
        covered += r.end - start;
        joined = joined.slice(0, start) + '#'.repeat(r.end - start) + joined.slice(r.end);
      }
    }
    // Map each word to its range in the joined string to skip words already used by a long match.
    let p = 0;
    for (const w of words) {
      const range = joined.slice(p, p + w.length);
      const pos = p;
      p += w.length;
      if (range.includes('#')) continue;
      for (const [pat, key] of OCR_SHORT) {
        const tol = pat.length >= 6 ? 1 : 0;
        if (Math.abs(w.length - pat.length) > tol) continue;
        if (editDistance(w, pat) <= tol) { found.push({ key, pos }); covered += w.length; break; }
      }
    }
    if (!found.length || covered / total < 0.6) return [];
    return found.sort((a, b) => a.pos - b.pos).map((f) => f.key);
  }

  /**
   * Turns raw OCR text from one screenshot into pieces. Slot words start a new piece once
   * the current one already has a slot and skill lines; a 4th skill line also starts one.
   */
  function parseOcrText(text) {
    const pieces = [];
    let cur = null;
    const start = (slot) => { cur = { slot: slot || '', lines: [], sockets: ['', '', ''], warnings: [] }; pieces.push(cur); };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const lower = raw.toLowerCase();
      const sm = lower.match(OCR_SLOT_RE);
      const skills = ocrLineSkills(raw);
      if (sm && !skills.length) {
        const slot = parseSlot(sm[1]);
        if (!cur) start(slot);
        else if (!cur.slot) cur.slot = slot;
        else if (cur.lines.length && (cur.slot !== slot || cur.lines.length >= 3)) start(slot);
        else if (cur.slot !== slot && !cur.lines.length) cur.slot = slot;
      }
      for (const k of skills) {
        if (!cur) start('');
        if (cur.lines.length >= 3) { const s = cur.slot; start(s); cur.warnings.push('Continued from a piece with more than 3 lines'); }
        cur.lines.push(k);
      }
    }
    const out = pieces.filter((pc) => pc.lines.length);
    for (const pc of out) {
      if (!pc.slot) pc.warnings.push('Slot not found');
      if (pc.lines.length < 3) pc.warnings.push(`Only ${pc.lines.length} skill line${pc.lines.length === 1 ? '' : 's'} read`);
      pc.lines = padLines(pc.lines);
    }
    return out;
  }

  function toCSV(items) {
    const esc = (v) => (/[",\n;]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const name = (k) => (SKILL_BY_KEY[k] ? SKILL_BY_KEY[k].name : '');
    const out = ['id,slot,line1,line2,line3,socket1,socket2,socket3,note'];
    for (const it of items) {
      const l = padLines(it.lines), s = padLines(it.sockets);
      out.push([it.id, it.slot, name(l[0]), name(l[1]), name(l[2]), s[0], s[1], s[2], it.note || ''].map(esc).join(','));
    }
    return out.join('\n');
  }

  return {
    TOTAL_LINES, SLOTS, SKILLS, SCORED, SKILL_BY_KEY, CLASS_KEYS, SOCKETS, DEFAULT_STAT_COLORS, PRESETS,
    resolveTarget, scoreCounts, deficits, countLines, buildSlotGroups, search, analyzeCombo,
    buildWishlist, solveSockets, solve, checkAll,
    parseSkill, parseSocket, parseSlot, matchSkill, matchSocket, normalizeItem, parseImport, parseCSV, toCSV,
    parseOcrText, ocrLineSkills,
  };
});
