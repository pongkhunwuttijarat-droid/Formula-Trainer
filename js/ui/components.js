/**
 * UI components — DOM helpers, toast, modal, formatters.
 * The only layer allowed to touch the DOM.
 */
(function (global) {
  'use strict';
  const FTUI = (global.FTUI = global.FTUI || {});

  /** Hyperscript-lite: el('button', {class:'btn', onclick}, 'text') */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2), v);
        } else if (k === 'checked' || k === 'disabled' || k === 'selected') {
          if (v) node.setAttribute(k, '');
        } else if (k === 'value') node.value = v;
        else node.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(c));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Append a node, an array of nodes, or a function returning either. */
  function appendAll(parent, content) {
    const c = typeof content === 'function' ? content() : content;
    if (Array.isArray(c)) {
      for (const n of c) if (n) parent.append(n);
    } else if (c) {
      parent.append(c);
    }
  }

  // ---------- toast ----------
  const zone = () => document.getElementById('toast-zone');

  function toast(msg, type) {
    const t = el('div', { class: 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '') , role: 'status' }, msg);
    zone().append(t);
    setTimeout(() => t.remove(), 3600);
  }

  // ---------- modal ----------
  function openModal({ title, body, foot, onClose }) {
    const root = document.getElementById('modal-root');
    const backdrop = el('div', {
      class: 'modal-backdrop',
      onclick: (e) => { if (e.target === backdrop) close(); },
    });
    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const head = el('div', { class: 'modal-head' },
      el('h3', null, title),
      el('button', { class: 'btn btn-sm btn-ghost', 'aria-label': 'ปิด', onclick: close }, '✕')
    );
    const bodyNode = el('div', { class: 'modal-body' });
    appendAll(bodyNode, body);
    const footNode = el('div', { class: 'modal-foot' });
    if (foot) appendAll(footNode, foot);

    modal.append(head, bodyNode, footNode);
    backdrop.append(modal);
    root.append(backdrop);

    const prevFocus = document.activeElement;
    modal.querySelector('button, input, select, textarea')?.focus();

    function close() {
      backdrop.remove();
      onClose && onClose();
      prevFocus && prevFocus.focus();
    }
    return { close, body: bodyNode };
  }

  function confirmDialog({ title, message, confirmText = 'ยืนยัน', danger = false, onConfirm }) {
    openModal({
      title,
      body: el('p', null, message),
      foot: [
        el('button', { class: 'btn', onclick: (e) => e.target.closest('.modal-backdrop').remove() }, 'ยกเลิก'),
        el('button', {
          class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'),
          onclick: (e) => {
            e.target.closest('.modal-backdrop').remove();
            onConfirm && onConfirm();
          },
        }, confirmText),
      ],
    });
  }

  // ---------- formula renderer (fraction + radical aware) ----------
  /**
   * Render the right side of a formula from its structure template + parts.
   * Structure vocabulary:
   *   '@'  = content slot (parts[i] in order)
   *   '/'  = fraction bar (num/den stacked) at the current level
   *   '(' ')' = grouping parens
   *   '√' / '±√' = radical whose following paren group is the radicand;
   *                the radical bar covers the whole radicand
   * opts: { slots: bool (interactive dashed slots), filled: (i)=>val, onRemove: (i)=>void }
   */
  function renderRhs(structure, parts, opts) {
    opts = opts || {};
    parts = parts || [];
    const wrap = el('span', { class: 'formula-rhs' });
    let pi = 0;

    if (!structure) {
      // plain token list (old-style items): each part in order
      parts.forEach((p, i) => {
        if (opts.slots) {
          const val = opts.filled ? opts.filled(i) : undefined;
          if (val !== undefined) {
            const chip = el('span', { class: 'slot filled', role: 'button', tabindex: '0', title: 'ลบ', 'aria-label': 'ลบ ' + val }, val);
            if (opts.onRemove) chip.addEventListener('click', () => opts.onRemove(i));
            wrap.append(chip);
          } else {
            wrap.append(el('span', { class: 'slot' }));
          }
        } else {
          wrap.append(el('span', { class: 'formula-part' }, p));
        }
      });
      return wrap;
    }

    // ---- parse the flat structure into a node tree ----
    let si = 0;
    function parseNodes() {
      const out = [];
      while (si < structure.length) {
        const s = structure[si];
        if (s === ')') { si++; return out; }
        if (s === '/') { si++; out.push({ type: 'op', value: '/' }); }
        else if (s === '(') { si++; out.push({ type: 'group', nodes: parseNodes() }); }
        else if (s === '√' || s === '±√') { si++; out.push({ type: 'rad', prefix: s, content: parseNodes() }); }
        else if (s === '@') { si++; out.push({ type: 'part', index: pi++ }); }
        else { si++; out.push({ type: 'text', value: s }); }
      }
      return out;
    }

    /** Group a node list at a '/' into a stacked fraction (one level deep). */
    function groupFractions(nodes) {
      const segs = [[]];
      for (const n of nodes) {
        if (n.type === 'op' && n.value === '/') segs.push([]);
        else segs[segs.length - 1].push(n);
      }
      if (segs.length === 2) {
        const unwrap = (seg) => (seg.length === 1 && seg[0].type === 'group') ? seg[0].nodes : seg;
        return [{ type: 'frac', num: unwrap(segs[0]), den: unwrap(segs[1]) }];
      }
      return nodes; // no '/' at this level: render as-is
    }

    function renderPart(idx, parent) {
      if (opts.slots) {
        const val = opts.filled ? opts.filled(idx) : undefined;
        if (val !== undefined) {
          const chip = el('span', { class: 'slot filled', role: 'button', tabindex: '0', title: 'ลบ', 'aria-label': 'ลบ ' + val }, val);
          if (opts.onRemove) {
            chip.addEventListener('click', () => opts.onRemove(idx));
            chip.addEventListener('keydown', (e) => { if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); opts.onRemove(idx); } });
          }
          parent.append(chip);
        } else {
          parent.append(el('span', { class: 'slot' }));
        }
      } else {
        // fraction-aware part rendering (e.g. 2sin((A+B)/2) -> 2sin( A+B / 2 ))
        const p = el('span', { class: 'formula-part' });
        renderLhs(parts[idx], p);
        parent.append(p);
      }
    }

    function renderNodes(nodes, parent) {
      for (const n of groupFractions(nodes)) {
        if (n.type === 'part') renderPart(n.index, parent);
        else if (n.type === 'text' || n.type === 'op') parent.append(el('span', { class: 'struct-chip' }, n.value));
        else if (n.type === 'group') {
          parent.append(el('span', { class: 'struct-chip' }, '('));
          renderNodes(n.nodes, parent);
          parent.append(el('span', { class: 'struct-chip' }, ')'));
        } else if (n.type === 'frac') {
          const frac = el('span', { class: 'frac' },
            el('span', { class: 'frac-num' }), el('span', { class: 'frac-den' }));
          renderNodes(n.num, frac.querySelector('.frac-num'));
          renderNodes(n.den, frac.querySelector('.frac-den'));
          parent.append(frac);
        } else if (n.type === 'rad') {
          const rad = el('span', { class: 'rad' });
          rad.append(el('span', { class: 'rad-prefix' }, n.prefix));
          const body = el('span', { class: 'rad-body' });
          // the bar covers the whole radicand — drop redundant parens inside the root
          const content = (n.content.length === 1 && n.content[0].type === 'group') ? n.content[0].nodes : n.content;
          renderNodes(content, body);
          rad.append(body);
          parent.append(rad);
        }
      }
    }

    renderNodes(parseNodes(), wrap);
    return wrap;
  }

  /**
   * Render the LEFT side of a formula (e.g. "cos(A/2)", "2sin((A+B)/2)…").
   * Function-argument fractions ("A/2" inside cos(...)) render stacked.
   */
  function renderLhs(lhs, parent) {
    function splitTopSlash(s) {
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === '/' && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
      }
      return null;
    }
    function stripOuterGroup(s) {
      if (s.charAt(0) !== '(' || s.charAt(s.length - 1) !== ')') return s;
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; if (depth === 0 && i < s.length - 1) return s; }
      }
      return depth === 0 ? s.slice(1, -1) : s;
    }
    function renderSeg(text, target) {
      let j = 0;
      while (j < text.length) {
        if (text[j] === '(') {
          let depth = 1;
          let k = j + 1;
          for (; k < text.length; k++) {
            if (text[k] === '(') depth++;
            else if (text[k] === ')') { depth--; if (depth === 0) break; }
          }
          const inner = text.slice(j + 1, k);
          const fracParts = splitTopSlash(inner);
          if (fracParts) {
            const frac = el('span', { class: 'frac lhs-frac' },
              el('span', { class: 'frac-num' }), el('span', { class: 'frac-den' }));
            renderSeg(stripOuterGroup(fracParts[0]), frac.querySelector('.frac-num'));
            renderSeg(stripOuterGroup(fracParts[1]), frac.querySelector('.frac-den'));
            target.append(frac);
          } else {
            target.append(el('span', { class: 'struct-chip' }, '('));
            renderSeg(inner, target);
            target.append(el('span', { class: 'struct-chip' }, ')'));
          }
          j = k + 1;
        } else {
          let k = j;
          while (k < text.length && text[k] !== '(') k++;
          target.append(el('span', { class: 'lhs-text' }, text.slice(j, k)));
          j = k;
        }
      }
    }
    renderSeg(lhs, parent);
  }

  /** Full formula: LHS (fraction-aware) + "=" + RHS (structure-aware). */
  function renderFormulaFull(prompt, structure, parts, opts) {
    const wrap = el('span', { class: 'formula' });
    const lhs = el('span', { class: 'lhs-part' });
    renderLhs(FTEngine.lhsOfPrompt(prompt), lhs);
    wrap.append(lhs);
    wrap.append(el('span', { class: 'struct-chip' }, '='));
    wrap.append(renderRhs(structure, parts, opts));
    return wrap;
  }
  function fmtTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' วินาที';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' นาที ' + (s % 60) + ' วินาที';
    return Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' นาที';
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }

  function fmtPct(n) {
    return (Number.isFinite(n) ? n : 0) + '%';
  }

  function difficultyBadge(d) {
    return el('span', { class: 'badge badge-diff-' + d }, 'ระดับ ' + d);
  }

  function masteryBadge(level) {
    const labels = FTEngine.stats.MASTERY_LABELS;
    return el('span', { class: 'badge badge-mastery mastery-' + level }, labels[level] || level);
  }

  function masteryProgress(packId) {
    const packs = FTEngine.storage.listPacks();
    const p = packs.find((x) => x.metadata.id === packId);
    if (!p) return null;
    const prog = FTEngine.storage.getProgress(packId);
    let mastered = 0;
    for (const id in prog) if (FTEngine.stats.masteryOf(prog[id]) === 'mastered') mastered++;
    const pct = p.itemCount ? Math.round((mastered / p.itemCount) * 100) : 0;
    return { mastered, total: p.itemCount, pct };
  }

  /** Render a mastery progress row (label + bar). */
  function masteryBarRow(packId) {
    const m = masteryProgress(packId);
    if (!m) return null;
    return el('div', { class: 'progress-row', style: 'display:flex;align-items:center;gap:10px;' },
      el('span', { style: 'font-size:0.8rem;color:var(--muted);white-space:nowrap;' }, 'Mastery ' + m.mastered + '/' + m.total),
      el('div', { class: 'progress progress-sm', style: 'flex:1;', role: 'progressbar', 'aria-label': 'ความเชี่ยวชาญ', 'aria-valuenow': m.pct, 'aria-valuemin': '0', 'aria-valuemax': '100' },
        el('span', { style: 'width:' + m.pct + '%' })
      )
    );
  }

  function emptyState(title, sub, action) {
    return el('div', { class: 'empty' },
      el('h3', null, title),
      el('p', null, sub),
      action ? el('div', { style: 'margin-top:14px' }, action) : null
    );
  }

  /** Generic card grid for packs. */
  function packCard(p, { onPlay, onPreview, onExport, onDelete }) {
    const m = p.metadata;
    const prog = masteryProgress(p.metadata.id);
    const card = el('div', { class: 'card card-hover', style: 'display:flex;flex-direction:column;gap:10px;' },
      el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start;' },
        el('h3', { style: 'margin:0;font-size:1.02rem;' }, m.name),
        el('span', { class: 'badge badge-subject' }, m.subject)
      ),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
        el('span', { class: 'badge' }, 'v' + m.version),
        el('span', { class: 'badge' }, p.itemCount + ' ข้อ'),
        m.author ? el('span', { class: 'badge' }, m.author) : null
      ),
      m.description ? el('p', { style: 'margin:0;font-size:0.88rem;color:var(--muted);' }, m.description) : null,
      prog ? el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Mastery', 'aria-valuenow': prog.pct, 'aria-valuemin': '0', 'aria-valuemax': '100' },
        el('span', { style: 'width:' + prog.pct + '%' })
      ) : null,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;' },
        el('button', { class: 'btn btn-primary btn-sm', onclick: onPlay }, 'เล่น'),
        el('button', { class: 'btn btn-sm', onclick: onPreview }, 'พรีวิว'),
        el('button', { class: 'btn btn-sm', onclick: onExport, 'aria-label': 'ส่งออก ' + m.name }, 'ส่งออก'),
        el('button', { class: 'btn btn-sm btn-danger', onclick: onDelete, 'aria-label': 'ลบ ' + m.name }, 'ลบ')
      )
    );
    return card;
  }

  FTUI.el = el;
  FTUI.clear = clear;
  FTUI.appendAll = appendAll;
  FTUI.toast = toast;
  FTUI.openModal = openModal;
  FTUI.confirmDialog = confirmDialog;
  FTUI.renderRhs = renderRhs;
  FTUI.renderLhs = renderLhs;
  FTUI.renderFormulaFull = renderFormulaFull;
  FTUI.fmtTime = fmtTime;
  FTUI.fmtDate = fmtDate;
  FTUI.fmtPct = fmtPct;
  FTUI.difficultyBadge = difficultyBadge;
  FTUI.masteryBadge = masteryBadge;
  FTUI.masteryProgress = masteryProgress;
  FTUI.masteryBarRow = masteryBarRow;
  FTUI.emptyState = emptyState;
  FTUI.packCard = packCard;
})(window);
