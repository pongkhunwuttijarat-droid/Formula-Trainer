/**
 * Formula Trainer Engine — session state machine + mode registry
 * Generic across game modes: a mode is a pluggable definition
 * ({id, name, input, loop, questionOf, check}). New modes can be added
 * without touching this file. Pure logic, no DOM.
 */
(function (global) {
  'use strict';

  const FTEngine = (global.FTEngine = global.FTEngine || {});
  const storage = () => FTEngine.storage;
  const { uid } = FTEngine;

  // ---------------- Mode registry ----------------

  const modes = new Map();

  function registerMode(def) {
    if (!def || typeof def.id !== 'string' || !def.id) {
      throw new Error('registerMode: ต้องมี id');
    }
    if (typeof def.questionOf !== 'function' || typeof def.check !== 'function') {
      throw new Error('registerMode: ต้องมี questionOf() และ check()');
    }
    modes.set(def.id, {
      id: def.id,
      name: def.name || def.id,
      nameTh: def.nameTh || def.name || def.id,
      description: def.description || '',
      input: ['tokens', 'text', 'match'].includes(def.input) ? def.input : 'tokens',
      loop: !!def.loop,
      multiSelect: !!def.multiSelect,
      // number of correct matches a card needs before it is consumed/flipped
      // (deck mode uses 2; other modes default to the classic 1)
      rounds: def.rounds || 1,
      groupOf: def.groupOf,
      questionOf: def.questionOf,
      check: def.check,
    });
    return def;
  }

  function getMode(id) {
    return modes.get(id) || null;
  }

  function listModes() {
    return Array.from(modes.values());
  }

  // ---------------- Helpers ----------------

  function shuffleArray(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function itemOf(pack, itemId) {
    return (pack && pack.items.find((it) => it.id === itemId)) || null;
  }

  function sessionElapsed(s) {
    const base = (s.finishedAt || Date.now()) - s.startedAt - s.pausedTotalMs;
    return Math.max(0, base);
  }

  function sessionAccuracy(s) {
    return s.stats.attempts > 0 ? Math.round((s.stats.correct / s.stats.attempts) * 1000) / 10 : 0;
  }

  // ---------------- Session lifecycle ----------------

  /**
   * Create a new session.
   * opts: { itemIds?, shuffle?, modeId }
   * pack: full KnowledgePack object.
   */
  function createSession(pack, modeId, opts) {
    opts = opts || {};
    const mode = getMode(modeId);
    if (!mode) return { error: 'ไม่รู้จักโหมด: ' + modeId };
    if (!pack || !pack.items || pack.items.length === 0) {
      return { error: 'pack ว่าง ไม่สามารถเล่นได้' };
    }
    const itemIds = opts.itemIds && opts.itemIds.length > 0
      ? opts.itemIds.filter((id) => itemOf(pack, id))
      : pack.items.map((it) => it.id);
    if (itemIds.length === 0) return { error: 'ไม่มี item ให้เล่น' };

    const queue = opts.shuffle ? shuffleArray(itemIds) : itemIds.slice();
    const now = Date.now();
    const session = {
      id: uid(),
      packId: pack.metadata.id,
      packName: pack.metadata.name,
      modeId: mode.id,
      modeName: mode.nameTh,
      status: 'running',
      queue,
      index: 0,
      currentItemId: queue[0] || null,
      built: [],
      input: '',
      completed: [],
      wrongIds: [],
      // deck (multi-select): clicks spent on the CURRENT group. Budget =
      // group size × 2; every pick (right or wrong) spends one. When the
      // budget runs out with correct cards still unflipped, the group is
      // revealed (✓ for picked-correct, ✗ for missed-correct) and we advance.
      deckAttempts: 0,
      stats: { attempts: 0, correct: 0, wrong: 0, timeMs: 0 },
      startedAt: now,
      finishedAt: 0,
      pausedAt: 0,
      pausedTotalMs: 0,
      turnStartedAt: now,
      shuffled: !!opts.shuffle,
    };
    storage().setActiveSessionId(session.id);
    storage().saveSession(session);
    return { session };
  }

  /** Question payload for the current item (what the UI renders). */
  function questionOf(session, pack) {
    const mode = getMode(session.modeId);
    const item = itemOf(pack, session.currentItemId);
    if (!mode || !item) return null;
    return mode.questionOf(item, { pack, session });
  }

  /** Submit an answer: builtTokens (array) or builtText (string). */
  function answer(session, pack, built) {
    const mode = getMode(session.modeId);
    const item = itemOf(pack, session.currentItemId);
    if (!mode || !item) return { error: 'session ไม่ถูกต้อง' };
    if (session.status !== 'running') return { error: 'session ไม่ได้กำลังเล่น' };

    // multi-select modes (e.g. deck): every card equal to the question must be
    // picked; wrong picks consume nothing (the card belongs to another question)
    if (mode.multiSelect && mode.input === 'match') {
      return answerMultiSelect(session, pack, String(built), mode);
    }

    const verdict = mode.check(item, built);
    const now = Date.now();
    const ansTime = Math.max(0, now - session.turnStartedAt);
    session.turnStartedAt = now;

    session.stats.attempts += 1;
    if (verdict) session.stats.correct += 1;
    else session.stats.wrong += 1;
    session.stats.timeMs += ansTime;

    storage().recordProgress(session.packId, item.id, verdict);
    storage().recordStats(session.packId, session.modeId, item.id, verdict, ansTime);

    session.completed.push({ itemId: item.id, correct: verdict, timeMs: ansTime });
    if (!verdict) session.wrongIds.push(item.id);

    // advance
    if (mode.loop) {
      session.queue.shift();
      if (!verdict) session.queue.push(item.id); // requeue wrong to the end
      session.currentItemId = session.queue.length > 0 ? session.queue[0] : null;
    } else {
      session.index += 1;
      session.currentItemId = session.index < session.queue.length ? session.queue[session.index] : null;
    }

    const done = session.currentItemId === null;
    if (done) {
      session.status = 'finished';
      session.finishedAt = now;
      session.built = [];
      session.input = '';
      storage().clearSession(session.id);
    } else {
      session.built = [];
      session.input = '';
      storage().saveSession(session);
    }
    return { correct: verdict, done, session, item };
  }

  /**
   * Multi-select answer (deck): the question = a group of equal cards.
   * The player gets `groupSize × 2` clicks total for the group. Every pick
   * (correct OR wrong) spends one click. A correct pick flips that card
   * face-down (✓); a wrong pick flashes and spends a click without flipping.
   * If the budget runs out before every correct card is flipped, the group is
   * revealed: picked-correct cards keep ✓, missed-correct cards flip ✗.
   */
  function answerMultiSelect(session, pack, pickedId, mode) {
    const item = itemOf(pack, session.currentItemId);
    if (!item) return { error: 'session ไม่ถูกต้อง' };
    const now = Date.now();
    const ansTime = Math.max(0, now - session.turnStartedAt);
    session.turnStartedAt = now;

    const groupIds = mode.groupOf ? mode.groupOf(session, pack, item) : [item.id];
    const verdict = groupIds.indexOf(pickedId) !== -1;
    const targetId = verdict ? pickedId : item.id;

    session.stats.attempts += 1;
    if (verdict) session.stats.correct += 1;
    else session.stats.wrong += 1;
    session.stats.timeMs += ansTime;

    storage().recordProgress(session.packId, targetId, verdict);
    storage().recordStats(session.packId, session.modeId, targetId, verdict, ansTime);

    session.completed.push({ itemId: targetId, correct: verdict, timeMs: ansTime });
    if (!verdict && session.wrongIds.indexOf(targetId) === -1) session.wrongIds.push(targetId);

    // click budget = 2 × group size; every pick (right or wrong) spends one
    const budget = groupIds.length * 2;
    session.deckAttempts = (session.deckAttempts || 0) + 1;
    const attemptsLeft = Math.max(0, budget - session.deckAttempts);

    // correct cards still not flipped (revealed ✗ cards count as done)
    const missing = groupIds.filter((gid) => !isCardDone(session, gid));
    let revealed = false;

    if (verdict && missing.length === 0) {
      // every correct card flipped -> group complete, advance
      advanceDeckScan(session);
      session.deckAttempts = 0;
    } else if (attemptsLeft === 0 && missing.length > 0) {
      // budget exhausted with correct cards still unflipped -> REVEAL:
      // mark every missed-correct card as a wrong answer so the UI flips ✗
      for (const gid of missing) {
        session.completed.push({ itemId: gid, correct: false, revealed: true, timeMs: 0 });
        if (session.wrongIds.indexOf(gid) === -1) session.wrongIds.push(gid);
      }
      revealed = true;
      advanceDeckScan(session);
      session.deckAttempts = 0;
    } else if (verdict) {
      // correct pick but group not done yet — stay on the group, jump to the
      // next unconsumed member (members may be scattered in a shuffled queue)
      const nextMember = groupIds.find((gid) => !isCardDone(session, gid));
      session.index = session.queue.indexOf(nextMember);
      session.currentItemId = nextMember;
    }
    // wrong pick without budget exhaustion: question stays exactly where it is

    const done = session.currentItemId === null;
    if (done) {
      session.status = 'finished';
      session.finishedAt = now;
      session.built = [];
      session.input = '';
      storage().clearSession(session.id);
    } else {
      session.built = [];
      session.input = '';
      storage().saveSession(session);
    }
    return {
      correct: verdict,
      done,
      session,
      item,
      remaining: missing.length,
      attemptsLeft,
      revealed,
    };
  }

  /** True when a card already has a CORRECT match (flipped face-down). */
  function isConsumedCorrect(session, itemId) {
    return session.completed.some((c) => c.itemId === itemId && c.correct);
  }

  /**
   * True when a card is DONE for this session: either flipped ✓ (correct) or
   * revealed ✗ (missed when the click budget ran out). Revealed cards must be
   * skipped by the cursor scan too, or the deck parks on a face-down card.
   */
  function isCardDone(session, itemId) {
    return session.completed.some((c) => c.itemId === itemId && (c.correct || c.revealed));
  }

  /**
   * Advance the deck cursor to the next card that still needs a correct match.
   * Done cards (flipped ✓ or revealed ✗) are skipped — they sit face-down at
   * their original spot.
   */
  function advanceDeckScan(session) {
    const len = session.queue.length;
    if (len === 0) {
      session.index = 0;
      session.currentItemId = null;
      return;
    }
    let idx = session.index;
    for (let steps = 0; steps < len; steps++) {
      idx = (idx + 1) % len;
      if (!isCardDone(session, session.queue[idx])) {
        session.index = idx;
        session.currentItemId = session.queue[idx];
        return;
      }
    }
    // every card consumed -> session finished
    session.index = len;
    session.currentItemId = null;
  }

  function pauseSession(session) {
    if (session.status !== 'running') return session;
    session.status = 'paused';
    session.pausedAt = Date.now();
    storage().saveSession(session);
    return session;
  }

  function resumeSession(session) {
    if (session.status !== 'paused') return session;
    if (session.pausedAt > 0) session.pausedTotalMs += Date.now() - session.pausedAt;
    session.pausedAt = 0;
    session.status = 'running';
    session.turnStartedAt = Date.now();
    storage().saveSession(session);
    return session;
  }

  /** Restart: same pack+mode, fresh queue (keeps shuffle preference). */
  function restartSession(pack, session) {
    const fresh = createSession(pack, session.modeId, {
      shuffle: session.shuffled,
      itemIds: pack.items.map((it) => it.id),
    });
    storage().clearSession(session.id);
    return fresh;
  }

  /** New session containing only previously-wrong items. */
  function retryWrongSession(pack, session) {
    if (session.wrongIds.length === 0) {
      return { error: 'ไม่มีข้อที่ตอบผิด' };
    }
    const fresh = createSession(pack, session.modeId, {
      shuffle: true,
      itemIds: session.wrongIds,
    });
    storage().clearSession(session.id);
    return fresh;
  }

  /** Shuffle the remaining queue in place. */
  function shuffleRemaining(session) {
    if (session.status !== 'running') return session;
    if (getMode(session.modeId).loop) {
      session.queue = shuffleArray(session.queue);
      session.currentItemId = session.queue.length > 0 ? session.queue[0] : null;
    } else {
      const rest = shuffleArray(session.queue.slice(session.index));
      session.queue = session.queue.slice(0, session.index).concat(rest);
      session.currentItemId = session.index < session.queue.length ? session.queue[session.index] : null;
      // deck (multi-select): never park the cursor on an already-flipped card —
      // done cards (✓ or ✗) sit face-down alongside active ones, so a shuffle
      // could otherwise soft-lock the game (face-down cards can't be picked)
      const mode = getMode(session.modeId);
      if (
        mode && mode.multiSelect && mode.input === 'match' &&
        session.currentItemId !== null &&
        isCardDone(session, session.currentItemId)
      ) {
        advanceDeckScan(session);
      }
    }
    session.shuffled = true;
    storage().saveSession(session);
    return session;
  }

  /** Quit (abandon) a session without recording anything new. */
  function quitSession(session) {
    storage().clearSession(session.id);
  }

  /** Try to restore an in-progress session after a refresh. */
  function restoreActiveSession() {
    const id = storage().getActiveSessionId();
    if (!id) return null;
    const s = storage().loadSession(id);
    if (!s) return null;
    if (s.status !== 'running' && s.status !== 'paused') {
      storage().clearSession(id);
      return null;
    }
    const pack = storage().getPack(s.packId);
    if (!pack) {
      storage().clearSession(id);
      return null;
    }
    if (!getMode(s.modeId)) {
      storage().clearSession(id);
      return null;
    }
    // guard: current item must still exist
    if (s.currentItemId && !itemOf(pack, s.currentItemId)) {
      storage().clearSession(id);
      return null;
    }
    return { session: s, pack };
  }

  FTEngine.session = {
    registerMode,
    getMode,
    listModes,
    createSession,
    questionOf,
    answer,
    pauseSession,
    resumeSession,
    restartSession,
    retryWrongSession,
    shuffleRemaining,
    quitSession,
    restoreActiveSession,
    sessionElapsed,
    sessionAccuracy,
    shuffleArray,
  };
})(typeof window !== 'undefined' ? window : globalThis);
