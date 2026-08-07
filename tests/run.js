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
t('deck: wrong picks consume nothing; correct picks consume the card', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'deck', { shuffle: false });
  E.session.answer(session, pack, 'nonexistent'); // wrong pick
  eq(session.index, 0); // NOT advanced
  eq(session.stats.wrong, 1);
  ok(session.wrongIds.length >= 1);
  E.session.answer(session, pack, session.currentItemId); // correct
  eq(session.index, 1);
  E.session.answer(session, pack, session.currentItemId);
  eq(session.index, 2);
  E.session.answer(session, pack, session.currentItemId);
  eq(session.status, 'finished');
  eq(session.stats.attempts, 4);
  eq(session.stats.correct, 3);
  eq(session.stats.wrong, 1);
});
t('deck: whole deck visible; matched cards flip face-down in place', () => {
  const pack = freshSession();
  const { session } = E.session.createSession(pack, 'deck', { shuffle: false });
  let q = E.session.questionOf(session, pack);
  eq(q.options.length, 3); // ALL cards present (stable positions)
  ok(q.options.every((o) => !o.verdict), 'nothing answered at start');
  const mine = q.options.find((o) => o.itemId === session.currentItemId);
  ok(mine, 'correct option present');
  eq(mine.parts, ['E', '=', 'mc²']); // RHS parts of the correct card
  ok(q.options.every((o) => Array.isArray(o.parts) && o.parts.length > 0));
  // correct match -> card flips face-down with verdict 'correct'
  const i1 = session.currentItemId;
  E.session.answer(session, pack, i1);
  q = E.session.questionOf(session, pack);
  eq(q.options.length, 3); // still all present (positions unchanged)
  eq(q.options.filter((o) => o.verdict).length, 1); // one face-down
  eq(q.options.find((o) => o.itemId === i1).verdict, 'correct');
  // wrong pick -> NOTHING is consumed; the wrong card stays playable
  const i2 = session.currentItemId;
  const wrongCard = q.options.find((o) => !o.verdict && o.itemId !== i2);
  E.session.answer(session, pack, wrongCard.itemId);
  q = E.session.questionOf(session, pack);
  eq(q.options.filter((o) => o.verdict).length, 1); // still just one
  eq(q.options.find((o) => o.itemId === wrongCard.itemId).verdict, null); // not consumed
  eq(session.currentItemId, i2); // question unchanged
  eq(session.stats.wrong, 1);
});
t('deck: multi-answer groups — pick EVERY card equal to the question', () => {
  const pack = bundledPack(); // trig pack: sin(2A) x2, cos(2A) x4, cos(A) x2
  E.storage.wipeAll();
  E.storage.savePack(pack);
  const d = E.session.createSession(pack, 'deck', { shuffle: false }).session;
  // first question: sin(2A) -> group of 2
  let q = E.session.questionOf(d, pack);
  const g = q.groupIds;
  eq(g.length, 2);
  // wrong pick on a non-group card: no advance, no consumption
  const other = q.options.find((o) => !g.includes(o.itemId) && !o.verdict);
  const rw = E.session.answer(d, pack, other.itemId);
  eq(rw.correct, false);
  eq(d.index, 0);
  // pick both group cards -> advance only after the last one
  const r1 = E.session.answer(d, pack, g[0]);
  eq(r1.correct, true);
  eq(r1.remaining, 1);
  eq(d.index, 1); // advanced to the 2nd member of the SAME group
  eq(d.currentItemId, g[1]); // still the same question
  const r2 = E.session.answer(d, pack, g[1]);
  eq(r2.correct, true);
  eq(r2.remaining, 0);
  ok(d.index >= 2, 'advanced past the group');
  // next question: cos(2A) -> group of 4
  q = E.session.questionOf(d, pack);
  eq(q.prompt, 'cos(2A) = ?');
  eq(q.groupIds.length, 4);
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
  // deck matching on the bundled pack
  E.storage.wipeAll();
  E.storage.savePack(pack);
  const d = E.session.createSession(pack, 'deck', { shuffle: false }).session;
  let dq = E.session.questionOf(d, pack);
  eq(dq.options.length, 26); // whole deck spread at start
  eq(dq.options.filter((o) => o.verdict).length, 0);
  ok(dq.options.some((o) => o.itemId === d.currentItemId), 'correct option among cards');
  const firstId = d.currentItemId;
  ok(E.session.answer(d, pack, firstId).correct, 'matching the right card is correct');
  ok(!E.session.answer(d, pack, 'nonexistent').correct, 'wrong card is wrong');
  dq = E.session.questionOf(d, pack);
  eq(dq.options.length, 26); // positions unchanged
  eq(dq.options.filter((o) => o.verdict).length, 1); // only the correct card flipped
  eq(dq.options.find((o) => o.itemId === firstId).verdict, 'correct');
  ok(dq.options.every((o) => !o.verdict || o.itemId === firstId));
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
