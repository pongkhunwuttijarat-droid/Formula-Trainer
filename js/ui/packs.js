/**
 * Packs page — list, search, import (file/paste with validation), export, delete, preview.
 */
(function (global) {
  'use strict';
  const FTUI = (global.FTUI = global.FTUI || {});
  const { el, clear, toast, openModal, confirmDialog, difficultyBadge, emptyState, packCard } = FTUI;

  function packsPage(root) {
    clear(root);
    root.append(
      el('h1', { class: 'page-title' }, 'แพ็คความรู้'),
      el('p', { class: 'page-sub' }, 'ติดตั้ง, นำเข้า, ส่งออก และจัดการ Knowledge Pack — เก็บในเครื่อง (LocalStorage)')
    );

    // ---------- import zone ----------
    const importZone = el('div', { class: 'card', style: 'margin-bottom:22px;' },
      el('h2', { style: 'margin:0 0 4px;font-size:1.05rem;' }, 'นำเข้า (Import)'),
      el('p', { style: 'margin:0 0 14px;color:var(--muted);font-size:0.88rem;' },
        'รองรับไฟล์ .json Knowledge Pack (schemaVersion 1) — ตรวจ schema, ID ซ้ำ, field ที่ขาด และ token ผิดพลาดให้อัตโนมัติ'
      ),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;' },
        el('label', { class: 'btn btn-primary', style: 'cursor:pointer;' },
          'เลือกไฟล์ .json',
          el('input', {
            type: 'file', accept: '.json,application/json', style: 'display:none;',
            onchange: (e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; },
          })
        ),
        el('button', { class: 'btn', onclick: () => openImportDialog() }, 'วาง JSON / ตรวจสอบ'),
        el('button', { class: 'btn', onclick: seedSamples }, 'ติดตั้งแพ็คตัวอย่างใหม่')
      )
    );
    root.append(importZone);

    // ---------- list ----------
    const searchInput = el('input', { type: 'search', placeholder: 'ค้นหาแพ็ค (ชื่อ/วิชา/คำอธิบาย)…', 'aria-label': 'ค้นหาแพ็ค' });
    const subjectSel = el('select', { 'aria-label': 'กรองตามวิชา' }, el('option', { value: '' }, 'ทุกวิชา'));
    const listEl = el('div', { class: 'card-grid' });

    function renderPacks() {
      const q = searchInput.value.trim();
      const subject = subjectSel.value;
      const packs = FTEngine.search.searchPacks(q, subject ? { subject } : {});
      clear(listEl);
      if (packs.length === 0) {
        listEl.append(emptyState('ไม่พบแพ็ค', 'ลองเปลี่ยนคำค้น หรือนำเข้าแพ็คใหม่'));
        return;
      }
      for (const p of packs) {
        listEl.append(packCard(p, {
          onPlay: () => FTUI.router.navigate('play'),
          onPreview: () => openPreview(p.metadata.id),
          onExport: () => exportPack(p.metadata.id),
          onDelete: () => deletePack(p.metadata.id),
        }));
      }
    }

    searchInput.addEventListener('input', renderPacks);
    subjectSel.addEventListener('change', renderPacks);

    root.append(
      el('h2', { style: 'font-size:1.05rem;' }, 'แพ็คที่ติดตั้ง (' + FTEngine.storage.packCount() + ')'),
      el('div', { class: 'search-row' }, searchInput, subjectSel),
      listEl
    );

    function refreshSubjects() {
      const subjects = FTEngine.stats.listSubjects();
      const cur = subjectSel.value;
      clear(subjectSel);
      subjectSel.append(el('option', { value: '' }, 'ทุกวิชา'));
      subjects.forEach((s) => subjectSel.append(el('option', { value: s, selected: s === cur ? 'selected' : null }, s)));
    }

    refreshSubjects();
    renderPacks();

    // ---------- import file ----------
    function importFile(file) {
      const reader = new FileReader();
      reader.onload = () => {
        let obj;
        try { obj = JSON.parse(reader.result); }
        catch (e) { toast('ไฟล์ JSON อ่านไม่ได้: ' + e.message, 'error'); return; }
        installValidated(obj, file.name);
      };
      reader.onerror = () => toast('อ่านไฟล์ไม่สำเร็จ', 'error');
      reader.readAsText(file);
    }

    // ---------- import from pasted JSON ----------
    function openImportDialog() {
      const ta = el('textarea', {
        class: 'field', style: 'width:100%;min-height:220px;font-family:var(--mono);font-size:0.88rem;padding:10px;',
        placeholder: 'วาง JSON Knowledge Pack ที่นี่…', 'aria-label': 'วาง JSON Knowledge Pack',
      });
      const errBox = el('div', { class: 'field-error' });
      openModal({
        title: 'นำเข้าด้วย JSON',
        body: [ta, errBox],
        foot: [
          el('button', { class: 'btn btn-primary', onclick: (e) => {
            let obj;
            try { obj = JSON.parse(ta.value); }
            catch (err) { errBox.textContent = 'JSON อ่านไม่ได้: ' + err.message; return; }
            const r = FTEngine.validatePack(obj);
            if (!r.ok) { errBox.textContent = r.errors.join(' · '); return; }
            e.target.closest('.modal-backdrop').remove();
            installValidated(obj, '(วางจากคลิปบอร์ด)');
          } }, 'ตรวจสอบและติดตั้ง'),
        ],
      });
      setTimeout(() => ta.focus(), 0);
    }

    function installValidated(obj, sourceName) {
      const v = FTEngine.validatePack(obj);
      if (!v.ok) {
        // show detailed errors
        const list = el('ul', { style: 'margin:0;padding-left:20px;' },
          v.errors.map((e) => el('li', null, e))
        );
        const warn = v.warnings.length > 0
          ? el('div', { style: 'margin-top:10px;color:var(--warn);font-size:0.88rem;' }, 'คำเตือน: ' + v.warnings.join(' · '))
          : null;
        openModal({ title: 'นำเข้าไม่สำเร็จ — ' + sourceName, body: [list, warn] });
        return;
      }
      // duplicate pack id across installed packs?
      if (FTEngine.storage.packIdExists(obj.metadata.id)) {
        confirmDialog({
          title: 'มีแพ็ค ID ซ้ำอยู่แล้ว',
          message: 'แพ็ค "' + obj.metadata.id + '" ถูกติดตั้งไว้แล้ว — ต้องการแทนที่หรือไม่? (สถิติเดิมจะถูกเก็บไว้)',
          confirmText: 'แทนที่',
          danger: true,
          onConfirm: () => { doInstall(obj, sourceName); },
        });
        return;
      }
      doInstall(obj, sourceName);
    }

    function doInstall(obj, sourceName) {
      const pack = FTEngine.normalizePack(obj);
      const err = FTEngine.storage.savePack(pack);
      if (err) { toast(err.error, 'error'); return; }
      toast('ติดตั้งแพ็ค "' + pack.metadata.name + '" แล้ว (' + pack.items.length + ' ข้อ)', 'success');
      refreshSubjects();
      renderPacks();
    }

    // ---------- seed samples ----------
    function seedSamples() {
      if (!global.FT_SAMPLE_PACKS) { toast('ไม่พบแพ็คตัวอย่างใน build', 'error'); return; }
      let count = 0;
      for (const pack of global.FT_SAMPLE_PACKS) {
        const v = FTEngine.validatePack(pack);
        if (!v.ok) { toast('แพ็คตัวอย่างเสีย: ' + v.errors.join('; '), 'error'); continue; }
        FTEngine.storage.savePack(FTEngine.normalizePack(pack));
        count++;
      }
      toast('ติดตั้งแพ็คตัวอย่าง ' + count + ' แพ็คแล้ว', 'success');
      refreshSubjects();
      renderPacks();
    }

    // ---------- export ----------
    function exportPack(packId) {
      const pack = FTEngine.storage.getPack(packId);
      if (!pack) { toast('ไม่พบแพ็ค', 'error'); return; }
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: pack.metadata.id + '.json' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('ส่งออก ' + pack.metadata.name + '.json แล้ว', 'success');
    }

    // ---------- delete ----------
    function deletePack(packId) {
      const meta = FTEngine.storage.listPacks().find((p) => p.metadata.id === packId);
      confirmDialog({
        title: 'ลบแพ็ค?',
        message: 'ลบ "' + (meta ? meta.metadata.name : packId) + '" พร้อมสถิติและความคืบหน้าทั้งหมดของแพ็คนี้',
        confirmText: 'ลบ',
        danger: true,
        onConfirm: () => {
          FTEngine.storage.deletePack(packId);
          toast('ลบแพ็คแล้ว', 'success');
          refreshSubjects();
          renderPacks();
        },
      });
    }

    // ---------- preview ----------
    function openPreview(packId) {
      const pack = FTEngine.storage.getPack(packId);
      if (!pack) return;
      const prog = FTEngine.storage.getProgress(packId);

      const qInput = el('input', { type: 'search', placeholder: 'ค้นหาสูตร…', 'aria-label': 'ค้นหาสูตร' });
      const diffSel = el('select', { 'aria-label': 'กรองระดับความยาก' }, el('option', { value: '' }, 'ทุกระดับ'));
      for (let d = 1; d <= 5; d++) diffSel.append(el('option', { value: String(d) }, 'ระดับ ' + d));
      const tagSel = el('select', { 'aria-label': 'กรองแท็ก' }, el('option', { value: '' }, 'ทุกแท็ก'));
      const tags = new Set();
      pack.items.forEach((it) => it.metadata.tags.forEach((t) => tags.add(t)));
      [...tags].sort().forEach((t) => tagSel.append(el('option', { value: t }, t)));
      const chapterSel = el('select', { 'aria-label': 'กรองบท' }, el('option', { value: '' }, 'ทุกบท'));
      FTEngine.search.listChapters(pack).forEach((c) => chapterSel.append(el('option', { value: c }, c)));

      const tableWrap = el('div', { class: 'table-wrap' });
      let timer = null;

      function renderItems() {
        clear(tableWrap);
        const filters = {};
        if (diffSel.value) filters.difficulty = Number(diffSel.value);
        if (tagSel.value) filters.tag = tagSel.value;
        if (chapterSel.value) filters.chapter = chapterSel.value;
        const items = FTEngine.search.searchItems(pack, qInput.value.trim(), filters);
        if (items.length === 0) {
          tableWrap.append(emptyState('ไม่พบสูตร', 'ลองเปลี่ยนคำค้นหรือตัวกรอง'));
          return;
        }
        const tbl = el('table', { class: 'tbl' },
          el('thead', null, el('tr', null,
            el('th', null, 'โจทย์'),
            el('th', null, 'คำตอบ'),
            el('th', null, 'ระดับ'),
            el('th', null, 'Mastery')
          )),
          el('tbody', null,
            items.map((it) => el('tr', null,
              el('td', null, it.prompt),
              el('td', null, el('span', { class: 'formula' }, it.answerTokens.join(' '))),
              el('td', null, difficultyBadge(it.metadata.difficulty)),
              el('td', null, FTUI.masteryBadge(FTEngine.stats.masteryOf(prog[it.id])))
            ))
          )
        );
        tableWrap.append(tbl);
      }

      qInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(renderItems, 120);
      });
      diffSel.addEventListener('change', renderItems);
      tagSel.addEventListener('change', renderItems);
      chapterSel.addEventListener('change', renderItems);

      const meta = FTEngine.storage.listPacks().find((p) => p.metadata.id === packId).metadata;
      openModal({
        title: 'พรีวิว: ' + meta.name,
        body: [
          el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;' },
            el('span', { class: 'badge badge-subject' }, meta.subject),
            el('span', { class: 'badge' }, 'v' + meta.version),
            el('span', { class: 'badge' }, pack.items.length + ' ข้อ'),
            meta.author ? el('span', { class: 'badge' }, meta.author) : null
          ),
          meta.description ? el('p', { style: 'margin:0 0 12px;color:var(--muted);font-size:0.9rem;' }, meta.description) : null,
          el('div', { class: 'search-row', style: 'margin-bottom:12px;' }, qInput, diffSel, tagSel, chapterSel),
          tableWrap,
        ],
      });
      renderItems();
    }
  }

  FTUI.packsPage = packsPage;
})(window);
