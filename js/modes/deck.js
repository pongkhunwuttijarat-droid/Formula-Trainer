/**
 * Mode: Deck — the whole deck is spread on the right from the start; match
 * each card to the structure (โครง) given on the left. A question = a group
 * of equal cards (e.g. cos(2A) × 4). The player gets 2×groupSize clicks for
 * the group: a correct pick flips that card face-down ✓; a wrong pick flashes
 * and spends a click. When the click budget runs out with correct cards still
 * unflipped, the group is revealed — picked-correct stay ✓, missed-correct
 * flip ✗. Engine-level, no DOM.
 */
(function (global) {
  'use strict';
  const FTEngine = (global.FTEngine = global.FTEngine || {});

  FTEngine.session.registerMode({
    id: 'deck',
    name: 'Deck',
    nameTh: 'กองการ์ด',
    description: 'กางการ์ดทั้งหมดฝั่งขวา → เลือกทุกใบที่เท่ากับโจทย์ฝั่งซ้าย — ถูกคว่ำ ✓, ผิดกระพริบแดง, กดได้ 2 เท่าของจำนวนใบที่ถูก (เช่น cos(2A) 4 ใบ → 8 ครั้ง) หมดแล้วเฉลย ✓/✗',
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
      // verdict per card: 'correct' (flipped ✓), 'wrong' (revealed ✗), null = playable
      const verdictById = {};
      for (const c of completed) {
        if (c.revealed) verdictById[c.itemId] = 'wrong';
        else if (c.correct && !verdictById[c.itemId]) verdictById[c.itemId] = 'correct';
      }
      // remaining click budget for the current group (2 × group size)
      const groupIds = this.groupOf(session, pack, item);
      const budget = groupIds.length * 2;
      const spent = session && session.deckAttempts ? session.deckAttempts : 0;
      const attemptsLeft = Math.max(0, budget - spent);
      // options = ALL items in pack order (stable board positions); answered cards are face-down
      return {
        prompt: item.prompt, // e.g. "cos(2A) = ?"
        structure: item.structure || null,
        parts: item.answerTokens,
        groupIds,
        attemptsLeft,
        budget,
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
