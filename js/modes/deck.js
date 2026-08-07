/**
 * Mode: Deck — the whole deck is spread on the right from the start; match
 * each card to the structure (โครง) given on the left. Every question
 * consumes one card: a correct match flips the card face-down IN PLACE; a
 * wrong match flips the CORRECT card face-down as well (the answer is shown
 * in the feedback). Cards never requeue — the deck drains one per question.
 * Engine-level, no DOM.
 */
(function (global) {
  'use strict';
  const FTEngine = (global.FTEngine = global.FTEngine || {});

  FTEngine.session.registerMode({
    id: 'deck',
    name: 'Deck',
    nameTh: 'กองการ์ด',
    description: 'กางการ์ดทั้งหมดฝั่งขวา → เลือกทุกใบที่เท่ากับโจทย์ฝั่งซ้าย — ถูกคว่ำ ✓, ผิดกระพริบแดง (เช่น cos(2A) มี 4 ใบ)',
    input: 'match', // UI renders the whole deck; answer = chosen item id
    loop: false, // one card per question — wrong matches do NOT requeue
    multiSelect: true, // every card equal to the question must be picked (e.g. cos(2A) × 4)
    // the question group = all items sharing the same left side (e.g. cos(2A))
    groupOf(session, pack, item) {
      const lhs = FTEngine.lhsOfPrompt(item.prompt);
      return pack.items
        .filter((it) => FTEngine.lhsOfPrompt(it.prompt) === lhs)
        .map((it) => it.id);
    },
    questionOf(item, ctx) {
      const pack = ctx && ctx.pack ? ctx.pack : { items: [item] };
      const session = ctx && ctx.session ? ctx.session : null;
      const completed = session ? session.completed : [];
      // only CORRECT picks consume a card; wrong picks flip nothing (keep trying)
      const verdictById = {};
      for (const c of completed) {
        if (c.correct && !verdictById[c.itemId]) verdictById[c.itemId] = 'correct';
      }
      // options = ALL items in pack order (stable board positions); answered cards are face-down
      return {
        prompt: item.prompt, // e.g. "cos(2A) = ?"
        structure: item.structure || null,
        parts: item.answerTokens,
        groupIds: this.groupOf(session, pack, item),
        options: pack.items.map((it) => ({
          itemId: it.id,
          structure: it.structure || null,
          parts: it.answerTokens,
          verdict: verdictById[it.id] || null, // null = still playable; 'correct' | 'wrong'
        })),
        tokens: null,
      };
    },
    check(item, built) {
      return built === item.id; // UI passes the chosen option's item id
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
