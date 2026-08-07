/**
 * Builder page — create Knowledge Packs from text (BYOK), generate from
 * templates, validate & compile, then save/export. Fully separate from Engine.
 */
(function (global) {
  'use strict';
  const FTUI = (global.FTUI = global.FTUI || {});
  const { el, clear, toast, openModal, confirmDialog } = FTUI;

  const FORMAT_HINT = `รูปแบบข้อความ (BYOK) — 2 แบบ:
@name: ชื่อแพ็ค
@version: 1.0.0
@author: คุณ
@subject: math
@description: คำอธิบาย

=== ชื่อบท ===
sin(2A) = 2sin(A)cos(A)      ← บรรทัดสูตร: ฝั่งซ้ายเป็นโครง, ฝั่งขวาแตกเป็นส่วนประกอบ
cos(2A) = cos²(A)-sin²(A)    ← เครื่องหมาย (+/−) เป็นส่วนที่ต้องเลือก, เศษส่วน/วงเล็บเป็นโครง

หรือแบบ Q:/A: (โจทย์/คำตอบ)
Q: ชื่อสูตร
A: E = mc²
D: 2        (ระดับ 1–5, ไม่บังคับ)
T: physics  (แท็ก, ไม่บังคับ)

วิชาที่รองรับ: math, physics, chemistry, biology, language, programming, law, music`;

  function builderPage(root) {
    clear(root);
    root.append(
      el('h1', { class: 'page-title' }, 'Builder'),
      el('p', { class: 'page-sub' }, 'สร้าง Knowledge Pack แบบ Compiled — แยกจาก Engine โดยสิ้นเชิง (AI/OCR/PDF อยู่นอกแกน)')
    );

    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const body = el('div');
    root.append(tabs, body);

    const tabsDef = [
      { id: 'byok', label: 'BYOK — วางข้อความ', render: () => tabByok() },
      { id: 'generate', label: 'Generate Pack', render: () => tabGenerate() },
      { id: 'pdf', label: 'Import PDF', render: () => tabPdf() },
    ];
    let active = 'byok';

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
    switchTab('byok');

    // ---------- BYOK ----------
    function tabByok() {
      const ta = el('textarea', {
        placeholder: FORMAT_HINT,
        'aria-label': 'ข้อความสูตรที่จะแปลงเป็นแพ็ค',
        style: 'width:100%;min-height:280px;font-family:var(--mono);font-size:0.88rem;padding:12px;border:1px solid var(--border-strong);border-radius:10px;',
      });
      const resultBox = el('div', { style: 'margin-top:14px;' });

      const compileBtn = el('button', { class: 'btn btn-primary btn-lg', onclick: compile }, 'ตรวจสอบและ Compile');
      const exampleBtn = el('button', { class: 'btn', onclick: loadExample }, 'โหลดตัวอย่าง');

      function loadExample() {
        ta.value = `# Trig Angle Demo
@name: Trig Angle Demo
@version: 0.1.0
@author: ฉันเอง
@subject: math
@description: ทดสอบสูตรมุม

=== Double Angle ===
sin(2A) = 2sin(A)cos(A)
cos(2A) = cos²(A)-sin²(A)
tan(2A) = 2tan(A)/(1-tan²(A))

=== Half Angle ===
sin(A/2) = ±√((1-cos(A))/2)
cos(A/2) = ±√((1+cos(A))/2)`;
        compile();
      }

      function compile() {
        const parsed = parseText(ta.value);
        clear(resultBox);
        if (parsed.errors.length > 0) {
          resultBox.append(
            el('div', { class: 'feedback feedback-wrong' }, 'ไม่สามารถ compile ได้:'),
            el('ul', { style: 'color:var(--wrong);' }, parsed.errors.map((e) => el('li', null, e)))
          );
          return;
        }
        const pack = buildPackFromParsed(parsed);
        const v = FTEngine.validatePack(pack);
        if (!v.ok) {
          resultBox.append(el('div', { class: 'feedback feedback-wrong' }, 'compile ไม่ผ่าน: ' + v.errors.join(' · ')));
          return;
        }
        renderCompiled(pack, parsed);
      }

      function renderCompiled(pack, parsed) {
        // pack info form
        const nameInput = el('input', { value: pack.metadata.name, 'aria-label': 'ชื่อแพ็ค' });
        const subjInput = el('input', { value: pack.metadata.subject, 'aria-label': 'วิชา' });
        const authorInput = el('input', { value: pack.metadata.author, 'aria-label': 'ผู้แต่ง' });
        const verInput = el('input', { value: pack.metadata.version, 'aria-label': 'เวอร์ชัน' });
        const descInput = el('input', { value: pack.metadata.description, 'aria-label': 'คำอธิบาย' });

        const previewWrap = el('div', { class: 'table-wrap', style: 'margin:12px 0;max-height:280px;overflow:auto;' });
        const renderPreview = () => {
          const updated = buildPackFromParsed(Object.assign(parsed, {
            meta: {
              name: nameInput.value.trim() || 'Unnamed Pack',
              subject: subjInput.value.trim() || 'other',
              author: authorInput.value.trim(),
              version: verInput.value.trim() || '1.0.0',
              description: descInput.value.trim(),
            },
          }));
          clear(previewWrap);
          previewWrap.append(
            el('table', { class: 'tbl' },
              el('thead', null, el('tr', null, el('th', null, 'โจทย์'), el('th', null, 'คำตอบ (tokens)'), el('th', null, 'ระดับ'), el('th', null, 'แท็ก'))),
              el('tbody', null, updated.items.map((it) => el('tr', null,
                el('td', null, it.prompt),
                el('td', null, el('span', { class: 'formula' }, it.answerTokens.join(' '))),
                el('td', null, it.metadata.difficulty),
                el('td', null, it.metadata.tags.join(', '))
              )))
            )
          );
          return updated;
        };
        ['input', 'change'].forEach((ev) => {
          nameInput.addEventListener(ev, renderPreview);
          subjInput.addEventListener(ev, renderPreview);
          authorInput.addEventListener(ev, renderPreview);
          verInput.addEventListener(ev, renderPreview);
          descInput.addEventListener(ev, renderPreview);
        });

        resultBox.append(
          el('div', { class: 'card' },
            el('h3', { style: 'margin:0 0 12px;' }, 'Compile สำเร็จ — ' + pack.items.length + ' ข้อ'),
            el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;' },
              el('div', { class: 'field' }, el('label', null, 'ชื่อแพ็ค'), nameInput),
              el('div', { class: 'field' }, el('label', null, 'วิชา'), subjInput),
              el('div', { class: 'field' }, el('label', null, 'ผู้แต่ง'), authorInput),
              el('div', { class: 'field' }, el('label', null, 'เวอร์ชัน'), verInput)
            ),
            el('div', { class: 'field' }, el('label', null, 'คำอธิบาย'), descInput),
            previewWrap,
            el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' },
              el('button', { class: 'btn btn-primary btn-lg', onclick: () => {
                const updated = renderPreview();
                const r = saveCompiled(updated);
                if (r) toast('ติดตั้งแพ็ค "' + r.metadata.name + '" แล้ว', 'success');
              } }, 'ติดตั้งแพ็ค (บันทึก)'),
              el('button', { class: 'btn btn-lg', onclick: () => {
                const updated = renderPreview();
                downloadPack(updated);
              } }, 'ส่งออก .json')
            )
          )
        );
        renderPreview();
      }

      return el('div', null,
        el('div', { class: 'card', style: 'margin-bottom:14px;' },
          el('h2', { style: 'margin:0 0 10px;font-size:1.02rem;' }, 'วางข้อความสูตร (BYOK)'),
          ta,
          el('div', { style: 'display:flex;gap:10px;margin-top:10px;' }, compileBtn, exampleBtn)
        ),
        resultBox
      );
    }

    // ---------- generate ----------
    function tabGenerate() {
      const samples = global.FT_SAMPLE_PACKS || [];
      if (samples.length === 0) return el('div', { class: 'empty' }, el('h3', null, 'ไม่มีเทมเพลตใน build นี้'));
      const grid = el('div', { class: 'card-grid' });
      for (const pack of samples) {
        const m = pack.metadata;
        const installed = FTEngine.storage.packIdExists(m.id);
        grid.append(el('div', { class: 'card mode-card' },
          el('h3', null, m.name),
          el('p', null, m.description || ''),
          el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
            el('span', { class: 'badge badge-subject' }, m.subject),
            el('span', { class: 'badge' }, pack.items.length + ' ข้อ')
          ),
          el('div', { style: 'margin-top:10px;' },
            el('button', {
              class: 'btn ' + (installed ? 'btn' : 'btn-primary') + ' btn-sm',
              onclick: () => {
                const v = FTEngine.validatePack(pack);
                if (!v.ok) { toast('เทมเพลตเสีย: ' + v.errors.join('; '), 'error'); return; }
                if (installed) {
                  confirmDialog({
                    title: 'มีแพ็คนี้อยู่แล้ว',
                    message: '"' + m.name + '" ถูกติดตั้งไว้แล้ว — แทนที่?',
                    confirmText: 'แทนที่', danger: true,
                    onConfirm: () => { FTEngine.storage.savePack(FTEngine.normalizePack(pack)); toast('ติดตั้งใหม่แล้ว', 'success'); },
                  });
                } else {
                  FTEngine.storage.savePack(FTEngine.normalizePack(pack));
                  toast('ติดตั้ง "' + m.name + '" แล้ว', 'success');
                }
              },
            }, installed ? 'ติดตั้งใหม่ (แทนที่)' : 'ติดตั้งแพ็คนี้'),
            el('button', { class: 'btn btn-sm', style: 'margin-left:8px;', onclick: () => downloadPack(pack) }, 'ส่งออก .json')
          )
        ));
      }
      return el('div', null,
        el('p', { style: 'color:var(--muted);' }, 'สร้างแพ็คจากเทมเพลตสำเร็จรูป — เนื้อหาตรีโกณมิติ / ฟิสิกส์ / เคมี'),
        grid
      );
    }

    // ---------- PDF ----------
    function tabPdf() {
      return el('div', { class: 'card', style: 'max-width:560px;' },
        el('h2', { style: 'margin:0 0 8px;font-size:1.02rem;' }, 'Import PDF'),
        el('p', { style: 'color:var(--muted);' },
          'การอ่าน PDF ต้องใช้เครื่องมือ OCR/PDF parsing ซึ่งอยู่นอกแกน Engine และ offline build นี้ยังไม่รองรับในตัว' +
          ' — แนะนำให้เปิดไฟล์ PDF แล้ววางข้อความสูตรผ่านแท็บ BYOK หรือนำเข้าไฟล์ .json ที่ compile แล้ว'
        ),
        el('button', { class: 'btn', disabled: true, onclick: () => toast('PDF import ยังไม่รองรับใน offline build', 'error') }, 'เลือกไฟล์ PDF (เร็ว ๆ นี้)')
      );
    }

    // ---------- parser / compiler ----------
    function parseText(text) {
      const errors = [];
      const meta = {};
      const items = [];
      let chapter = '';
      let cur = null;

      const lines = String(text).split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('@')) {
          const m = line.slice(1).match(/^([\w-]+)\s*:\s*(.*)$/);
          if (!m) { errors.push('บรรทัด @ ไม่ถูกต้อง: ' + line); continue; }
          meta[m[1]] = m[2];
          continue;
        }
        if (line.startsWith('===') || line.startsWith('##')) {
          chapter = line.replace(/^[=#\s]+|[=#\s]+$/g, '').trim();
          continue;
        }
        if (line.startsWith('Q:')) {
          if (cur) {
            if (cur.answer) items.push(cur);
            else errors.push('ข้อ "' + cur.prompt + '" ไม่มีคำตอบ (A:)');
          }
          cur = { prompt: line.slice(2).trim(), answer: '', difficulty: 2, tags: [], chapter, formula: false };
          continue;
        }
        if (line.startsWith('A:')) { if (cur) cur.answer = line.slice(2).trim(); continue; }
        if (line.startsWith('D:')) {
          if (cur) { const d = parseInt(line.slice(2), 10); if (Number.isInteger(d) && d >= 1 && d <= 5) cur.difficulty = d; else errors.push('ระดับความยากต้องเป็น 1–5: ' + line); }
          continue;
        }
        if (line.startsWith('T:')) {
          if (cur) cur.tags = line.slice(2).split(',').map((s) => s.trim()).filter(Boolean);
          continue;
        }
        if (line.includes('=') && !line.startsWith('=')) {
          // formula line: lhs = rhs  (e.g. "sin(2A) = 2sin(A)cos(A)")
          if (cur) {
            if (cur.answer) items.push(cur);
            else errors.push('ข้อ "' + cur.prompt + '" ไม่มีคำตอบ (A:)');
            cur = null;
          }
          const lhs = line.split('=')[0].trim();
          const rhs = line.split('=').slice(1).join('=').trim();
          if (!lhs || !rhs) { errors.push('สูตรไม่สมบูรณ์ (ต้องมี lhs = rhs): ' + line); continue; }
          items.push({
            prompt: lhs + ' = ?',
            answer: rhs,
            difficulty: formulaDifficulty(chapter),
            tags: [FTEngine.slugify(chapter) || 'identity'],
            chapter,
            formula: true,
          });
          continue;
        }
        errors.push('อ่านบรรทัดไม่เข้าใจ: ' + line);
      }
      if (cur) {
        if (cur.answer) items.push(cur);
        else errors.push('ข้อ "' + cur.prompt + '" ไม่มีคำตอบ (A:)');
      }

      if (!meta.name) errors.push('ต้องมี @name');
      if (!meta.subject) errors.push('ต้องมี @subject');
      if (!meta.version) meta.version = '1.0.0';
      if (!meta.author) meta.author = '';
      if (!meta.description) meta.description = '';
      if (items.length === 0 && errors.length === 0) errors.push('ไม่มีข้อ (Q:/A: หรือสูตร lhs = rhs) ในข้อความ');

      return { meta, items, errors };
    }

    function formulaDifficulty(chapter) {
      const c = (chapter || '').toLowerCase();
      if (c.includes('double')) return 2;
      if (c.includes('half')) return 3;
      if (c.includes('triple')) return 4;
      if (c.includes('product')) return 3;
      if (c.includes('sum')) return 4;
      return 2;
    }

    function buildPackFromParsed(parsed) {
      const meta = parsed.meta;
      const id = meta.id && /^[a-z0-9-]+$/i.test(meta.id) ? meta.id : FTEngine.slugify(meta.name || 'pack') + '-' + Math.random().toString(36).slice(2, 6);
      const itemIds = new Set();
      const items = parsed.items.map((it) => {
        let id = FTEngine.slugify(it.prompt) + '-' + Math.random().toString(36).slice(2, 5);
        while (itemIds.has(id)) id = FTEngine.slugify(it.prompt) + '-' + Math.random().toString(36).slice(2, 5);
        itemIds.add(id);
        const entry = {
          id,
          prompt: it.prompt,
          answerTokens: [],
          availableTokens: [], // filled below
          metadata: { difficulty: it.difficulty, tags: it.tags, chapter: it.chapter },
        };
        if (it.formula) {
          const d = FTEngine.decomposeRhs(it.answer);
          entry.structure = d.structure;
          entry.answerTokens = d.parts;
        } else {
          entry.answerTokens = FTEngine.tokenize(it.answer);
        }
        return entry;
      });
      // distractors: token bank from all answers + generic
      const bank = new Set(['x', 'y', '1', '0', '2', 'π', '√', '²', 'θ', '=', '+', '−']);
      items.forEach((it) => it.answerTokens.forEach((t) => bank.add(t)));
      for (const it of items) {
        const answerSet = new Set(it.answerTokens);
        const pool = [...bank].filter((t) => !answerSet.has(t));
        const n = Math.min(10, Math.max(4, it.answerTokens.length + 3));
        const distractors = [];
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        for (const t of shuffled) { if (distractors.length >= n) break; distractors.push(t); }
        it.availableTokens = [...it.answerTokens, ...distractors];
        for (let i = it.availableTokens.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [it.availableTokens[i], it.availableTokens[j]] = [it.availableTokens[j], it.availableTokens[i]];
        }
      }
      return {
        metadata: { id, name: meta.name, version: meta.version, author: meta.author, description: meta.description, subject: meta.subject, schemaVersion: FTEngine.SCHEMA_VERSION },
        items,
      };
    }

    function saveCompiled(pack) {
      const v = FTEngine.validatePack(pack);
      if (!v.ok) { toast('pack ยังไม่ผ่าน validation: ' + v.errors.join(' · '), 'error'); return null; }
      if (FTEngine.storage.packIdExists(pack.metadata.id)) {
        confirmDialog({
          title: 'ID ซ้ำ',
          message: 'แพ็ค ID "' + pack.metadata.id + '" มีอยู่แล้ว — แทนที่?',
          confirmText: 'แทนที่', danger: true,
          onConfirm: () => {
            const err = FTEngine.storage.savePack(FTEngine.normalizePack(pack));
            if (err) toast(err.error, 'error'); else toast('บันทึกแทนที่แล้ว', 'success');
          },
        });
        return null;
      }
      const err = FTEngine.storage.savePack(FTEngine.normalizePack(pack));
      if (err) { toast(err.error, 'error'); return null; }
      return pack;
    }

    function downloadPack(pack) {
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: pack.metadata.id + '.json' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('ส่งออก ' + pack.metadata.id + '.json แล้ว', 'success');
    }
  }

  FTUI.builderPage = builderPage;
})(window);
