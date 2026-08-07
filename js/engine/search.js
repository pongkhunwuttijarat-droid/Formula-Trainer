/**
 * Formula Trainer Engine — search & filter
 * Pack search (metadata) and formula/item search (prompt/answer/tags/chapter)
 * with subject / difficulty / tag filters. Pure functions over packs. No DOM.
 */
(function (global) {
  'use strict';

  const FTEngine = (global.FTEngine = global.FTEngine || {});
  const storage = () => FTEngine.storage;

  function toLower(s) {
    return String(s == null ? '' : s).toLowerCase();
  }

  function tokensOf(query) {
    return toLower(query)
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function haystackOf(...parts) {
    return toLower(parts.join(' \u0001 '));
  }

  function matchesQuery(hay, qTokens) {
    return qTokens.every((t) => hay.includes(t));
  }

  /** Search installed pack metadata (name, description, subject, author). */
  function searchPacks(query, filters) {
    filters = filters || {};
    const qTokens = tokensOf(query || '');
    let results = storage()
      .listPacks()
      .map((p) => {
        const m = p.metadata;
        const hay = haystackOf(m.name, m.description, m.subject, m.author);
        const score = query
          ? (toLower(m.name).includes(toLower(query)) ? 2 : 0) +
            (toLower(m.subject).includes(toLower(query)) ? 1 : 0)
          : 0;
        return { pack: p, score, match: query ? matchesQuery(hay, qTokens) : true };
      })
      .filter((r) => r.match);

    if (filters.subject) {
      results = results.filter((r) => r.pack.metadata.subject === filters.subject);
    }
    results.sort((a, b) => b.score - a.score || a.pack.metadata.name.localeCompare(b.pack.metadata.name, 'th'));
    return results.map((r) => r.pack);
  }

  /** Search items inside a pack. Returns items + a per-item match highlight hint. */
  function searchItems(pack, query, filters) {
    filters = filters || {};
    const qTokens = tokensOf(query || '');
    let results = pack.items.map((it) => {
      const m = it.metadata;
      const hay = haystackOf(it.prompt, it.answerTokens.join(' '), m.tags.join(' '), m.chapter);
      const matchedToken = query ? it.answerTokens.find((t) => toLower(t).includes(toLower(query))) || null : null;
      return {
        item: it,
        score: query
          ? (toLower(it.prompt).includes(toLower(query)) ? 2 : 0) +
            (toLower(it.answerTokens.join(' ')).includes(toLower(query)) ? 1 : 0)
          : 0,
        match: query ? matchesQuery(hay, qTokens) : true,
        matchedToken,
      };
    });

    results = results.filter((r) => r.match);

    if (filters.difficulty) {
      const d = Number(filters.difficulty);
      results = results.filter((r) => Number.isFinite(d) && r.item.metadata.difficulty === d);
    }
    if (filters.tag) {
      results = results.filter((r) => r.item.metadata.tags.includes(filters.tag));
    }
    if (filters.chapter) {
      results = results.filter((r) => r.item.metadata.chapter === filters.chapter);
    }
    results.sort((a, b) => b.score - a.score || a.item.prompt.localeCompare(b.item.prompt, 'th'));
    return results.map((r) => r.item);
  }

  /** Distinct chapters in a pack (for chapter filter). */
  function listChapters(pack) {
    const set = new Set();
    for (const it of pack.items) if (it.metadata.chapter) set.add(it.metadata.chapter);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }

  /** Distinct difficulties present in a pack. */
  function listDifficulties(pack) {
    const set = new Set();
    for (const it of pack.items) set.add(it.metadata.difficulty);
    return Array.from(set).sort((a, b) => a - b);
  }

  FTEngine.search = {
    searchPacks,
    searchItems,
    listChapters,
    listDifficulties,
  };
})(typeof window !== 'undefined' ? window : globalThis);
