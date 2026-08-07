/**
 * Formula Trainer Engine — storage
 * Persistence layer over an injectable key/value adapter (browser localStorage,
 * in-memory for tests). No DOM.
 */
(function (global) {
  'use strict';

  const FTEngine = (global.FTEngine = global.FTEngine || {});
  const { uid } = FTEngine;

  const K = {
    packsIndex: 'ft.packs.index.v1', // [{metadata, itemCount, updatedAt}]
    packPrefix: 'ft.pack.v1.', // + packId
    sessionActive: 'ft.session.active.v1', // session id or ''
    sessionPrefix: 'ft.session.v1.', // + sessionId
    progressPrefix: 'ft.progress.v1.', // + packId -> {itemId: {attempts, correct, wrong, lastAt}}
    statsPrefix: 'ft.stats.v1.', // + packId -> {item:{...}, packMode:{...}, pack:{...}}; 'overall' special
  };

  const NAMESPACES = ['ft.packs.index.v1', 'ft.pack.v1.', 'ft.session.active.v1', 'ft.session.v1.', 'ft.progress.v1.', 'ft.stats.v1.'];

  let adapter = null; // {getItem, setItem, removeItem}

  function hasAdapter() {
    return !!(adapter && typeof adapter.getItem === 'function');
  }

  function setAdapter(a) {
    adapter = a;
  }

  function readJSON(key, fallback) {
    try {
      if (!hasAdapter()) return fallback;
      const raw = adapter.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    if (!hasAdapter()) return;
    try {
      adapter.setItem(key, JSON.stringify(value));
      return null;
    } catch (e) {
      // QuotaExceededError etc.
      return e;
    }
  }

  function remove(key) {
    if (!hasAdapter()) return;
    try { adapter.removeItem(key); } catch (e) { /* ignore */ }
  }

  /** Clear every key this engine owns (factory reset). */
  function wipeAll() {
    if (!hasAdapter()) return;
    try {
      const doomed = [];
      for (let i = 0; i < adapter.length; i++) {
        const k = adapter.key(i);
        if (k && NAMESPACES.some((ns) => k === ns || k.startsWith(ns))) doomed.push(k);
      }
      doomed.forEach((k) => adapter.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  // ---------- Packs ----------

  function listPackIndex() {
    const idx = readJSON(K.packsIndex, []);
    return Array.isArray(idx) ? idx : [];
  }

  function writePackIndex(idx) {
    return writeJSON(K.packsIndex, idx);
  }

  /** Lightweight pack list for fast rendering (no items loaded). */
  function listPacks() {
    return listPackIndex().map((e) => ({ metadata: e.metadata, itemCount: e.itemCount, updatedAt: e.updatedAt }));
  }

  function getPack(packId) {
    const p = readJSON(K.packPrefix + packId, null);
    return p && typeof p === 'object' ? p : null;
  }

  /** Save a pack (already normalized + validated). Returns {error} or null. */
  function savePack(pack) {
    const idx = listPackIndex();
    const existing = idx.find((e) => e.metadata.id === pack.metadata.id);
    const entry = {
      metadata: pack.metadata,
      itemCount: pack.items.length,
      updatedAt: Date.now(),
    };
    const err = writeJSON(K.packPrefix + pack.metadata.id, pack);
    if (err) return { error: 'บันทึกไม่สำเร็จ: พื้นที่จัดเก็บเต็ม (' + err.name + ')' };
    if (existing) Object.assign(existing, entry);
    else idx.push(entry);
    idx.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name, 'th'));
    writePackIndex(idx);
    return null;
  }

  function deletePack(packId) {
    const idx = listPackIndex().filter((e) => e.metadata.id !== packId);
    writePackIndex(idx);
    remove(K.packPrefix + packId);
    remove(K.progressPrefix + packId);
    remove(K.statsPrefix + packId);
  }

  function packIdExists(packId) {
    return listPackIndex().some((e) => e.metadata.id === packId);
  }

  /** Number of installed packs. */
  function packCount() {
    return listPackIndex().length;
  }

  // ---------- Sessions ----------

  function getActiveSessionId() {
    const id = readJSON(K.sessionActive, '');
    return typeof id === 'string' ? id : '';
  }

  function setActiveSessionId(id) {
    writeJSON(K.sessionActive, id || '');
  }

  function saveSession(session) {
    const err = writeJSON(K.sessionPrefix + session.id, session);
    if (err) return { error: 'บันทึก session ไม่สำเร็จ: พื้นที่จัดเก็บเต็ม' };
    return null;
  }

  function loadSession(id) {
    return readJSON(K.sessionPrefix + id, null);
  }

  function clearSession(id) {
    remove(K.sessionPrefix + id);
    if (getActiveSessionId() === id) setActiveSessionId('');
  }

  // ---------- Progress ----------

  function getProgress(packId) {
    return readJSON(K.progressPrefix + packId, {}) || {};
  }

  /** Record one answer. Returns updated progress entry. */
  function recordProgress(packId, itemId, correct) {
    const prog = getProgress(packId);
    const e = prog[itemId] || { attempts: 0, correct: 0, wrong: 0, lastAt: 0 };
    e.attempts += 1;
    if (correct) e.correct += 1;
    else e.wrong += 1;
    e.lastAt = Date.now();
    prog[itemId] = e;
    writeJSON(K.progressPrefix + packId, prog);
    return e;
  }

  // ---------- Statistics ----------
  // Leaf per (packId): { item: {itemId: {mode: {modeId: Stats}}}, packMode: {modeId: Stats}, pack: Stats }
  // 'overall' is a special packId for global rollup.

  function emptyStats() {
    return { attempts: 0, correct: 0, wrong: 0, timeMs: 0, bestAccuracy: 0, longestStreak: 0, currentStreak: 0 };
  }

  function getStatsMap(packId) {
    return readJSON(K.statsPrefix + packId, null) || { item: {}, packMode: {}, pack: emptyStats() };
  }

  function recordStats(packId, modeId, itemId, correct, timeMs, streakDelta) {
    const map = getStatsMap(packId);
    if (!map.item) map.item = {};
    if (!map.packMode) map.packMode = {};
    if (!map.pack) map.pack = emptyStats();

    const touch = (s, c, t) => {
      s.attempts += 1;
      if (c) s.correct += 1;
      else s.wrong += 1;
      s.timeMs += t;
      s.currentStreak = c ? s.currentStreak + 1 : 0;
      if (s.currentStreak > s.longestStreak) s.longestStreak = s.currentStreak;
      const acc = Math.round((s.correct / s.attempts) * 1000) / 10;
      if (acc > s.bestAccuracy) s.bestAccuracy = acc;
    };

    // leaf: item + mode
    if (!map.item[itemId]) map.item[itemId] = { mode: {} };
    if (!map.item[itemId].mode[modeId]) map.item[itemId].mode[modeId] = emptyStats();
    touch(map.item[itemId].mode[modeId], correct, timeMs);

    // pack + mode rollup
    if (!map.packMode[modeId]) map.packMode[modeId] = emptyStats();
    touch(map.packMode[modeId], correct, timeMs);

    // pack rollup
    touch(map.pack, correct, timeMs);

    writeJSON(K.statsPrefix + packId, map);

    // overall rollup (kept as a plain map keyed by mode + a total)
    const overall = readJSON(K.statsPrefix + 'overall', null) || { mode: {}, total: emptyStats() };
    if (!overall.mode) overall.mode = {};
    if (!overall.mode[modeId]) overall.mode[modeId] = emptyStats();
    touch(overall.mode[modeId], correct, timeMs);
    if (!overall.total) overall.total = emptyStats();
    touch(overall.total, correct, timeMs);
    writeJSON(K.statsPrefix + 'overall', overall);
  }

  function getOverallStats() {
    return readJSON(K.statsPrefix + 'overall', null) || { mode: {}, total: emptyStats() };
  }

  /** Aggregate a leaf map into a single Stats object (for By Item views). */
  function mergeStats(list) {
    const s = emptyStats();
    for (const one of list) {
      s.attempts += one.attempts;
      s.correct += one.correct;
      s.wrong += one.wrong;
      s.timeMs += one.timeMs;
      s.longestStreak = Math.max(s.longestStreak, one.longestStreak);
      s.currentStreak = Math.max(s.currentStreak, one.currentStreak);
    }
    if (s.attempts > 0) s.bestAccuracy = Math.round((s.correct / s.attempts) * 1000) / 10;
    return s;
  }

  FTEngine.storage = {
    setAdapter,
    hasAdapter: () => hasAdapter(),
    wipeAll,
    listPacks,
    getPack,
    savePack,
    deletePack,
    packIdExists,
    packCount,
    getActiveSessionId,
    setActiveSessionId,
    saveSession,
    loadSession,
    clearSession,
    getProgress,
    recordProgress,
    recordStats,
    getStatsMap,
    getOverallStats,
    mergeStats,
    emptyStats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
