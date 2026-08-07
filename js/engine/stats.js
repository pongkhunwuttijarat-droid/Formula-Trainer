/**
 * Formula Trainer Engine — statistics & progress views
 * Mastery levels, per-item/per-pack/per-mode aggregation. No DOM.
 */
(function (global) {
  'use strict';

  const FTEngine = (global.FTEngine = global.FTEngine || {});
  const storage = () => FTEngine.storage;

  const MASTERY = {
    NEW: 'new',
    LEARNING: 'learning',
    PRACTICING: 'practicing',
    MASTERED: 'mastered',
  };

  const MASTERY_LABELS = {
    new: 'New',
    learning: 'Learning',
    practicing: 'Practicing',
    mastered: 'Mastered',
  };

  // Thresholds on number of correct answers (spec: based on times answered).
  const MASTERY_THRESHOLDS = [
    { level: MASTERY.NEW, minCorrect: 0 },
    { level: MASTERY.LEARNING, minCorrect: 1 },
    { level: MASTERY.PRACTICING, minCorrect: 3 },
    { level: MASTERY.MASTERED, minCorrect: 5 },
  ];

  /** Mastery level from a progress entry {attempts, correct}. */
  function masteryOf(entry) {
    if (!entry) return MASTERY.NEW;
    const correct = entry.correct || 0;
    let level = MASTERY.NEW;
    for (const t of MASTERY_THRESHOLDS) {
      if (correct >= t.minCorrect) level = t.level;
    }
    return level;
  }

  /** Mastery level by number of correct answers. */
  function masteryFromCorrect(correct) {
    return masteryOf({ correct: correct || 0, attempts: correct || 0 });
  }

  /** All mastery levels with ranges, for display. */
  function masteryLevels() {
    return MASTERY_THRESHOLDS.map((t, i) => ({
      level: t.level,
      label: MASTERY_LABELS[t.level],
      minCorrect: t.minCorrect,
      maxCorrect: i < MASTERY_THRESHOLDS.length - 1 ? MASTERY_THRESHOLDS[i + 1].minCorrect - 1 : Infinity,
    }));
  }

  /** Per-item progress + mastery for a pack. */
  function progressByItem(pack) {
    const prog = storage().getProgress(pack.metadata.id);
    return pack.items.map((it) => {
      const entry = prog[it.id] || { attempts: 0, correct: 0, wrong: 0, lastAt: 0 };
      return {
        item: it,
        attempts: entry.attempts,
        correct: entry.correct,
        wrong: entry.wrong,
        accuracy: entry.attempts > 0 ? Math.round((entry.correct / entry.attempts) * 1000) / 10 : 0,
        mastery: masteryOf(entry),
        lastAt: entry.lastAt,
      };
    });
  }

  /** Aggregated progress across all packs (for Home / Stats overview). */
  function overallProgress() {
    const packs = storage().listPacks();
    let attempts = 0, correct = 0, wrong = 0;
    const masteryCounts = { new: 0, learning: 0, practicing: 0, mastered: 0 };
    let itemTotal = 0;
    for (const p of packs) {
      const prog = storage().getProgress(p.metadata.id);
      itemTotal += p.itemCount;
      for (const itemId in prog) {
        const e = prog[itemId];
        attempts += e.attempts || 0;
        correct += e.correct || 0;
        wrong += e.wrong || 0;
        masteryCounts[masteryOf(e)] += 1;
      }
    }
    return {
      packCount: packs.length,
      itemTotal,
      attempts, correct, wrong,
      accuracy: attempts > 0 ? Math.round((correct / attempts) * 1000) / 10 : 0,
      masteryCounts,
    };
  }

  /** Stats view: by pack (across modes), by mode (across packs), by item. */
  function statsViews() {
    const packs = storage().listPacks();
    const byPack = [];
    const byMode = {};
    const overall = storage().getOverallStats();

    for (const p of packs) {
      const map = storage().getStatsMap(p.metadata.id);
      if (map.pack && map.pack.attempts > 0) {
        byPack.push({ pack: p.metadata, itemCount: p.itemCount, stats: map.pack, byMode: map.packMode });
      }
      if (map.packMode) {
        for (const modeId in map.packMode) {
          if (!byMode[modeId]) byMode[modeId] = storage().emptyStats();
          const s = byMode[modeId];
          const m = map.packMode[modeId];
          s.attempts += m.attempts; s.correct += m.correct; s.wrong += m.wrong; s.timeMs += m.timeMs;
          s.longestStreak = Math.max(s.longestStreak, m.longestStreak);
          s.currentStreak = Math.max(s.currentStreak, m.currentStreak);
        }
      }
    }
    for (const modeId in byMode) {
      const s = byMode[modeId];
      if (s.attempts > 0) s.bestAccuracy = Math.round((s.correct / s.attempts) * 1000) / 10;
    }

    // by item: leaf per item across modes (merged)
    const byItem = [];
    for (const p of packs) {
      const map = storage().getStatsMap(p.metadata.id);
      if (!map.item) continue;
      const pack = storage().getPack(p.metadata.id);
      if (!pack) continue;
      for (const itemId in map.item) {
        const modes = map.item[itemId].mode || {};
        const merged = storage().mergeStats(Object.values(modes));
        const item = pack.items.find((it) => it.id === itemId);
        if (!item) continue;
        const prog = storage().getProgress(p.metadata.id)[itemId];
        byItem.push({
          packId: p.metadata.id,
          packName: p.metadata.name,
          item,
          stats: merged,
          mastery: masteryOf(prog),
        });
      }
    }
    byItem.sort((a, b) => b.stats.attempts - a.stats.attempts);

    return { overall, byPack, byMode, byItem };
  }

  /** All subjects present in installed packs (for filters). */
  function listSubjects() {
    const set = new Set();
    for (const p of storage().listPacks()) set.add(p.metadata.subject);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }

  /** All tags present across installed packs (for filters). */
  function listTags() {
    const set = new Set();
    for (const p of storage().listPacks()) {
      const pack = storage().getPack(p.metadata.id);
      if (!pack) continue;
      for (const it of pack.items) it.metadata.tags.forEach((t) => set.add(t));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }

  FTEngine.stats = {
    MASTERY,
    MASTERY_LABELS,
    masteryOf,
    masteryFromCorrect,
    masteryLevels,
    progressByItem,
    overallProgress,
    statsViews,
    listSubjects,
    listTags,
  };
})(typeof window !== 'undefined' ? window : globalThis);
