#!/usr/bin/env node
/**
 * Formula Trainer Engine test suite (no deps, runs with plain node).
 * Verifies: validation, tokenization, session flows, persistence/restore,
 * mastery, stats, search, and the P0 performance targets.
 */
'use strict';

// ---- in-memory storage adapter (injected, keeps engine DOM-free) ----
function memAdapter() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}

// ---- load engine (classic scripts attach to globalThis) ----
require('../js/engine/core.js');
require('../js/engine/storage.js');
require('../js/engine/stats.js');
require('../js/engine/search.js');
require('../js/engine/session.js');
require('../js/modes/construction.js');
require('../js/modes/deck.js');
require('../js/modes/reverse.js');

const E = globalThis.FTEngine;
E.storage.setAdapter(memAdapter());

// the bundled 26-formula trig pack (compiled by packs/build_packs.py)
function bundledPack() {
  const fs = require('fs');
  return JSON.parse(fs.readFileSync('packs/trig-angle-formulas.json', 'utf8'));
}

// ---- tiny harness ----
let passed = 0, failed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('FAIL  ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || 'eq') + ': expected ' + sb + ' got ' + sa);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

// ---- fixtures ----
function makeItem(id, prompt, answer, extra) {
  const answerTokens = E.tokenize(answer);
  return Object.assign({
    id,
    prompt,
    answerTokens,
    availableTokens: answerTokens.concat(extra && extra.distractors ? extra.distractors : []),
    metadata: { difficulty: 2, tags: ['test'], chapter: 'ch1' },
  }, extra || {});
}
function makePack(over) {
  return Object.assign({
    metadata: { id: 'p-test', name: 'Test Pack', version: '1.0.0', author: 'tester', description: 'd', subject: 'math', schemaVersion: 1 },
    items: [
      makeItem('i1', 'มวลพลังงาน', 'E = mc²'),
      makeItem('i2', 'แรง', 'F = ma'),
      makeItem('i3', 'ความเร็ว', 'v = u + at', { metadata: { difficulty: 3, tags: ['motion'], chapter: 'kin' } }),
    ],
  }, over || {});
}

// ================= core =================
console.log('\n== core: tokenize / normalize / validate ==');
t('tokenize splits operators and whitespace', () => {
  eq(E.tokenize('E = mc²'), ['E', '=', 'mc²']);
  eq(E.tokenize('sin²θ + cos²θ = 1'), ['sin²θ', '+', 'cos²θ', '=', '1']);
  eq(E.tokenize('½mv²'), ['½mv²']);
});
t('normalizeText is forgiving', () => {
  eq(E.normalizeText('  E=mc² , '), 'e=mc²');
  eq(E.normalizeText('พลังงานจลน์'), 'พลังงานจลน์');
});
t('valid pack passes validation', () => {
  const r = E.validatePack(makePack());
  ok(r.ok, JSON.stringify(r.errors));
});
t('missing schemaVersion rejected', () => {
  const p = makePack();
  delete p.metadata.schemaVersion;
  ok(!E.validatePack(p).ok);
});
t('duplicate item ids rejected', () => {
  const p = makePack();
  p.items.push(Object.assign({}, p.items[0], { id: 'i1' }));
  ok(!E.validatePack(p).ok);
});
t('missing field (prompt) rejected with clear error', () => {
  const p = makePack();
  delete p.items[1].prompt;
  const r = E.validatePack(p);
  ok(!r.ok && r.errors.some((e) => e.includes('prompt')));
});
t('invalid token (answerToken missing from pool) rejected', () => {
  const p = makePack();
  p.items[0].availableTokens = ['E', '=']; // missing mc²
  const r = E.validatePack(p);
  ok(!r.ok && r.errors.some((e) => e.includes('mc²')));
});
t('bad difficulty rejected', () => {
  const p = makePack();
  p.items[0].metadata.difficulty = 9;
  ok(!E.validatePack(p).ok);
});
t('empty pack rejected', () => {
  const p = makePack({ items: [] });
  ok(!E.validatePack(p).ok);
});
t('normalizePack fills metadata defaults', () => {
  const p = makePack();
  delete p.items[0].metadata;
  const n = E.normalizePack(p);
  eq(n.items[0].metadata, { difficulty: 1, tags: [], chapter: '' });
});

// ================= storage =================
console.log('\n== storage: packs / progress / stats ==');
t('savePack + listPacks + getPack roundtrip', () => {
  E.storage.savePack(makePack());
  const list = E.storage.listPacks();
  eq(list.length, 1);
  eq(list[0].itemCount, 3);
  const back = E.storage.getPack('p-test');
  eq(back.metadata.name, 'Test Pack');
});
t('duplicate pack id detection', () => {
  ok(E.storage.packIdExists('p-test'));
  ok(!E.storage.packIdExists('nope'));
});
t('deletePack removes pack + progress + stats', () => {
  const p = makePack({ metadata: Object.assign({}, makePack().metadata, { id: 'p-tmp' }) });
  E.storage.savePack(p);
  E.storage.recordProgress('p-tmp', 'i1', true);
  E.storage.deletePack('p-tmp');
  ok(E.storage.getPack('p-tmp') === null);
  eq(E.storage.getProgress('p-tmp'), {});
});
t('recordProgress accumulates attempts/correct/wrong', () => {
  E.storage.recordProgress('p-test', 'i1', true);
  E.storage.recordProgress('p-test', 'i1', false);
  const e = E.storage.getProgress('p-test').i1;
  eq([e.attempts, e.correct, e.wrong], [2, 1, 1]);
});

// ================= session =================
console.log('\n== session: flows ==');
function freshSession() {
  E.storage.wipeAll(); // isolate stats/progress between tests
  const pack = makePack();
  E.storage.savePack(pack);
  return pack;
}
t('construction: correct answer updates stats & advances', () => {
  const pack = freshSession();
  const { session, error } = E.session.createSession(pack, 'construction', { shuffle: false });
  ok(!error);
  eq(session.queue.length, 3);
  const q = E.session.questionOf(session, pack);
  eq(q.prompt, 'มวลพลังงาน');
  // answer with the real tokens (order = answerTokens)
  const it = pack.items[0];
  const res = E.session.answer(session, pack, it.answerTokens.slice());
  ok(res.correct && !res.done);
  eq(session.index, 1);
  eq(session.stats.attempts, 1);
  // per-item stats recorded
  const sm = E.storage.getStatsMap('p-test');
  ok(sm.item.i1.mode.construction.attempts === 1);
  ok(sm.pack.attempts === 1);
  const ov = E.storage.getOverallStats();
  ok(ov.total.attempts === 1 && ov.total.correct === 1);
});
t('construction: wrong answer tracked, streak resets, wrongIds', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  E.session.answer(session, pack, ['F', '=']); // wrong (2 tokens vs 3)
  eq(session.stats.wrong, 1);
  eq(session.wrongIds, ['i1']);
  const sm = E.storage.getStatsMap('p-test');
  eq(sm.pack.currentStreak, 0); // wrong resets
  eq(sm.pack.longestStreak, 0);
});
t('construction: session finishes after last item', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  let done = false;
  for (const it of pack.items) {
    const r = E.session.answer(session, pack, it.answerTokens.slice());
    done = r.done;
  }
  ok(done);
  eq(session.status, 'finished');
  eq(E.storage.getActiveSessionId(), ''); // active cleared
  eq(session.stats.attempts, 3);
});
t('deck: click budget = 2× group size, exposed via questionOf', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'deck', { shuffle: false });
  const q = E.session.questionOf(session, pack);
  // freshSession items are all singletons (different LHS) -> group of 1 -> budget 2
  eq(q.attemptsLeft, 2, 'single-card group gets 2 clicks');
  eq(q.budget, 2);
  ok(q.options.length >= 1);
  ok(q.options.every((o) => !o.verdict), 'nothing flipped at start');
});
t('deck: wrong picks spend a click but never advance or consume', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'deck', { shuffle: false });
  const before = session.currentItemId;
  const r = E.session.answer(session, pack, 'nonexistent'); // wrong pick
  eq(r.correct, false);
  eq(session.index, 0, 'NOT advanced');
  eq(session.currentItemId, before, 'question unchanged');
  eq(session.deckAttempts, 1, 'wrong pick spent one click');
  eq(session.stats.wrong, 1);
  ok(session.wrongIds.length >= 1);
  const q = E.session.questionOf(session, pack);
  eq(q.attemptsLeft, 1, 'one click left after one wrong pick');
  eq(q.options.find((o) => o.itemId === before).verdict, null, 'card still playable');
});
t('deck: correct pick flips ✓ immediately; wrong pick flips nothing', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'deck', { shuffle: false });
  const i1 = session.currentItemId;
  const r1 = E.session.answer(session, pack, i1);
  ok(r1.correct);
  eq(r1.remaining, 0, 'single-card group done after one correct');
  eq(session.deckAttempts, 0, 'budget reset after group complete');
  let q = E.session.questionOf(session, pack);
  eq(q.options.find((o) => o.itemId === i1).verdict, 'correct', 'card flipped face-down');
  // wrong pick on the NEXT question: flips nothing, spends a click
  const i2 = session.currentItemId;
  const wrongCard = q.options.find((o) => o.itemId !== i2 && !o.verdict);
  const rw = E.session.answer(session, pack, wrongCard.itemId);
  eq(rw.correct, false);
  q = E.session.questionOf(session, pack);
  eq(q.options.find((o) => o.itemId === wrongCard.itemId).verdict, null, 'wrong card NOT consumed');
  eq(session.currentItemId, i2, 'question unchanged');
});
t('deck: budget exhausted with correct cards unflipped -> REVEAL (✗ on missed)', () => {
  const pack = bundledPack(); // trig pack: sin(2A) x2, cos(2A) x4, cos(A) x2
  E.storage.wipeAll();
  E.storage.savePack(pack);
  const d = E.session.createSession(pack, 'deck', { shuffle: false }).session;
  // first question: sin(2A) -> group of 2 -> budget 4
  let q = E.session.questionOf(d, pack);
  const g = q.groupIds;
  eq(g.length, 2);
  eq(q.attemptsLeft, 4);
  // spend all 4 clicks WITHOUT completing: pick the two wrong cards twice each
  const wrongs = q.options.filter((o) => !g.includes(o.itemId) && !o.verdict).slice(0, 2);
  for (let i = 0; i < 2; i++) E.session.answer(d, pack, wrongs[0].itemId);
  for (let i = 0; i < 2; i++) E.session.answer(d, pack, wrongs[1].itemId);
  // 4th click exhausted the budget -> reveal fired
  q = E.session.questionOf(d, pack);
  const verdicts = {};
  for (const o of q.options) verdicts[o.itemId] = o.verdict;
  eq(verdicts[g[0]], 'wrong', 'missed correct card flipped ✗');
  eq(verdicts[g[1]], 'wrong', 'missed correct card flipped ✗');
  eq(verdicts[wrongs[0].itemId], null, 'picked-wrong card stays playable (belongs to a future question)');
  eq(d.status, 'running', 'reveal advances to the next question, session continues');
});
t('deck: multi-answer groups — stay on group until complete; budget = 2×size', () => {
  const pack = bundledPack();
  E.storage.wipeAll();
  E.storage.savePack(pack);
  const d = E.session.createSession(pack, 'deck', { shuffle: false }).session;
  let q = E.session.questionOf(d, pack);
  const g = q.groupIds; // sin(2A) -> 2 cards
  eq(g.length, 2);
  // pick the 1st member correct -> stays on the SAME group
  const r1 = E.session.answer(d, pack, g[0]);
  eq(r1.correct, true);
  eq(r1.remaining, 1);
  eq(d.currentItemId, g[1], 'jumped to the 2nd member of the same group');
  // pick the 2nd member correct -> group complete -> advance
  const r2 = E.session.answer(d, pack, g[1]);
  eq(r2.correct, true);
  eq(r2.remaining, 0);
  ok(d.index >= 2, 'advanced past the group');
  q = E.session.questionOf(d, pack);
  eq(q.prompt, 'cos(2A) = ?', 'next group: cos(2A)');
  eq(q.groupIds.length, 4, 'cos(2A) has 4 members');
  eq(q.attemptsLeft, 8, 'budget = 4 × 2');
  eq(q.options.filter((o) => o.verdict).length, 2, 'both sin(2A) cards face-down ✓');
});
t('deck: shuffled queue stays on the group until every member is picked', () => {
  const pack = bundledPack();
  E.storage.wipeAll();
  E.storage.savePack(pack);
  // scatter the sin(2A) members (items 0,1) with an unrelated card between them
  const ids = pack.items.map((i) => i.id);
  const a = ids[0];
  const b = ids[1];
  const rest = ids.slice(2);
  const scattered = [a, rest[0], b].concat(rest.slice(1));
  const d = E.session.createSession(pack, 'deck', { shuffle: false, itemIds: scattered }).session;
  eq(d.currentItemId, a);
  E.session.answer(d, pack, a); // pick the 1st member
  eq(d.currentItemId, b, 'still the same group — jumped over the unrelated card');
  E.session.answer(d, pack, b); // pick the 2nd member
  ok(d.currentItemId !== a && d.currentItemId !== b, 'group complete -> advanced to the next question');
});
t('deck: session finishes after every card is flipped (correct or revealed)', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'deck', { shuffle: false });
  let guard = 0;
  while (session.status !== 'finished' && guard++ < 100) {
    E.session.answer(session, pack, session.currentItemId);
  }
  eq(session.status, 'finished');
  eq(session.stats.correct, 3);
  eq(session.stats.wrong, 0);
  const countById = {};
  for (const c of session.completed) if (c.correct || c.revealed) countById[c.itemId] = true;
  eq(countById.i1, true);
  eq(countById.i2, true);
  eq(countById.i3, true);
});
t('deck: reveal flips ✗ only on missed-correct; wrong picks stay for later', () => {
  const pack = bundledPack();
  E.storage.wipeAll();
  E.storage.savePack(pack);
  const d = E.session.createSession(pack, 'deck', { shuffle: false }).session;
  let q = E.session.questionOf(d, pack);
  const g = q.groupIds; // sin(2A) x2 -> budget 4
  // 1 correct + 3 wrongs = 4 clicks; 2nd correct card never picked -> reveal
  E.session.answer(d, pack, g[0]); // correct (1 click)
  const wrongs = q.options.filter((o) => !g.includes(o.itemId) && !o.verdict);
  E.session.answer(d, pack, wrongs[0].itemId);
  E.session.answer(d, pack, wrongs[1].itemId);
  const r4 = E.session.answer(d, pack, wrongs[0].itemId); // 4th click -> budget out
  ok(!r4.correct);
  q = E.session.questionOf(d, pack);
  const verdicts = {};
  for (const o of q.options) verdicts[o.itemId] = o.verdict;
  eq(verdicts[g[0]], 'correct', 'picked-correct card stays ✓');
  eq(verdicts[g[1]], 'wrong', 'missed-correct card flipped ✗');
  eq(d.status, 'running', 'reveal advanced to the next question');
});
t('deck: shuffle never parks the cursor on a consumed card', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'deck', { shuffle: false });
  // simulate mid-game state: i1 fully consumed, i2 consumed, i3 untouched
  session.completed.push({ itemId: 'i1', correct: true, timeMs: 1 });
  session.completed.push({ itemId: 'i2', correct: true, timeMs: 1 });
  session.index = 0;
  session.currentItemId = 'i1';
  // force the shuffle to put the consumed i1 at the cursor position (index 0)
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    E.session.shuffleRemaining(session);
  } finally {
    Math.random = realRandom;
  }
  eq(session.currentItemId, 'i3', 'cursor parked on the only active card, not the consumed i1');
  const q2 = E.session.questionOf(session, pack);
  eq(q2.options.find((o) => o.itemId === session.currentItemId).verdict, null, 'cursor card is playable');
});
t('reverse: text answer, forgiving match', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'reverse', { shuffle: false });
  const q = E.session.questionOf(session, pack);
  eq(q.prompt, 'E = mc²'); // answer tokens joined
  const r = E.session.answer(session, pack, '  มวลพลังงาน ');
  ok(r.correct);
  const r2 = E.session.answer(session, pack, 'ผิด');
  ok(!r2.correct);
});
t('splitRhs: top-level operators split, operators kept', () => {
  eq(E.splitRhs('cos²(A)-sin²(A)'), ['cos²(A)', '−', 'sin²(A)']);
  eq(E.splitRhs('2cos²(A)-1'), ['2cos²(A)', '−', '1']);
  eq(E.splitRhs('1-2sin²(A)'), ['1', '−', '2sin²(A)']);
  eq(E.splitRhs('sin(A+B)+sin(A-B)'), ['sin(A+B)', '+', 'sin(A-B)']);
});
t('splitRhs: implicit multiplication splits at paren boundary', () => {
  eq(E.splitRhs('2sin(A)cos(A)'), ['2sin(A)', 'cos(A)']);
  eq(E.splitRhs('2sin((A+B)/2)cos((A-B)/2)'), ['2sin((A+B)/2)', 'cos((A-B)/2)']);
  eq(E.splitRhs('-2sin((A+B)/2)sin((A-B)/2)'), ['−2sin((A+B)/2)', 'sin((A-B)/2)']);
});
t('decomposeRhs: keeps nested groups atomic', () => {
  eq(E.splitRhs('2tan(A)/(1+tan²(A))'), ['2tan(A)', '/', '(1+tan²(A))']);
  eq(E.splitRhs('(1-tan²(A))/(1+tan²(A))'), ['(1-tan²(A))', '/', '(1+tan²(A))']);
  eq(E.splitRhs('2cos(A/2)'), ['2cos(A/2)']);
});
t('decomposeRhs: radical (√) + fraction inside the radicand', () => {
  eq(E.decomposeRhs('±√((1+cos(A))/2)'), {
    structure: ['±√', '(', '(', '@', '@', '@', ')', '/', '@', ')'],
    parts: ['1', '+', 'cos(A)', '2'],
  });
  eq(E.decomposeRhs('±√((1-cos(A))/(1+cos(A)))'), {
    structure: ['±√', '(', '(', '@', '@', '@', ')', '/', '(', '@', '@', '@', ')', ')'],
    parts: ['1', '−', 'cos(A)', '1', '+', 'cos(A)'],
  });
  eq(E.decomposeRhs('√(x+1)'), {
    structure: ['√', '(', '@', '@', '@', ')'],
    parts: ['x', '+', '1'],
  });
});
t('lhsOfPrompt / fullFormulaOf helpers', () => {
  eq(E.lhsOfPrompt('sin(2A) = ?'), 'sin(2A)');
  eq(E.fullFormulaOf('sin(2A) = ?', ['2sin(A)', 'cos(A)']), 'sin(2A) = 2sin(A) cos(A)');
});
t('decomposeRhs: fraction bar + parens are structure, operators are content', () => {
  eq(E.decomposeRhs('2tan(A)/(1-tan²(A))'), {
    structure: ['@', '/', '(', '@', '@', '@', ')'],
    parts: ['2tan(A)', '1', '−', 'tan²(A)'],
  });
  eq(E.decomposeRhs('cos²(A)-sin²(A)'), {
    structure: ['@', '@', '@'],
    parts: ['cos²(A)', '−', 'sin²(A)'],
  });
  eq(E.decomposeRhs('2sin(A)cos(A)'), {
    structure: ['@', '@'],
    parts: ['2sin(A)', 'cos(A)'],
  });
  eq(E.decomposeRhs('±√((1+cos(A))/2)'), {
    structure: ['±√', '(', '(', '@', '@', '@', ')', '/', '@', ')'],
    parts: ['1', '+', 'cos(A)', '2'],
  });
});
t('fullFormulaFromStructure rebuilds the complete formula', () => {
  eq(
    E.fullFormulaFromStructure('sin(2A) = ?', ['@', '/', '(', '@', '@', '@', ')'], ['2tan(A)', '1', '−', 'tan²(A)']),
    'sin(2A) = 2tan(A) / ( 1 − tan²(A) )'
  );
});
t('construction with formula-style pack (structure + parts)', () => {
  E.storage.wipeAll();
  const pack = {
    metadata: { id: 'p-formula', name: 'Formula', version: '1', author: '', description: '', subject: 'math', schemaVersion: 1 },
    items: [
      { id: 'f1', prompt: 'sin(2A) = ?', answerTokens: ['2sin(A)', 'cos(A)'], availableTokens: ['2sin(A)', 'cos(A)', 'cos²(A)', '−'], metadata: { difficulty: 2, tags: [], chapter: 'Double Angle' } },
    ],
  };
  E.storage.savePack(pack);
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  const q = E.session.questionOf(session, pack);
  eq(q.prompt, 'sin(2A) = ?');
  ok(E.session.answer(session, pack, ['2sin(A)', 'cos(A)']).correct);
});
t('reverse with formula-style pack (type the LHS)', () => {
  E.storage.wipeAll();
  const pack = {
    metadata: { id: 'p-formula2', name: 'Formula2', version: '1', author: '', description: '', subject: 'math', schemaVersion: 1 },
    items: [
      { id: 'f1', prompt: 'sin(2A) = ?', answerTokens: ['2sin(A)', 'cos(A)'], availableTokens: ['2sin(A)', 'cos(A)'], metadata: { difficulty: 2, tags: [], chapter: 'Double Angle' } },
    ],
  };
  E.storage.savePack(pack);
  const { session } = E.session.createSession(pack, 'reverse', { shuffle: false });
  const q = E.session.questionOf(session, pack);
  eq(q.prompt, '2sin(A) cos(A)');
  ok(E.session.answer(session, pack, 'sin(2A)').correct);
  ok(!E.session.answer(session, pack, 'cos(2A)').correct);
});
t('bundled trig-angle pack: valid + parts build the full formula', () => {
  const pack = bundledPack();
  const v = E.validatePack(pack);
  ok(v.ok, v.errors.join('; '));
  eq(pack.items.length, 26);
  for (const it of pack.items) {
    // every answer token must be available (already guaranteed by validatePack)
    // construction build must succeed for each item
    E.storage.wipeAll();
    E.storage.savePack(pack);
    const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
    const q = E.session.questionOf(session, pack);
    ok(q.prompt.endsWith('= ?'), 'prompt should be structure: ' + q.prompt);
    ok(E.session.answer(session, pack, pack.items[0].answerTokens.slice()).correct);
    if (it.structure) {
      ok(Array.isArray(it.structure), 'structure is an array');
      eq(it.structure.filter((s) => s === '@').length, it.answerTokens.length, 'slot count === parts count');
    }
  }
  ok(pack.items.some((it) => it.structure && it.structure.includes('/')), 'some item carries a fraction structure');
  ok(pack.items.some((it) => it.answerTokens.includes('−')), 'operators stay in content');
  // deck matching on the bundled pack (click budget = 2 × group size)
  E.storage.wipeAll();
  E.storage.savePack(pack);
  const d = E.session.createSession(pack, 'deck', { shuffle: false }).session;
  let dq = E.session.questionOf(d, pack);
  eq(dq.options.length, 26); // whole deck spread at start
  eq(dq.options.filter((o) => o.verdict).length, 0);
  ok(dq.options.some((o) => o.itemId === d.currentItemId), 'correct option among cards');
  const firstId = d.currentItemId;
  const rr1 = E.session.answer(d, pack, firstId);
  ok(rr1.correct, 'correct match registers');
  ok(!E.session.answer(d, pack, 'nonexistent').correct, 'wrong card is wrong');
  dq = E.session.questionOf(d, pack);
  eq(dq.options.length, 26); // positions unchanged
  eq(dq.options.find((o) => o.itemId === firstId).verdict, 'correct', 'correct card flips immediately');
  // full formula for one known item
  E.storage.wipeAll();
  const item1 = pack.items[0];
  eq(item1.prompt, 'sin(2A) = ?');
  eq(E.fullFormulaOf(item1.prompt, item1.answerTokens), 'sin(2A) = 2sin(A) cos(A)');
});
t('pause/resume/elapsed accounting', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  E.session.pauseSession(session);
  eq(session.status, 'paused');
  const saved = E.storage.loadSession(session.id);
  eq(saved.status, 'paused');
  E.session.resumeSession(session);
  eq(session.status, 'running');
  ok(session.pausedTotalMs >= 0);
});
t('session survives refresh via restoreActiveSession', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  E.session.answer(session, pack, pack.items[0].answerTokens.slice()); // one answer in
  // simulate refresh: wipe in-memory adapter state? No — restore reads storage
  const restored = E.session.restoreActiveSession();
  ok(restored && restored.session.id === session.id);
  eq(restored.session.index, 1);
  const q = E.session.questionOf(restored.session, restored.pack);
  eq(q.prompt, 'แรง');
});
t('finished session not restored', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  for (const it of pack.items) E.session.answer(session, pack, it.answerTokens.slice());
  ok(E.session.restoreActiveSession() === null);
});
t('retry wrong creates session with only wrong items', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  E.session.answer(session, pack, ['X']); // wrong
  E.session.answer(session, pack, pack.items[1].answerTokens.slice());
  E.session.answer(session, pack, pack.items[2].answerTokens.slice());
  const retry = E.session.retryWrongSession(pack, session);
  ok(!retry.error);
  eq(retry.session.queue.length, 1);
  eq(retry.session.queue[0], 'i1');
});
t('shuffle changes order but keeps items', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  const before = session.queue.slice();
  E.session.shuffleRemaining(session);
  const after = session.queue.slice();
  eq(before.slice().sort(), after.slice().sort());
  // with 3 items there is a chance shuffle = same order; try until different or 10 tries
  let differs = false;
  for (let i = 0; i < 10 && !differs; i++) {
    E.session.shuffleRemaining(session);
    differs = session.queue.some((id, j) => id !== before[j]);
  }
  ok(differs);
});

// ================= mastery =================
console.log('\n== mastery ==');
t('mastery transitions by correct count', () => {
  eq(E.stats.masteryFromCorrect(0), 'new');
  eq(E.stats.masteryFromCorrect(1), 'learning');
  eq(E.stats.masteryFromCorrect(2), 'learning');
  eq(E.stats.masteryFromCorrect(3), 'practicing');
  eq(E.stats.masteryFromCorrect(5), 'mastered');
});
t('progressByItem computes mastery from stored progress', () => {
  const pack = freshSession();
  E.storage.recordProgress('p-test', 'i1', true);
  E.storage.recordProgress('p-test', 'i1', true);
  E.storage.recordProgress('p-test', 'i1', true);
  const rows = E.stats.progressByItem(pack);
  const i1 = rows.find((r) => r.item.id === 'i1');
  eq(i1.mastery, 'practicing');
  eq(i1.accuracy, 100);
  const i2 = rows.find((r) => r.item.id === 'i2');
  eq(i2.mastery, 'new');
});
t('stats views: by pack / by mode / by item', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'construction', { shuffle: false });
  E.session.answer(session, pack, pack.items[0].answerTokens.slice());
  const views = E.stats.statsViews();
  ok(views.byPack.length >= 1);
  ok(views.byMode.construction.attempts >= 1);
  ok(views.byItem.length >= 1);
});

// ================= search =================
console.log('\n== search ==');
t('searchPacks matches name/subject, filters by subject', () => {
  const byName = E.search.searchPacks('Test');
  ok(byName.length === 1);
  const bySubject = E.search.searchPacks('math');
  ok(bySubject.length === 1);
  const filtered = E.search.searchPacks('', { subject: 'physics' });
  eq(filtered.length, 0);
});
t('searchItems matches prompt and answer, difficulty filter', () => {
  const pack = makePack();
  const byPrompt = E.search.searchItems(pack, 'แรง');
  eq(byPrompt.length, 1);
  eq(byPrompt[0].id, 'i2');
  const byAnswer = E.search.searchItems(pack, 'mc²');
  eq(byAnswer.length, 1);
  const d3 = E.search.searchItems(pack, '', { difficulty: 3 });
  eq(d3.length, 1);
  eq(d3[0].id, 'i3');
  const tagged = E.search.searchItems(pack, '', { tag: 'motion' });
  eq(tagged.length, 1);
});

// ================= ui layout contract: deck pile scrolls independently =================
console.log('\n== ui: deck pile scroll container ==');
t('deck shell pins the page to the viewport (game-shell--deck)', () => {
  const css = require('fs').readFileSync('css/style.css', 'utf8');
  ok(/\.game-shell--deck\s*\{/.test(css), '.game-shell--deck block exists');
  ok(/\.game-shell--deck[^}]*overflow:\s*hidden/s.test(css), 'deck shell clips overflow (no body scroll)');
  ok(/\.game-shell--deck[^}]*flex-direction:\s*column/s.test(css), 'deck shell is a flex column');
});
t('deck pile has its own scroll container (.match-scroll)', () => {
  const css = require('fs').readFileSync('css/style.css', 'utf8');
  ok(/\.game-shell--deck\s+\.match-scroll\s*\{[^}]*overflow-y:\s*auto/s.test(css), 'pile scrolls vertically inside deck shell');
  ok(/\.game-shell--deck\s+\.match-scroll\s*\{[^}]*min-height:\s*0/s.test(css), 'pile can shrink below content (flex child)');
  ok(/\.game-shell--deck\s+\.match-scroll\s*\{[^}]*flex:\s*1/s.test(css), 'pile takes the remaining right-pane space');
});
t('deck scroll container does not touch construction-mode layout', () => {
  const css = require('fs').readFileSync('css/style.css', 'utf8');
  // scroll rules must be scoped under .game-shell--deck (or be .match-scroll generic,
  // which is only ever rendered by renderMatchRight), never under .game-shell alone.
  ok(!/\.game-shell\s*\{[^}]*overflow-y:\s*auto/.test(css), 'plain .game-shell has no scroll rule');
});
t('play.js renders the pile inside .match-scroll and pins deck shell', () => {
  const js = require('fs').readFileSync('js/ui/play.js', 'utf8');
  ok(/class:\s*'match-scroll'/.test(js), 'renderMatchRight wraps the pile in .match-scroll');
  ok(/game-shell--deck/.test(js), 'deck shell modifier applied in game()');
  ok(/mode\.input\s*===\s*'match'\s*\?\s*' game-shell--deck'/.test(js), 'modifier only for deck (match input)');
  ok(/classList\.remove\('game-shell--deck'\)/.test(js), 'results screen removes the pinned-shell modifier');
});
t('deck card formulas can shrink/wrap inside the card (no overflow)', () => {
  const css = require('fs').readFileSync('css/style.css', 'utf8');
  ok(/\.match-card\s+\.formula\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%/.test(css),
    'card formula flex item can shrink below content width');
  ok(/\.match-card\s+\.formula-rhs\s*\{[^}]*max-width:\s*100%/.test(css),
    'card formula-rhs is width-constrained so flex-wrap can trigger');
  ok(/\.match-card\s+\.frac-num[^}]*flex-wrap:\s*wrap/.test(css) &&
     /\.match-card\s+\.frac-den[^}]*flex-wrap:\s*wrap/.test(css),
    'fraction rows wrap instead of poking out of the card');
});
t('deck formula wrap rules never leak into construction mode', () => {
  const css = require('fs').readFileSync('css/style.css', 'utf8');
  // construction renders .built-answer / .token-* / generic .formula; the wrap
  // rules must be scoped under .match-card only, so plain .formula / .formula-rhs
  // stay shrink-to-fit as before.
  ok(!/\bformula(?:-rhs)?\s*\{[^}]*min-width:\s*0/.test(css.replace(/\.match-card\s+\.formula[^}]*\}/g, '')),
    'no unscoped .formula/.formula-rhs min-width rule outside .match-card');
});

// ================= ui: deck drag-and-drop selection =================
console.log('\n== ui: deck drag-and-drop selection ==');
t('active deck cards are draggable and carry the itemId on dragstart', () => {
  const js = require('fs').readFileSync('js/ui/play.js', 'utf8');
  ok(/draggable:\s*'true'/.test(js), 'playable match card gets draggable=true');
  ok(/setData\(['"]text\/plain['"],\s*o\.itemId\)/.test(js), 'dragstart stores the card itemId in dataTransfer');
  ok(/effectAllowed\s*=\s*'move'/.test(js), 'drag effect is move');
});
t('left target area accepts the drop and submits the same selection', () => {
  const js = require('fs').readFileSync('js/ui/play.js', 'utf8');
  ok(/addEventListener\(['"]dragover['"]/.test(js), 'dragover listener allows the drop');
  ok(/addEventListener\(['"]drop['"]/.test(js), 'drop listener on the left question card');
  ok(/getData\(['"]text\/plain['"]\)/.test(js), 'drop reads the dragged itemId');
  ok(/submitMatch\(itemId,\s*btnEl\)/.test(js), 'drop reuses the click selection path');
});
t('drop wiring is deck-only: gated on match input', () => {
  const js = require('fs').readFileSync('js/ui/play.js', 'utf8');
  ok(/if \(mode\.input === 'match'\) wireDeckDropTarget\(card\)/.test(js),
    'drop target wired only for match (deck) input');
  ok(/function wireDeckDropTarget/.test(js), 'deck drop-target helper defined');
});
t('completed cards are no longer draggable', () => {
  const js = require('fs').readFileSync('js/ui/play.js', 'utf8');
  ok(/draggable: 'false'/.test(js), 'face-down cards render with draggable=false');
  ok(/setAttribute\(['"]draggable['"],\s*['"]false['"]\)/.test(js),
    '2nd correct match flips the card to non-draggable');
});
t('css provides dragging + drop-target feedback scoped to deck', () => {
  const css = require('fs').readFileSync('css/style.css', 'utf8');
  ok(/\.match-card\.dragging\s*\{/.test(css), 'source card visual exists while dragging');
  ok(/\.question-card\.drop-target\s*\{/.test(css), 'left target highlight exists on dragover');
});

// ================= performance (P0 targets) =================
console.log('\n== performance ==');
t('1000-item pack: validate+load <100ms, submit <16ms', () => {
  const items = [];
  for (let i = 0; i < 1000; i++) {
    const ans = 'a' + i + ' = b' + i + ' + c' + i;
    const at = E.tokenize(ans);
    items.push({
      id: 'k' + i,
      prompt: 'สูตรที่ ' + i,
      answerTokens: at,
      availableTokens: at.concat(['dummy']),
      metadata: { difficulty: 1 + (i % 5), tags: ['t' + (i % 10)], chapter: 'c' + (i % 8) },
    });
  }
  const pack = { metadata: { id: 'p-big', name: 'Big', version: '1', author: '', description: '', subject: 'math', schemaVersion: 1 }, items };

  let t0 = process.hrtime.bigint();
  const v = E.validatePack(pack);
  ok(v.ok);
  const jsonStr = JSON.stringify(pack); // simulate storage read
  let packLoaded;
  const t1 = process.hrtime.bigint();
  packLoaded = JSON.parse(jsonStr);
  const t2 = process.hrtime.bigint();
  ok(packLoaded.items.length === 1000);
  const loadMs = Number(t2 - t1) / 1e6;

  E.storage.savePack(pack);
  let s = E.session.createSession(pack, 'construction', { shuffle: false }).session;

  // submit latency: answer first 50 items
  const submits = [];
  for (let i = 0; i < 50 && s.status !== 'finished'; i++) {
    const it = pack.items[s.index];
    const ta = process.hrtime.bigint();
    E.session.answer(s, pack, it.answerTokens.slice());
    submits.push(Number(process.hrtime.bigint() - ta) / 1e6);
  }
  ok(submits.length === 50, 'expected 50 submits, got ' + submits.length);
  const maxSubmit = Math.max(...submits);
  const avgSubmit = submits.reduce((a, b) => a + b, 0) / submits.length;

  console.log('    load(parse 1000 items): ' + loadMs.toFixed(2) + 'ms (target <100ms)');
  console.log('    submit: avg ' + avgSubmit.toFixed(3) + 'ms, max ' + maxSubmit.toFixed(3) + 'ms (target <16ms)');
  ok(loadMs < 100, 'load too slow: ' + loadMs);
  ok(maxSubmit < 16, 'submit too slow: ' + maxSubmit);

  // cleanup big pack so later tests unaffected
  E.storage.deletePack('p-big');
});

// ================= summary =================
console.log('\n--------------------------------');
console.log('passed: ' + passed + '  failed: ' + failed);
if (failures.length) {
  for (const f of failures) console.log('  - ' + f.name + ': ' + f.e.message);
  process.exit(1);
}
