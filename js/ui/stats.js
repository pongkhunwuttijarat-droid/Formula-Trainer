/**
 * Statistics page — overall / by pack / by mode / by item (monitor surface).
 */
(function (global) {
  'use strict';
  const FTUI = (global.FTUI = global.FTUI || {});
  const { el, clear, fmtTime, fmtPct, emptyState } = FTUI;

  function statsPage(root) {
    clear(root);
    root.append(
      el('h1', { class: 'page-title' }, 'สถิติ'),
      el('p', { class: 'page-sub' }, 'แยกตาม item / pack / mode — เก็บในเครื่องเท่านั้น')
    );

    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const body = el('div');
    root.append(tabs, body);

    const views = FTEngine.stats.statsViews();
    const tabsDef = [
      { id: 'overall', label: 'ภาพรวม', render: () => tabOverall(views) },
      { id: 'bypack', label: 'รายแพ็ค', render: () => tabByPack(views) },
      { id: 'bymode', label: 'รายโหมด', render: () => tabByMode(views) },
      { id: 'byitem', label: 'รายข้อ', render: () => tabByItem(views) },
    ];

    let active = 'overall';
    function switchTab(id) {
      active = id;
      tabs.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
      clear(body);
      const def = tabsDef.find((t) => t.id === id);
      if (def) body.append(def.render());
    }

    for (const t of tabsDef) {
      tabs.append(el('button', {
        class: 'tab-btn' + (t.id === active ? ' active' : ''), dataset: { tab: t.id }, role: 'tab',
        'aria-selected': t.id === active ? 'true' : 'false',
        onclick: () => switchTab(t.id),
      }, t.label));
    }
    switchTab('overall');

    function tileGrid(stats, extraTiles) {
      return el('div', { class: 'stat-grid' },
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, stats.attempts), el('div', { class: 'stat-label' }, 'ครั้งที่ตอบ')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value', style: 'color:var(--correct);' }, stats.correct), el('div', { class: 'stat-label' }, 'ถูก')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value', style: 'color:var(--wrong);' }, stats.wrong), el('div', { class: 'stat-label' }, 'ผิด')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, fmtPct(stats.bestAccuracy || (stats.attempts ? Math.round(stats.correct / stats.attempts * 1000) / 10 : 0))), el('div', { class: 'stat-label' }, 'แม่นยำสูงสุด')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, fmtTime(stats.timeMs)), el('div', { class: 'stat-label' }, 'เวลา')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, stats.longestStreak), el('div', { class: 'stat-label' }, 'สตรีคยาวสุด')),
        ...(extraTiles || [])
      );
    }

    function tabOverall(views) {
      const ov = views.overall;
      const total = ov.total || { attempts: 0, correct: 0, wrong: 0, timeMs: 0, bestAccuracy: 0, longestStreak: 0, currentStreak: 0 };
      const acc = total.attempts ? Math.round((total.correct / total.attempts) * 1000) / 10 : 0;
      const masteryCounts = FTEngine.stats.overallProgress().masteryCounts;
      const masteryRows = FTEngine.stats.masteryLevels().map((l) => ({ ...l, count: masteryCounts[l.level] || 0 }));
      return el('div', null,
        tileGrid(total, [
          el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, acc + '%'), el('div', { class: 'stat-label' }, 'ความแม่นยำรวม')),
        ]),
        el('h2', { style: 'font-size:1rem;' }, 'Mastery ทั้งหมด'),
        el('div', { class: 'mastery-bar' },
          masteryRows.map((l) => el('div', { class: 'mastery-seg' },
            el('b', { class: 'mastery-' + l.level }, l.count), l.label))
        )
      );
    }

    function tabByPack(views) {
      if (views.byPack.length === 0) return emptyState('ยังไม่มีสถิติ', 'เล่นเกมสักรอบก่อน สถิติจะแสดงที่นี่');
      const wrap = el('div', { class: 'table-wrap' });
      const tbl = el('table', { class: 'tbl' },
        el('thead', null, el('tr', null,
          el('th', null, 'แพ็ค'), el('th', { class: 'num' }, 'ครั้ง'), el('th', { class: 'num' }, 'ถูก'),
          el('th', { class: 'num' }, 'ผิด'), el('th', { class: 'num' }, 'แม่นยำ'), el('th', { class: 'num' }, 'สตรีคยาวสุด'),
          el('th', { class: 'num' }, 'เวลา'), el('th', null, '')
        )),
        el('tbody', null,
          views.byPack.map((row) => el('tr', null,
            el('td', null, el('b', null, row.pack.name), el('div', { style: 'font-size:0.8rem;color:var(--muted);' }, row.pack.subject)),
            el('td', { class: 'num' }, row.stats.attempts),
            el('td', { class: 'num' }, row.stats.correct),
            el('td', { class: 'num' }, row.stats.wrong),
            el('td', { class: 'num' }, fmtPct(row.stats.attempts ? Math.round(row.stats.correct / row.stats.attempts * 1000) / 10 : 0)),
            el('td', { class: 'num' }, row.stats.longestStreak),
            el('td', { class: 'num' }, fmtTime(row.stats.timeMs)),
            el('td', null, el('button', { class: 'btn btn-sm', onclick: () => openPackDetail(row.pack.id) }, 'โหมด'))
          ))
        )
      );
      wrap.append(tbl);
      return wrap;
    }

    function openPackDetail(packId) {
      const map = FTEngine.storage.getStatsMap(packId);
      const meta = FTEngine.storage.listPacks().find((p) => p.metadata.id === packId);
      const rows = Object.entries(map.packMode || {});
      if (rows.length === 0) { FTUI.toast('ยังไม่มีสถิติของแพ็คนี้', 'error'); return; }
      const body = el('div', { class: 'table-wrap' },
        el('table', { class: 'tbl' },
          el('thead', null, el('tr', null,
            el('th', null, 'โหมด'), el('th', { class: 'num' }, 'ครั้ง'), el('th', { class: 'num' }, 'ถูก'),
            el('th', { class: 'num' }, 'ผิด'), el('th', { class: 'num' }, 'แม่นยำ'), el('th', { class: 'num' }, 'เวลา')
          )),
          el('tbody', null,
            rows.map(([modeId, s]) => el('tr', null,
              el('td', null, FTEngine.session.getMode(modeId)?.nameTh || modeId),
              el('td', { class: 'num' }, s.attempts),
              el('td', { class: 'num' }, s.correct),
              el('td', { class: 'num' }, s.wrong),
              el('td', { class: 'num' }, fmtPct(s.attempts ? Math.round(s.correct / s.attempts * 1000) / 10 : 0)),
              el('td', { class: 'num' }, fmtTime(s.timeMs))
            ))
          )
        )
      );
      FTUI.openModal({ title: meta ? meta.metadata.name : packId, body });
    }

    function tabByMode(views) {
      const modes = Object.entries(views.byMode);
      if (modes.length === 0) return emptyState('ยังไม่มีสถิติ', 'เล่นเกมสักรอบก่อน');
      const wrap = el('div', { class: 'table-wrap' });
      const tbl = el('table', { class: 'tbl' },
        el('thead', null, el('tr', null,
          el('th', null, 'โหมด'), el('th', { class: 'num' }, 'ครั้ง'), el('th', { class: 'num' }, 'ถูก'),
          el('th', { class: 'num' }, 'ผิด'), el('th', { class: 'num' }, 'แม่นยำ'), el('th', { class: 'num' }, 'สตรีคยาวสุด'),
          el('th', { class: 'num' }, 'เวลา')
        )),
        el('tbody', null,
          modes.map(([modeId, s]) => el('tr', null,
            el('td', null, FTEngine.session.getMode(modeId)?.nameTh || modeId),
            el('td', { class: 'num' }, s.attempts),
            el('td', { class: 'num' }, s.correct),
            el('td', { class: 'num' }, s.wrong),
            el('td', { class: 'num' }, fmtPct(s.attempts ? Math.round(s.correct / s.attempts * 1000) / 10 : 0)),
            el('td', { class: 'num' }, s.longestStreak),
            el('td', { class: 'num' }, fmtTime(s.timeMs))
          ))
        )
      );
      wrap.append(tbl);
      return wrap;
    }

    function tabByItem(views) {
      if (views.byItem.length === 0) return emptyState('ยังไม่มีสถิติ', 'เล่นเกมสักรอบก่อน');
      const qInput = el('input', { type: 'search', placeholder: 'ค้นหาข้อ…', 'aria-label': 'ค้นหาข้อ' });
      const wrap = el('div', { class: 'table-wrap', style: 'margin-top:12px;' });
      let timer = null;

      function renderRows(query) {
        const q = (query || '').trim().toLowerCase();
        const rows = views.byItem.filter((r) => !q || r.item.prompt.toLowerCase().includes(q) || r.item.answerTokens.join(' ').toLowerCase().includes(q));
        clear(wrap);
        if (rows.length === 0) { wrap.append(emptyState('ไม่พบข้อ', '')); return; }
        const tbl = el('table', { class: 'tbl' },
          el('thead', null, el('tr', null,
            el('th', null, 'แพ็ค'), el('th', null, 'โจทย์'), el('th', null, 'คำตอบ'), el('th', null, 'Mastery'),
            el('th', { class: 'num' }, 'ครั้ง'), el('th', { class: 'num' }, 'ถูก'), el('th', { class: 'num' }, 'แม่นยำ'), el('th', { class: 'num' }, 'สตรีค')
          )),
          el('tbody', null,
            rows.map((r) => el('tr', null,
              el('td', { style: 'white-space:nowrap;' }, r.packName),
              el('td', null, r.item.prompt),
              el('td', null, el('span', { class: 'formula' }, r.item.answerTokens.join(' '))),
              el('td', null, FTUI.masteryBadge(r.mastery)),
              el('td', { class: 'num' }, r.stats.attempts),
              el('td', { class: 'num' }, r.stats.correct),
              el('td', { class: 'num' }, fmtPct(r.stats.attempts ? Math.round(r.stats.correct / r.stats.attempts * 1000) / 10 : 0)),
              el('td', { class: 'num' }, r.stats.longestStreak)
            ))
          )
        );
        wrap.append(tbl);
      }

      qInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => renderRows(qInput.value), 120); });
      renderRows('');
      return el('div', null, qInput, wrap);
    }
  }

  FTUI.statsPage = statsPage;
})(window);
