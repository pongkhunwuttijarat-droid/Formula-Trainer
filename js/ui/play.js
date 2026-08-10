/**
 * Play page — pack/mode setup, game view, results.
 * Layout: question/structure (โครง) on the LEFT, interaction on the RIGHT.
 * Session ops: pause / resume / restart / retry wrong / shuffle.
 */
(function (global) {
  'use strict';
  const FTUI = (global.FTUI = global.FTUI || {});
  const { el, clear, toast, openModal, confirmDialog, fmtTime, fmtPct, difficultyBadge, emptyState } = FTUI;

  let gameState = null; // { session, pack, mode }

  // ---------- setup ----------
  function setup(root) {
    clear(root);
    const restored = FTEngine.session.restoreActiveSession();
    if (restored) {
      root.append(
        el('div', { class: 'banner', role: 'status' },
          el('span', { class: 'banner-text' },
            'มี session ค้างอยู่: ' + restored.session.packName + ' · ' + restored.session.modeName +
            ' (ตอบแล้ว ' + restored.session.stats.attempts + ' ข้อ)'
          ),
          el('button', { class: 'btn btn-primary btn-sm', onclick: () => startGame(restored.pack, restored.session.modeId, restored.session) }, 'ดำเนินต่อ'),
          el('button', { class: 'btn btn-sm', onclick: () => {
            FTEngine.session.quitSession(restored.session);
            FTUI.sessionIndicatorRefresh();
            setup(root);
          } }, 'ยกเลิก session')
        )
      );
    }

    root.append(el('h1', { class: 'page-title' }, 'เล่น'));
    root.append(el('p', { class: 'page-sub' }, 'เลือกแพ็ค → เลือกโหมด → เริ่มเลย'));

    const packs = FTEngine.storage.listPacks();
    if (packs.length === 0) {
      root.append(emptyState('ยังไม่มีแพ็ค', 'ไปที่หน้าแพ็คเพื่อติดตั้งแพ็คตัวอย่าง หรือ Import Knowledge Pack',
        el('button', { class: 'btn btn-primary', onclick: () => FTUI.router.navigate('packs') }, 'ไปหน้าแพ็ค')));
      return;
    }

    const subjects = ['', ...new Set(packs.map((p) => p.metadata.subject))];
    const listEl = el('div', { class: 'card-grid', role: 'listbox', 'aria-label': 'แพ็คที่ติดตั้ง' });

    function renderPacks(query, subject) {
      const q = (query || '').trim();
      const filtered = FTEngine.search.searchPacks(q, subject ? { subject } : {});
      clear(listEl);
      if (filtered.length === 0) {
        listEl.append(emptyState('ไม่พบแพ็ค', 'ลองเปลี่ยนคำค้นหรือตัวกรอง'));
        return;
      }
      for (const p of filtered) {
        listEl.append(
          el('div', { class: 'card card-hover', role: 'option', tabindex: '0',
              onclick: () => selectPack(p.metadata.id), onkeydown: (e) => { if (e.key === 'Enter') selectPack(p.metadata.id); } },
            el('div', { style: 'display:flex;justify-content:space-between;gap:8px;' },
              el('h3', { style: 'margin:0 0 4px;font-size:1.02rem;' }, p.metadata.name),
              el('span', { class: 'badge badge-subject' }, p.metadata.subject)
            ),
            el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;' },
              el('span', { class: 'badge' }, 'v' + p.metadata.version),
              el('span', { class: 'badge' }, p.itemCount + ' ข้อ')
            ),
            FTUI.masteryBarRow(p.metadata.id)
          )
        );
      }
    }

    const searchInput = el('input', { type: 'search', placeholder: 'ค้นหาแพ็ค…', 'aria-label': 'ค้นหาแพ็ค',
      oninput: (e) => renderPacks(e.target.value, subjectSel.value) });
    const subjectSel = el('select', { 'aria-label': 'กรองตามวิชา', onchange: () => renderPacks(searchInput.value, subjectSel.value) },
      el('option', { value: '' }, 'ทุกวิชา'),
      ...subjects.filter(Boolean).map((s) => el('option', { value: s }, s))
    );

    root.append(
      el('div', { class: 'search-row' }, searchInput, subjectSel),
      el('h2', { style: 'font-size:1.05rem;' }, 'เลือกแพ็ค'),
      listEl
    );

    renderPacks('', '');

    const configPanel = el('div', { style: 'margin-top:22px;' });
    root.append(configPanel);

    let selected = null; // {packId, modeId}

    function selectPack(packId) {
      selected = { packId, modeId: null };
      renderConfig();
    }

    function renderConfig() {
      clear(configPanel);
      if (!selected) return;
      const packMeta = FTEngine.storage.listPacks().find((p) => p.metadata.id === selected.packId);
      if (!packMeta) return;

      const pack = FTEngine.storage.getPack(selected.packId);
      configPanel.append(el('h2', { style: 'font-size:1.05rem;' }, 'โหมด: ' + packMeta.metadata.name));

      const modeGrid = el('div', { class: 'card-grid', style: 'grid-template-columns:repeat(auto-fit,minmax(200px,1fr));' });
      for (const mode of FTEngine.session.listModes()) {
        const card = el('div', { class: 'card mode-card', tabindex: '0', role: 'radio',
            'aria-checked': selected.modeId === mode.id ? 'true' : 'false',
            style: selected.modeId === mode.id ? 'border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);' : '',
            onclick: () => { selected.modeId = mode.id; renderConfig(); },
            onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { selected.modeId = mode.id; renderConfig(); } } },
          el('h3', null, mode.nameTh),
          el('p', null, mode.description)
        );
        modeGrid.append(card);
      }
      configPanel.append(modeGrid);

      if (selected.modeId) {
        const shuffleOn = el('input', { type: 'checkbox', id: 'opt-shuffle', checked: true });
        const opts = el('div', { class: 'card', style: 'margin-top:14px;display:flex;flex-direction:column;gap:12px;' },
          el('label', { style: 'display:flex;align-items:center;gap:10px;cursor:pointer;' },
            shuffleOn,
            el('span', null, 'สลับลำดับข้อ (Shuffle)')
          ),
          el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' },
            el('button', { class: 'btn btn-primary btn-lg', onclick: () => startGame(pack, selected.modeId, null, shuffleOn.checked) },
              'เริ่มเล่น ' + (FTEngine.session.getMode(selected.modeId)?.nameTh || '')),
            el('button', { class: 'btn btn-lg', onclick: () => { selected = null; renderConfig(); } }, 'ย้อนกลับ')
          )
        );
        configPanel.append(opts);
      }
    }
  }

  // ---------- game ----------
  function startGame(pack, modeId, existingSession, shuffle) {
    let session = existingSession;
    if (!session) {
      const r = FTEngine.session.createSession(pack, modeId, { shuffle });
      if (r.error) { toast(r.error, 'error'); return; }
      session = r.session;
    } else if (session.status === 'paused') {
      FTEngine.session.resumeSession(session);
    }
    gameState = { session, pack, mode: FTEngine.session.getMode(modeId) };
    FTUI.sessionIndicatorRefresh();
    FTUI.router.navigate('play');
  }

  function game(root) {
    clear(root);
    if (!gameState) {
      const restored = FTEngine.session.restoreActiveSession();
      if (restored) gameState = { session: restored.session, pack: restored.pack, mode: FTEngine.session.getMode(restored.session.modeId) };
    }
    if (!gameState || !gameState.session || gameState.session.status === 'finished') {
      setup(root);
      return;
    }

    const { session, pack, mode } = gameState;

    if (session.status === 'paused') {
      const over = el('div', { class: 'card', style: 'max-width:420px;margin:40px auto;text-align:center;' },
        el('h2', null, 'พักอยู่'),
        el('p', { style: 'color:var(--muted);' }, session.packName + ' · ' + session.modeName + ' · ตอบแล้ว ' + session.stats.attempts + ' ข้อ'),
        el('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;' },
          el('button', { class: 'btn btn-primary', onclick: () => { FTEngine.session.resumeSession(session); game(root); } }, 'เล่นต่อ'),
          el('button', { class: 'btn', onclick: () => { const r = FTEngine.session.restartSession(pack, session); gameState = { session: r.session, pack, mode }; game(root); } }, 'เริ่มใหม่'),
          el('button', { class: 'btn btn-danger', onclick: () => { FTEngine.session.quitSession(session); gameState = null; FTUI.sessionIndicatorRefresh(); setup(root); } }, 'ออก')
        )
      );
      root.append(over);
      return;
    }

    const shell = el('div', { class: 'game-shell' + (mode.input === 'match' ? ' game-shell--deck' : '') });
    root.append(shell);

    // progress header
    const progressWrap = el('div', { class: 'game-progress' },
      el('span', { style: 'font-size:0.85rem;font-weight:600;white-space:nowrap;', id: 'game-counter' }),
      el('div', { class: 'progress', 'aria-hidden': 'true' }, el('span', { id: 'game-bar' }))
    );
    const meta = el('div', { class: 'game-meta' },
      el('span', { class: 'badge', id: 'game-streak' }, 'สตรีค 0'),
      el('span', { class: 'badge', id: 'game-time' }, '0 วินาที'),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: pauseGame, 'aria-label': 'พักเกม' }, '⏸ พัก'),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: shuffleGame, 'aria-label': 'สับไพ่ข้อที่เหลือ' }, '⇄ สับ'),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: quitGame, 'aria-label': 'ออกจากเกม' }, '✕')
    );
    shell.append(el('div', { class: 'game-topbar' }, progressWrap, meta));

    // two panes: LEFT = question/structure, RIGHT = interaction
    const panes = el('div', { class: 'game-panes' });
    const leftPane = el('div', { class: 'game-left' });
    const rightPane = el('div', { class: 'game-right' });
    panes.append(leftPane, rightPane);
    shell.append(panes);

    const feedbackArea = el('div', { 'aria-live': 'polite' });
    shell.append(feedbackArea);

    let timer = null;
    let answered = false;
    const gstate = { built: [], refresh: null, textInput: null, options: null };
    // wall layout: permutation of option indices — swap/shuffle changes positions
    let wallOrder = null;

    // keyboard (attached once)
    shell.addEventListener('keydown', (e) => {
      if (mode.input === 'tokens' && e.key === 'Backspace') {
        gstate.built.pop();
        if (gstate.refresh) gstate.refresh();
        e.preventDefault();
      } else if (mode.input === 'match' && /^[1-4]$/.test(e.key)) {
        const o = gstate.options && gstate.options[Number(e.key) - 1];
        if (o) submitMatch(o.itemId);
      }
    });

    // ---------- renderers ----------
    function itemProgress() {
      if (mode.loop) return { done: session.completed.length, total: session.completed.length + session.queue.length };
      if (mode.multiSelect && mode.input === 'match') {
        // deck: progress = cards already flipped face-down (✓ or ✗) — index
        // is not linear because the group jumps between scattered members
        const countById = {};
        for (const c of session.completed) if (c.correct || c.revealed) countById[c.itemId] = true;
        const done = pack.items.filter((it) => countById[it.id]).length;
        return { done, total: pack.items.length };
      }
      return { done: session.index, total: session.queue.length };
    }

    // shared pool/submit refs so slot-removal can re-sync the right pane
    const rightRef = { pool: null, submitBtn: null };
    function syncPool(q) {
      if (!rightRef.pool) return;
      rightRef.pool.querySelectorAll('.token-btn').forEach((b) => {
        const remaining = q.tokens.filter((x) => x === b.dataset.token).length - gstate.built.filter((x) => x === b.dataset.token).length;
        b.disabled = remaining <= 0;
        b.classList.toggle('used', remaining <= 0);
        b.setAttribute('aria-disabled', remaining <= 0 ? 'true' : 'false');
      });
    }
    function updateSubmit(q) {
      if (!rightRef.submitBtn) return;
      const totalSlots = q.structure ? q.structure.filter((s) => s === '@').length : q.parts.length;
      rightRef.submitBtn.disabled = gstate.built.length !== totalSlots;
    }

    function render() {
      if (session.status === 'finished') { renderResults(); return; }
      const q = FTEngine.session.questionOf(session, pack);
      if (!q) { renderResults(); return; }

      const prog = itemProgress();
      document.getElementById('game-counter')?.replaceChildren((prog.done + 1) + ' / ' + prog.total);
      document.getElementById('game-bar')?.setAttribute('style', 'width:' + Math.round((prog.done / prog.total) * 100) + '%');
      document.getElementById('game-streak')?.replaceChildren('สตรีค ' + session.stats.correct);

      const item = pack.items.find((it) => it.id === session.currentItemId);
      gstate.built = [];
      gstate.textInput = null;
      gstate.options = q.options || null;
      answered = false;
      clear(leftPane);
      clear(rightPane);
      clear(feedbackArea);

      // ----- LEFT: question card -----
      const label = mode.input === 'match'
        ? 'โจทย์ฝั่งซ้าย — เลือกการ์ด (ฝั่งขวาของสูตร) ที่ตรงกันจากกอง'
        : mode.input === 'text'
          ? 'ผลลัพธ์ฝั่งขวา — พิมพ์โครง (ฝั่งซ้ายของสมการ) ที่ตรงกัน'
          : 'โครง — แตะส่วนประกอบฝั่งขวาเติมให้เต็ม';
      const card = el('div', { class: 'question-card' },
        el('div', { class: 'question-label' }, label),
        el('div', { class: 'question-meta', style: 'margin-top:8px;' },
          item ? difficultyBadge(item.metadata.difficulty) : null,
          item && item.metadata.chapter ? el('span', { class: 'badge' }, item.metadata.chapter) : null,
          el('span', { class: 'badge' }, session.modeName)
        )
      );

      const dynArea = el('div', { class: 'skeleton-area' });
      gstate.refresh = () => {
        clear(dynArea);
        if (mode.input === 'tokens') {
          dynArea.append(FTUI.renderFormulaFull(q.prompt, q.structure, q.parts, {
            slots: true,
            filled: (i) => gstate.built[i],
            onRemove: (i) => { gstate.built.splice(i, 1); gstate.refresh(); syncPool(q); updateSubmit(q); },
          }));
        } else if (mode.input === 'match') {
          // deck: question is the LHS only — no structure skeleton (that's construction's job)
          const lhs = el('span', { class: 'lhs-part' });
          FTUI.renderLhs(FTEngine.lhsOfPrompt(q.prompt), lhs);
          dynArea.append(el('div', { class: 'question-text formula' },
            lhs, el('span', { class: 'struct-chip' }, '= ?')));
        } else {
          dynArea.append(el('div', { class: 'question-text formula' }, FTUI.renderRhs(q.structure, q.parts)));
        }
      };
      card.append(dynArea);
      if (mode.input === 'match' && q.groupIds && q.groupIds.length > 1) {
        const doneInGroup = q.groupIds.filter((gid) => {
          const opt = q.options.find((o) => o.itemId === gid);
          return !!opt && opt.verdict === 'correct';
        }).length;
        const hint = 'ชุดนี้มี ' + q.groupIds.length + ' ใบที่เท่ากัน — เลือกให้ครบ (เหลือ ' + (q.groupIds.length - doneInGroup) + ' ใบ)';
        card.append(el('div', { class: 'group-hint' },
          q.attemptsLeft !== undefined ? hint + ' · กดได้อีก ' + q.attemptsLeft + ' ครั้ง' : hint));
      }
      leftPane.append(card);
      if (mode.input === 'match') wireDeckDropTarget(card);
      gstate.refresh();

      // ----- RIGHT: interaction per input type -----
      if (mode.input === 'tokens') renderTokenRight(q);
      else if (mode.input === 'text') renderTextRight();
      else if (mode.input === 'match') renderMatchRight(q);
    }

    function renderTokenRight(q) {
      const pool = el('div', { class: 'token-pool' });
      const seen = new Set();
      for (const t of q.tokens) {
        if (seen.has(t)) continue;
        seen.add(t);
        const btn = el('button', {
          class: 'token-btn', type: 'button', dataset: { token: t }, 'aria-label': 'โทเคน ' + t,
          onclick: () => { gstate.built.push(t); gstate.refresh(); syncPool(q); updateSubmit(q); },
        });
        const label = el('span', { class: 'token-label' });
        FTUI.renderLhs(t, label); // fraction-aware token display (e.g. 2sin((A+B)/2))
        btn.append(label);
        pool.append(btn);
      }
      const submitBtn = el('button', { class: 'btn btn-primary btn-lg', id: 'submit-btn', disabled: true, onclick: submit }, 'ตรวจคำตอบ');
      const actions = el('div', { class: 'game-actions' },
        el('button', { class: 'btn btn-ghost', onclick: () => { FTEngine.session.shuffleRemaining(session); render(); } }, 'สลับโทเคน'),
        submitBtn
      );
      rightPane.append(pool, actions);
      rightRef.pool = pool;
      rightRef.submitBtn = submitBtn;
      syncPool(q);
      updateSubmit(q);
    }

    function renderTextRight() {
      const input = el('input', { class: 'text-answer', type: 'text', autocomplete: 'off',
          placeholder: 'พิมพ์โครง (เช่น sin(2A))…', 'aria-label': 'พิมพ์คำตอบ',
          oninput: () => { submitBtn.disabled = input.value.trim() === ''; } });
      const submitBtn = el('button', { class: 'btn btn-primary btn-lg', id: 'submit-btn', disabled: true, onclick: submit }, 'ตรวจคำตอบ');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      rightPane.append(input, el('div', { class: 'game-actions' }, submitBtn));
      gstate.textInput = input;
      setTimeout(() => input.focus(), 0);
    }

    function renderMatchRight(q) {
      const grid = el('div', { class: 'match-wall' });
      const remaining = q.options.filter((o) => !o.verdict).length;
      if (!wallOrder || wallOrder.length !== q.options.length) {
        wallOrder = q.options.map((_, i) => i);
        if (session.shuffled) { // "สับ" at setup: random card positions too
          for (let i = wallOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = wallOrder[i]; wallOrder[i] = wallOrder[j]; wallOrder[j] = tmp;
          }
        }
      }
      for (const oi of wallOrder) {
        const o = q.options[oi];
        if (o.verdict) {
          // face-down card, stays at its original position; ✕ = revealed/missed, ✓ = matched
          const isWrong = o.verdict === 'wrong';
          grid.append(el('button', {
            class: 'match-card matched' + (isWrong ? ' matched-wrong' : ''),
            type: 'button', disabled: true, tabindex: '-1', draggable: 'false',
            'aria-label': isWrong ? 'ตอบผิด' : 'จับคู่แล้ว',
          }, el('span', { class: 'match-mark' }, isWrong ? '✕' : '✓')));
          continue;
        }
        const b = el('button', {
          class: 'match-card', type: 'button', dataset: { itemId: o.itemId }, 'aria-label': 'การ์ดสูตร ' + (oi + 1),
          draggable: 'true',
          onclick: () => submitMatch(o.itemId, b),
          ondragstart: (e) => {
            e.dataTransfer.setData('text/plain', o.itemId);
            e.dataTransfer.effectAllowed = 'move';
            b.classList.add('dragging');
          },
          ondragend: () => b.classList.remove('dragging'),
          // drop ON another card = swap their wall positions (สลับตำแหน่งการ์ด)
          ondragover: (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            b.classList.add('swap-target');
          },
          ondragleave: () => b.classList.remove('swap-target'),
          ondrop: (e) => {
            e.preventDefault();
            e.stopPropagation();
            b.classList.remove('swap-target');
            const srcId = e.dataTransfer && e.dataTransfer.getData('text/plain');
            if (srcId && srcId !== o.itemId) swapWallCards(srcId, o.itemId);
          },
        },
          el('span', { class: 'formula' }, FTUI.renderRhs(o.structure, o.parts))
        );
        grid.append(b);
      }
      const attemptsLabel = q.attemptsLeft !== undefined
        ? ' — เหลืออีก ' + q.attemptsLeft + ' ครั้ง'
        : '';
      rightPane.append(
        el('div', { class: 'match-tools' },
          el('div', { class: 'match-label' },
            'กองการ์ด — เลือกทุกใบที่เท่ากับโจทย์ฝั่งซ้าย (เหลือ ' + remaining + ' ใบ)' + attemptsLabel),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: shuffleWall },
            'สับตำแหน่งการ์ด')),
        el('div', { class: 'match-scroll' }, grid)
      );
    }

    /** Swap the wall positions of two cards (identified by item id). */
    function swapWallCards(idA, idB) {
      if (!wallOrder) return;
      const posA = wallOrder.findIndex((oi) => qOf(oi).itemId === idA);
      const posB = wallOrder.findIndex((oi) => qOf(oi).itemId === idB);
      if (posA === -1 || posB === -1 || posA === posB) return;
      const tmp = wallOrder[posA]; wallOrder[posA] = wallOrder[posB]; wallOrder[posB] = tmp;
      render();
    }
    function qOf(oi) {
      const qq = FTEngine.session.questionOf(session, pack);
      return qq.options[oi];
    }

    /** Randomize the wall positions of the playable cards (matched stay pinned). */
    function shuffleWall() {
      if (!wallOrder) return;
      const qq = FTEngine.session.questionOf(session, pack);
      const playable = [];
      wallOrder.forEach((oi, pos) => { if (!qq.options[oi].verdict) playable.push(pos); });
      if (playable.length < 2) return;
      const cards = playable.map((pos) => wallOrder[pos]);
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
      }
      playable.forEach((pos, i) => { wallOrder[pos] = cards[i]; });
      render();
    }

    // Deck DnD: the LEFT problem/target area accepts a dragged card. Native
    // HTML5 drag events, deck-only — construction/reverse never wire this up.
    function wireDeckDropTarget(target) {
      let depth = 0;
      target.addEventListener('dragenter', (e) => {
        e.preventDefault();
        depth += 1;
        target.classList.add('drop-target');
      });
      target.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      target.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) target.classList.remove('drop-target');
      });
      target.addEventListener('drop', (e) => {
        e.preventDefault();
        depth = 0;
        target.classList.remove('drop-target');
        const itemId = e.dataTransfer && e.dataTransfer.getData('text/plain');
        if (!itemId) return;
        // re-find the source card so the same visual feedback as clicking runs
        const btnEl = rightPane.querySelector('.match-card[data-item-id="' + itemId + '"]');
        submitMatch(itemId, btnEl);
      });
    }

    function submit() {
      if (answered) return;
      answered = true;
      let result;
      if (mode.input === 'tokens') result = FTEngine.session.answer(session, pack, gstate.built);
      else result = FTEngine.session.answer(session, pack, gstate.textInput ? gstate.textInput.value : '');
      if (result.error) { toast(result.error, 'error'); return; }
      FTUI.sessionIndicatorRefresh();
      renderFeedback(result);
    }

    function submitMatch(itemId, btnEl) {
      if (mode.multiSelect) {
        // multi-select (deck): keep matching until every equal card is picked.
        // Click budget = 2 × group size; every pick (right or wrong) spends
        // one. Correct pick flips ✓; when the budget runs out with correct
        // cards still unflipped, the group is revealed (✓ / ✗).
        const result = FTEngine.session.answer(session, pack, itemId);
        if (result.error) { toast(result.error, 'error'); return; }
        if (result.correct) {
          // correct pick -> flip face-down, no longer selectable
          if (btnEl) {
            btnEl.classList.add('matched');
            btnEl.disabled = true;
            btnEl.setAttribute('draggable', 'false');
            btnEl.classList.remove('dragging');
            btnEl.replaceChildren(el('span', { class: 'match-mark' }, '✓'));
            btnEl.setAttribute('aria-label', 'จับคู่แล้ว');
          }
          clear(feedbackArea);
          if (result.remaining > 0) {
            feedbackArea.append(el('div', { class: 'feedback feedback-correct', role: 'status' },
              '✓ ถูกต้อง! ชุดนี้เหลืออีก ' + result.remaining + ' ใบ — เหลืออีก ' + result.attemptsLeft + ' ครั้ง'));
          } else {
            feedbackArea.append(el('div', { class: 'feedback feedback-correct', role: 'status' },
              '✓ ครบทุกใบในชุดนี้!'));
            setTimeout(() => FTUI.router.render(), 500); // advance to the next question
          }
        } else if (result.revealed) {
          // budget exhausted with correct cards still unflipped -> REVEAL:
          // flip every missed-correct card ✗ (the engine already recorded them)
          rightPane.querySelectorAll('.match-card').forEach((b) => {
            if (b.dataset.itemId && b.dataset.itemId !== itemId && !b.disabled) {
              b.classList.add('matched', 'matched-wrong');
              b.disabled = true;
              b.setAttribute('draggable', 'false');
              b.replaceChildren(el('span', { class: 'match-mark' }, '✕'));
              b.setAttribute('aria-label', 'ตอบผิด');
            }
          });
          if (btnEl) {
            btnEl.classList.add('wrong');
            setTimeout(() => btnEl.classList.remove('wrong'), 700);
          }
          clear(feedbackArea);
          feedbackArea.append(el('div', { class: 'feedback feedback-wrong', role: 'status' },
            '✕ หมดโอกาส! เฉลย: ใบที่ถูกคว่ำ ✓, ใบที่พลาด ✗'));
          setTimeout(() => FTUI.router.render(), 1200); // show the reveal, then advance
        } else {
          // wrong pick, budget not exhausted -> flash red, question stays
          if (btnEl) {
            btnEl.classList.add('wrong');
            setTimeout(() => btnEl.classList.remove('wrong'), 700);
          }
          const cur = pack.items.find((i) => i.id === session.currentItemId);
          const lhs = cur ? FTEngine.lhsOfPrompt(cur.prompt) : '?';
          clear(feedbackArea);
          feedbackArea.append(el('div', { class: 'feedback feedback-wrong', role: 'status' },
            '✕ ผิด — ใบนี้ไม่ตรงกับ "' + lhs + '" (เหลืออีก ' + result.attemptsLeft + ' ครั้ง)'));
        }
        FTUI.sessionIndicatorRefresh();
        return;
      }
      if (answered) return;
      answered = true;
      const result = FTEngine.session.answer(session, pack, itemId);
      if (result.error) { toast(result.error, 'error'); return; }
      if (result.correct) {
        // flip the matched card face-down, keep its position
        btnEl.classList.add('matched');
        btnEl.disabled = true;
        btnEl.replaceChildren(el('span', { class: 'match-mark' }, '✓'));
        btnEl.setAttribute('aria-label', 'จับคู่แล้ว');
      } else {
        const correctId = result.item.id;
        rightPane.querySelectorAll('.match-card').forEach((b) => {
          b.disabled = true;
          if (b.dataset.itemId === itemId) b.classList.add('wrong');
          if (b.dataset.itemId === correctId) {
            // the correct card flips face-down with a red ✕ — answered wrong
            b.classList.add('matched', 'matched-wrong');
            b.disabled = true;
            b.replaceChildren(el('span', { class: 'match-mark' }, '✕'));
            b.setAttribute('aria-label', 'ตอบผิด');
          }
        });
      }
      FTUI.sessionIndicatorRefresh();
      renderFeedback(result);
    }

    function renderFeedback(result) {
      const item = result.item;
      clear(feedbackArea);
      const fb = el('div', { class: 'feedback ' + (result.correct ? 'feedback-correct' : 'feedback-wrong'), role: 'status' },
        result.correct ? '✓ ถูกต้อง!' : '✕ ผิด — เฉลย: ',
        result.correct ? null : el('span', { class: 'formula' }, FTUI.renderFormulaFull(item.prompt, item.structure, item.answerTokens))
      );
      feedbackArea.append(fb);
      rightPane.append(el('div', { class: 'game-actions' },
        el('button', { class: 'btn btn-primary btn-lg', onclick: next }, result.done ? 'ดูผลลัพธ์' : 'ข้อถัดไป')
      ));
      document.getElementById('submit-btn')?.setAttribute('disabled', '');
    }

    function next() {
      if (session.status === 'finished') renderResults();
      else render();
    }

    function renderResults() {
      clear(shell);
      shell.classList.remove('game-shell--deck'); // results page flows normally (not viewport-pinned)
      const acc = FTEngine.session.sessionAccuracy(session);
      const s = session.stats;
      const elapsed = FTEngine.session.sessionElapsed(session);
      shell.append(
        el('h1', { class: 'page-title', style: 'text-align:center;' }, 'จบเกม!'),
        el('p', { style: 'text-align:center;color:var(--muted);' }, session.packName + ' · ' + session.modeName),
        el('div', { class: 'results-grid' },
          el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, fmtPct(acc)), el('div', { class: 'stat-label' }, 'ความแม่นยำ')),
          el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value', style: 'color:var(--correct);' }, s.correct), el('div', { class: 'stat-label' }, 'ถูก')),
          el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value', style: 'color:var(--wrong);' }, s.wrong), el('div', { class: 'stat-label' }, 'ผิด')),
          el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, fmtTime(elapsed)), el('div', { class: 'stat-label' }, 'เวลา')),
          el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, s.attempts), el('div', { class: 'stat-label' }, 'จำนวนข้อ'))
        ),
        el('div', { class: 'results-actions' },
          session.wrongIds.length > 0
            ? el('button', { class: 'btn btn-primary btn-lg', onclick: () => {
                const r = FTEngine.session.retryWrongSession(pack, session);
                if (r.error) { toast(r.error, 'error'); return; }
                gameState = { session: r.session, pack, mode };
                game(root);
              } }, 'ฝึกข้อที่ผิด (' + session.wrongIds.length + ')')
            : null,
          el('button', { class: 'btn btn-lg', onclick: () => {
              const r = FTEngine.session.restartSession(pack, session);
              gameState = { session: r.session, pack, mode };
              game(root);
            } }, 'เล่นใหม่'),
          el('button', { class: 'btn btn-lg', onclick: () => { gameState = null; setup(root); } }, 'เลือกโหมดใหม่'),
          el('button', { class: 'btn btn-lg', onclick: () => { gameState = null; FTUI.router.navigate('stats'); } }, 'ดูสถิติ')
        )
      );
    }

    function pauseGame() {
      FTEngine.session.pauseSession(session);
      FTUI.sessionIndicatorRefresh();
      game(root);
    }

    function shuffleGame() {
      FTEngine.session.shuffleRemaining(session);
      toast('สับลำดับข้อที่เหลือแล้ว');
      render();
    }

    function quitGame() {
      confirmDialog({
        title: 'ออกจากเกม?',
        message: 'ความคืบหน้า session นี้จะถูกบันทึกไว้และเล่นต่อได้ภายหลัง',
        confirmText: 'ออก (บันทึก)',
        onConfirm: () => {
          FTEngine.session.pauseSession(session);
          gameState = null;
          FTUI.sessionIndicatorRefresh();
          setup(root);
        },
      });
    }

    render();

    const timeEl = document.getElementById('game-time');
    timer = setInterval(() => {
      if (timeEl) timeEl.replaceChildren(fmtTime(FTEngine.session.sessionElapsed(session)));
    }, 1000);

    return () => { if (timer) clearInterval(timer); };
  }

  function itemOf(pack, itemId) {
    return (pack && pack.items.find((it) => it.id === itemId)) || null;
  }

  // ---------- session indicator (header) ----------
  function sessionIndicator() {
    const restored = FTEngine.session.restoreActiveSession();
    if (!restored) return null;
    const s = restored.session;
    return el('span', { class: 'badge', style: 'background:var(--accent-soft);color:var(--accent-ink);border-color:transparent;' },
      'เล่นอยู่: ' + s.packName + ' · ' + s.modeName,
      el('button', {
        class: 'btn btn-sm btn-ghost', style: 'padding:2px 8px;min-height:28px;',
        onclick: () => { gameState = { session: s, pack: restored.pack, mode: FTEngine.session.getMode(s.modeId) }; FTUI.router.navigate('play'); },
      }, 'ไปเล่นต่อ')
    );
  }

  function sessionIndicatorRefresh() {
    const holder = document.getElementById('session-indicator');
    if (holder) holder.replaceChildren(sessionIndicator() || '');
  }

  FTUI.playSetup = setup;
  FTUI.playGame = game;
  FTUI.sessionIndicator = sessionIndicator;
  FTUI.sessionIndicatorRefresh = sessionIndicatorRefresh;
  FTUI.clearGameState = () => { gameState = null; };
  FTUI.__gameState = () => gameState && { modeId: gameState.session.modeId, modeInput: gameState.mode.input, status: gameState.session.status, pack: gameState.pack.metadata.name };
})(window);
