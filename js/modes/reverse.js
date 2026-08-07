/**
 * Mode: Reverse — prompt and answer swap roles.
 * See the right side (result), type the left side (structure). No DOM.
 */
(function (global) {
  'use strict';
  const FTEngine = (global.FTEngine = global.FTEngine || {});

  FTEngine.session.registerMode({
    id: 'reverse',
    name: 'Reverse',
    nameTh: 'ย้อนกลับ',
    description: 'เห็นผลลัพธ์ฝั่งขวา → พิมพ์โครงฝั่งซ้าย (สลับโจทย์-คำตอบ)',
    input: 'text',
    loop: false,
    questionOf(item) {
      return {
        prompt: item.answerTokens.join(' '),
        structure: item.structure || null,
        parts: item.answerTokens,
        tokens: null,
      };
    },
    check(item, built) {
      return (
        FTEngine.normalizeText(built) ===
        FTEngine.normalizeText(FTEngine.lhsOfPrompt(item.prompt))
      );
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
