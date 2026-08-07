/**
 * Mode: Construction — structure (fraction bars + parens) is pre-provided,
 * the user fills the remaining parts from the right-side pool.
 * Engine-level definition; registers itself into the mode registry. No DOM.
 */
(function (global) {
  'use strict';
  const FTEngine = (global.FTEngine = global.FTEngine || {});

  FTEngine.session.registerMode({
    id: 'construction',
    name: 'Construction',
    nameTh: 'ประกอบคำตอบ',
    description: 'โครงเศษส่วน/วงเล็บให้มาแล้ว → แตะส่วนประกอบฝั่งขวาเติมให้เต็ม',
    input: 'tokens',
    loop: false,
    questionOf(item) {
      return {
        prompt: item.prompt, // e.g. "sin(2A) = ?"
        structure: item.structure || null, // ['@','/','(','@','@','@',')'] — '@' = slot
        parts: item.answerTokens,
        tokens: FTEngine.session.shuffleArray(item.availableTokens),
      };
    },
    check(item, built) {
      if (!Array.isArray(built)) return false;
      if (built.length !== item.answerTokens.length) return false;
      return built.every((t, i) => t === item.answerTokens[i]);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
