/**
 * Formula Trainer Engine — core
 * Pure logic: types, tokenization, normalization, pack validation.
 * NO DOM / HTML / CSS / React / AI / OCR / PDF. Engine consumes KnowledgePack only.
 */
(function (global) {
  'use strict';

  const FTEngine = (global.FTEngine = global.FTEngine || {});

  const SCHEMA_VERSION = 1;
  const DIFFICULTY_MIN = 1;
  const DIFFICULTY_MAX = 5;

  /** Split an answer string into atoms: whitespace splits first, then operators. */
  function tokenize(text) {
    if (typeof text !== 'string') return [];
    const parts = String(text)
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out = [];
    for (const part of parts) {
      // split operator characters into their own tokens
      const atoms = part.split(/([=+\-×÷·/^√()\[\]{}<>≤≥≈±~])/).filter(Boolean);
      for (const a of atoms) {
        const t = a.trim();
        if (t) out.push(t);
      }
    }
    return out;
  }

  /** Normalize free text for forgiving comparison (reverse mode). */
  function normalizeText(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\s\u200b]+/g, ' ')
      .replace(/[.,;:!?()\[\]{}"'`“”‘’]/g, '')
      .trim();
  }

  /**
   * Split the RIGHT side of a formula ("2sin(A)cos(A)") into buildable parts:
   *  - split at top-level + − / · × (operator kept as its own part),
   *  - leading operator folds into the next part,
   *  - split implicit multiplication ("2sin(A)cos(A)" -> ["2sin(A)","cos(A)"]).
   * Used by pack compilers (Python generator + in-app Builder).
   */
  function splitRhs(rhs) {
    const s = String(rhs == null ? '' : rhs).trim();
    if (!s) return [];
    const OP = new Set(['+', '-', '/', '·', '×', '−']);
    const isOp = (t) => OP.has(t);

    // 1) top-level split (paren depth 0), keeping operators as own parts
    const segs = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && isOp(ch)) {
        if (cur.trim()) segs.push(cur.trim());
        segs.push(ch === '-' ? '−' : ch);
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) segs.push(cur.trim());

    // 2) fold a leading operator into the following part
    const folded = [];
    for (let i = 0; i < segs.length; i++) {
      if (i === 0 && isOp(segs[i]) && segs[i + 1] !== undefined) {
        folded.push(segs[i] + segs[i + 1]);
        i++;
      } else {
        folded.push(segs[i]);
      }
    }

    // 3) split implicit multiplication: ")" directly followed by a token start
    const out = [];
    const TOKEN_START = /[A-Za-z0-9(√πθ]/;
    for (const seg of folded) {
      if (isOp(seg)) { out.push(seg); continue; }
      let chunk = '';
      for (let i = 0; i < seg.length; i++) {
        const ch = seg[i];
        const next = seg[i + 1];
        chunk += ch;
        if (ch === ')' && next && TOKEN_START.test(next)) {
          out.push(chunk);
          chunk = '';
        }
      }
      if (chunk) out.push(chunk);
    }
    return out;
  }

  /** Derive the left side of a formula prompt ("sin(2A) = ?" -> "sin(2A)"). */
  function lhsOfPrompt(prompt) {
    return String(prompt || '').split('=')[0].trim();
  }

  /** Derive the full formula from prompt + parts ("sin(2A) = ?" + [2sin(A)cos(A)]). */
  function fullFormulaOf(prompt, parts) {
    const lhs = String(prompt || '').replace(/=\s*\?\s*$/, '=').trim();
    return (lhs + ' ' + parts.join(' ')).replace(/\s+/g, ' ').trim();
  }

  /**
   * Split a formula's right side into CONTENT parts (to be picked by the user)
   * and a STRUCTURE template (pre-provided: "/" fraction bars, grouping
   * parentheses, and radical prefixes "√"/"±√" whose paren group is the
   * radicand). Operators (+/−) stay in content — the user picks them.
   * Returns { structure: ['±√','(','(','@',...], ... }, parts: [...] }.
   * Used by pack compilers (Python generator + in-app Builder).
   */
  function decomposeRhs(rhs) {
    const parts = [];
    const structure = [];
    (function walk(list) {
      for (const p of list) {
        if (p === '/') {
          structure.push('/');
        } else if (p.charAt(0) === '(' && p.charAt(p.length - 1) === ')') {
          structure.push('(');
          walk(splitRhs(p.slice(1, -1)));
          structure.push(')');
        } else {
          const radical = p.match(/^(±?√)(.*)$/);
          if (radical && radical[2].charAt(0) === '(' && radical[2].charAt(radical[2].length - 1) === ')') {
            structure.push(radical[1]); // '√' or '±√'
            structure.push('(');
            walk(splitRhs(radical[2].slice(1, -1)));
            structure.push(')');
          } else {
            structure.push('@');
            parts.push(p);
          }
        }
      }
    })(splitRhs(rhs));
    return { structure, parts };
  }

  /** Rebuild the full formula from prompt + structure template + content parts. */
  function fullFormulaFromStructure(prompt, structure, parts) {
    let i = 0;
    const body = structure.map((s) => (s === '@' ? parts[i++] : s)).join(' ');
    const lhs = String(prompt || '').replace(/=\s*\?\s*$/, '=').trim();
    return (lhs + ' ' + body).replace(/\s+/g, ' ').trim();
  }

  function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
  }

  function isValidDifficulty(d) {
    return Number.isInteger(d) && d >= DIFFICULTY_MIN && d <= DIFFICULTY_MAX;
  }

  /** Normalize an item's optional metadata with defaults. */
  function normalizeItemMetadata(md) {
    md = md || {};
    return {
      difficulty: isValidDifficulty(md.difficulty) ? md.difficulty : 1,
      tags: Array.isArray(md.tags) ? md.tags.filter(isNonEmptyString) : [],
      chapter: isNonEmptyString(md.chapter) ? md.chapter.trim() : '',
    };
  }

  /** Validate a raw imported object as a KnowledgePack. Returns {ok, errors, warnings}. */
  function validatePack(obj) {
    const errors = [];
    const warnings = [];

    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, errors: ['ไฟล์ไม่ใช่ Knowledge Pack (ต้องเป็น JSON object)'], warnings };
    }
    if (typeof obj.metadata !== 'object' || obj.metadata === null) {
      errors.push('metadata: หายไปหรือไม่ใช่ object');
    } else {
      const m = obj.metadata;
      if (!isNonEmptyString(m.id)) errors.push('metadata.id: ต้องเป็น string ที่ไม่ว่าง');
      if (!isNonEmptyString(m.name)) errors.push('metadata.name: ต้องเป็น string ที่ไม่ว่าง');
      if (!isNonEmptyString(m.version)) errors.push('metadata.version: ต้องเป็น string ที่ไม่ว่าง');
      if (!isNonEmptyString(m.subject)) errors.push('metadata.subject: ต้องเป็น string ที่ไม่ว่าง');
      if (m.description !== undefined && !isNonEmptyString(m.description)) {
        warnings.push('metadata.description: ไม่ใช่ string — จะใช้ค่าว่าง');
      }
      if (m.author !== undefined && !isNonEmptyString(m.author)) {
        warnings.push('metadata.author: ไม่ใช่ string — จะใช้ค่าว่าง');
      }
      if (m.schemaVersion === undefined || m.schemaVersion === null) {
        errors.push('metadata.schemaVersion: หายไป (ต้องเป็น ' + SCHEMA_VERSION + ')');
      } else if (typeof m.schemaVersion !== 'number') {
        errors.push('metadata.schemaVersion: ต้องเป็นตัวเลข');
      } else if (m.schemaVersion !== SCHEMA_VERSION) {
        errors.push(
          'metadata.schemaVersion: ' + m.schemaVersion + ' ไม่รองรับ (รองรับแค่ ' + SCHEMA_VERSION + ')'
        );
      }
    }

    if (!Array.isArray(obj.items)) {
      errors.push('items: หายไปหรือไม่ใช่ array');
    } else if (obj.items.length === 0) {
      errors.push('items: pack ต้องมีอย่างน้อย 1 item');
    } else {
      const seenIds = new Set();
      obj.items.forEach((it, i) => {
        const where = 'items[' + i + ']';
        if (it === null || typeof it !== 'object' || Array.isArray(it)) {
          errors.push(where + ': ไม่ใช่ object');
          return;
        }
        if (!isNonEmptyString(it.id)) errors.push(where + '.id: ต้องเป็น string ที่ไม่ว่าง');
        else if (seenIds.has(it.id)) errors.push(where + '.id: ซ้ำกัน ("' + it.id + '") ภายใน pack');
        else seenIds.add(it.id);

        if (!isNonEmptyString(it.prompt)) errors.push(where + '.prompt: ต้องเป็น string ที่ไม่ว่าง');

        if (!Array.isArray(it.answerTokens) || it.answerTokens.length === 0) {
          errors.push(where + '.answerTokens: ต้องเป็น array ที่ไม่ว่าง');
        } else if (!it.answerTokens.every((t) => isNonEmptyString(t))) {
          errors.push(where + '.answerTokens: มี token ที่ว่างหรือไม่ใช่ string');
        }

        if (!Array.isArray(it.availableTokens) || it.availableTokens.length === 0) {
          errors.push(where + '.availableTokens: ต้องเป็น array ที่ไม่ว่าง');
        } else if (!it.availableTokens.every((t) => isNonEmptyString(t))) {
          errors.push(where + '.availableTokens: มี token ที่ว่างหรือไม่ใช่ string');
        }

        // Invalid token: every answerToken must be present in availableTokens
        if (Array.isArray(it.answerTokens) && Array.isArray(it.availableTokens)) {
          const pool = new Set(it.availableTokens);
          const missing = it.answerTokens.filter((t) => !pool.has(t));
          if (missing.length > 0) {
            errors.push(
              where + '.availableTokens: token ของคำตอบไม่อยู่ในชุด (' + missing.join(', ') + ')'
            );
          }
        }

        if (it.metadata !== undefined && it.metadata !== null) {
          if (typeof it.metadata !== 'object') {
            errors.push(where + '.metadata: ต้องเป็น object');
          } else {
            const md = it.metadata;
            if (md.difficulty !== undefined && !isValidDifficulty(md.difficulty)) {
              errors.push(
                where + '.metadata.difficulty: ต้องเป็นจำนวนเต็ม 1–' + DIFFICULTY_MAX +
                  ' (ได้ "' + md.difficulty + '")'
              );
            }
            if (md.tags !== undefined && !Array.isArray(md.tags)) {
              errors.push(where + '.metadata.tags: ต้องเป็น array');
            }
            if (md.chapter !== undefined && !isNonEmptyString(md.chapter)) {
              warnings.push(where + '.metadata.chapter: ไม่ใช่ string — จะใช้ค่าว่าง');
            }
          }
        }

        // optional structure template (extension): '@' slots must match answerTokens count
        if (it.structure !== undefined && it.structure !== null) {
          if (!Array.isArray(it.structure) || !it.structure.every((s) => s === '@' || isNonEmptyString(s))) {
            errors.push(where + '.structure: ต้องเป็น array ของ "@" หรือ string');
          } else if (Array.isArray(it.answerTokens)) {
            const slots = it.structure.filter((s) => s === '@').length;
            if (slots !== it.answerTokens.length) {
              errors.push(
                where + '.structure: จำนวนช่อง (' + slots + ') ไม่ตรงกับ answerTokens (' + it.answerTokens.length + ')'
              );
            }
          }
        }
      });
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  /** Normalize a valid pack (fills defaults; assumes validatePack passed). */
  function normalizePack(obj) {
    const metadata = {
      id: String(obj.metadata.id),
      name: String(obj.metadata.name),
      version: String(obj.metadata.version),
      author: isNonEmptyString(obj.metadata.author) ? String(obj.metadata.author) : '',
      description: isNonEmptyString(obj.metadata.description) ? String(obj.metadata.description) : '',
      subject: String(obj.metadata.subject),
      schemaVersion: SCHEMA_VERSION,
    };
    const items = obj.items.map((it) => ({
      id: String(it.id),
      prompt: String(it.prompt),
      answerTokens: it.answerTokens.map(String),
      availableTokens: it.availableTokens.map(String),
      metadata: normalizeItemMetadata(it.metadata),
      ...(Array.isArray(it.structure) ? { structure: it.structure.map(String) } : {}),
    }));
    return { metadata, items };
  }

  /** Deterministic slug for generated pack ids. */
  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9\u0e00-\u0e7f]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'pack';
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function deepClone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  FTEngine.SCHEMA_VERSION = SCHEMA_VERSION;
  FTEngine.tokenize = tokenize;
  FTEngine.normalizeText = normalizeText;
  FTEngine.splitRhs = splitRhs;
  FTEngine.lhsOfPrompt = lhsOfPrompt;
  FTEngine.fullFormulaOf = fullFormulaOf;
  FTEngine.decomposeRhs = decomposeRhs;
  FTEngine.fullFormulaFromStructure = fullFormulaFromStructure;
  FTEngine.validatePack = validatePack;
  FTEngine.normalizePack = normalizePack;
  FTEngine.slugify = slugify;
  FTEngine.uid = uid;
  FTEngine.deepClone = deepClone;
  FTEngine.isNonEmptyString = isNonEmptyString;
  FTEngine.isValidDifficulty = isValidDifficulty;
})(typeof window !== 'undefined' ? window : globalThis);
