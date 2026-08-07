/**
 * Home page — overview, resume banner, quick actions, mastery overview.
 */
(function (global) {
  'use strict';
  const FTUI = (global.FTUI = global.FTUI || {});
  const { el, clear } = FTUI;

  function home(root) {
    clear(root);
    const restored = FTEngine.session.restoreActiveSession();
    if (restored) {
      const s = restored.session;
      root.append(
        el('div', { class: 'banner', role: 'status' },
          el('span', { class: 'banner-text' },
            'Session ค้างอยู่: ' + s.packName + ' · ' + s.modeName + ' — ตอบแล้ว ' + s.stats.attempts + ' ข้อ'
          ),
          el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
            FTUI.playGame(root); // game() picks up restoreActiveSession
          } }, 'ดำเนินต่อ'),
          el('button', { class: 'btn btn-sm', onclick: () => {
            FTEngine.session.quitSession(s);
            FTUI.sessionIndicatorRefresh();
            home(root);
          } }, 'ยกเลิก')
        )
      );
    }

    root.append(
      el('h1', { class: 'page-title' }, 'ฝึกจำสูตร'),
      el('p', { class: 'page-sub' }, 'ออฟไลน์ 100% — Knowledge Pack อยู่ในเครื่องคุณทั้งหมด')
    );

    const packs = FTEngine.storage.listPacks();
    const ov = FTEngine.stats.overallProgress();
    const masteryCounts = ov.masteryCounts;
    const masteryRows = FTEngine.stats.masteryLevels().map((l) => ({
      ...l,
      count: masteryCounts[l.level] || 0,
    }));

    // overview tiles
    root.append(
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, ov.packCount), el('div', { class: 'stat-label' }, 'แพ็ค')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, ov.itemTotal), el('div', { class: 'stat-label' }, 'สูตรทั้งหมด')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, ov.attempts), el('div', { class: 'stat-label' }, 'ครั้งที่ตอบ')),
        el('div', { class: 'stat-tile' }, el('div', { class: 'stat-value' }, ov.accuracy + '%'), el('div', { class: 'stat-label' }, 'ความแม่นยำรวม'))
      )
    );

    // quick actions
    root.append(
      el('div', { class: 'card', style: 'margin-bottom:20px;' },
        el('h2', { style: 'margin:0 0 12px;font-size:1.05rem;' }, 'เริ่มเลย'),
        el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' },
          el('button', { class: 'btn btn-primary btn-lg', onclick: () => FTUI.router.navigate('play') }, 'เลือกแพ็คและเล่น'),
          packs.length === 0
            ? el('button', { class: 'btn btn-lg', onclick: () => FTUI.router.navigate('packs') }, 'ติดตั้งแพ็คตัวอย่าง')
            : null,
          el('button', { class: 'btn btn-lg', onclick: () => FTUI.router.navigate('builder') }, 'สร้างแพ็คเอง (Builder)')
        )
      )
    );

    // mastery overview
    root.append(
      el('h2', { style: 'font-size:1.05rem;' }, 'ความเชี่ยวชาญ (Mastery)'),
      el('div', { class: 'mastery-bar', style: 'margin-bottom:20px;' },
        masteryRows.map((l) =>
          el('div', { class: 'mastery-seg' },
            el('b', { class: 'mastery-' + l.level }, l.count),
            l.label + (l.maxCorrect === Infinity ? '+' : ' (ถูก ' + l.minCorrect + '–' + l.maxCorrect + ')')
          )
        )
      )
    );

    // packs overview
    if (packs.length > 0) {
      root.append(el('h2', { style: 'font-size:1.05rem;' }, 'แพ็คของคุณ'));
      root.append(
        el('div', { class: 'card-grid' },
          packs.map((p) => el('div', { class: 'card card-hover' },
            el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start;' },
              el('h3', { style: 'margin:0;font-size:1rem;' }, p.metadata.name),
              el('span', { class: 'badge badge-subject' }, p.metadata.subject)
            ),
            el('p', { style: 'margin:6px 0 10px;color:var(--muted);font-size:0.88rem;' }, p.itemCount + ' ข้อ · v' + p.metadata.version),
            FTUI.masteryBarRow(p.metadata.id),
            el('div', { style: 'margin-top:10px;' },
              el('button', { class: 'btn btn-primary btn-sm', onclick: () => FTUI.router.navigate('play') }, 'เล่น')
            )
          ))
        )
      );
    } else {
      root.append(
        el('div', { class: 'card', style: 'text-align:center;padding:32px;' },
          el('h3', { style: 'margin:0 0 6px;' }, 'ยังไม่มีแพ็ค'),
          el('p', { style: 'color:var(--muted);' }, 'ติดตั้งแพ็คตัวอย่าง (ตรีโกณมิติ / ฟิสิกส์ / เคมี) ได้ในหน้าแพ็ค'),
          el('button', { class: 'btn btn-primary', style: 'margin-top:10px;', onclick: () => FTUI.router.navigate('packs') }, 'ไปหน้าแพ็ค')
        )
      );
    }
  }

  FTUI.homePage = home;
})(window);
