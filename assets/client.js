// 差分マークの配置、diff ポップアップ、表示モードの切り替え
(() => {
  const data = JSON.parse(document.getElementById('md-diff-data').textContent);
  const popup = document.getElementById('popup');
  const toggle = document.getElementById('mode-toggle');
  const splitToggle = document.getElementById('split-toggle');
  const MODE_LABEL = { merged: '統合表示', new: '更新後のみ' };
  const MARK_HEIGHT = 18;
  let mode = 'merged';
  let pinned = null; // 固定中のファイル番号と hunk 番号
  let hideTimer = 0;

  const docOf = (file) => file.querySelector(`.doc[data-mode="${mode}"][data-split="${splitToggle.checked}"]`);

  // 指定行を含む最も内側の要素。なければ直後の要素、それもなければ文末
  function anchorFor(doc, line) {
    let best = null;
    let bestLs = -1;
    let next = null;
    let nextLs = Infinity;
    for (const el of doc.querySelectorAll('.markdown-body [data-ls], .markdown-body [data-l]')) {
      const ls = Number(el.dataset.ls ?? el.dataset.l);
      const le = el.dataset.le !== undefined ? Number(el.dataset.le) : ls + 1;
      if (ls <= line && line < le && ls >= bestLs) {
        best = el;
        bestLs = ls;
      } else if (ls > line && ls < nextLs) {
        next = el;
        nextLs = ls;
      }
    }
    return best ?? next ?? doc.querySelector('.doc-end');
  }

  function layout() {
    for (const file of document.querySelectorAll('.file')) layoutFile(file);
  }

  function layoutFile(file) {
    const fileIndex = Number(file.dataset.file);
    const hunks = data.files[fileIndex].hunks;
    const doc = docOf(file);
    if (!doc) return;
    const gutter = doc.querySelector('.gutter');
    gutter.textContent = '';
    const base = doc.getBoundingClientRect().top;
    const items = hunks.map((h, i) => {
      const anchor = anchorFor(doc, h.target[mode]);
      return { i, anchor, y: anchor.getBoundingClientRect().top - base };
    });
    // 位置が重なるマークは下にずらし、すべての hunk に到達できるようにする
    items.sort((a, b) => a.y - b.y || a.i - b.i);
    let prev = -Infinity;
    for (const it of items) {
      const y = Math.max(it.y, prev + MARK_HEIGHT);
      prev = y;
      const key = `${fileIndex}:${it.i}`;
      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = `mark mark-${hunks[it.i].kind}`;
      mark.style.top = `${y}px`;
      mark.textContent = String(it.i + 1);
      // title はブラウザのツールチップがポップアップと重なるため使わず、読み上げ用の名前だけ付ける
      mark.setAttribute('aria-label', hunks[it.i].header);
      mark.addEventListener('mouseenter', () => {
        it.anchor.classList.add('md-focus');
        if (pinned === null) show(fileIndex, it.i, mark);
      });
      mark.addEventListener('mouseleave', () => {
        it.anchor.classList.remove('md-focus');
        if (pinned === null) scheduleHide();
      });
      mark.addEventListener('click', () => {
        if (pinned === key) {
          unpin();
        } else {
          pinned = key;
          show(fileIndex, it.i, mark);
          popup.classList.add('pinned');
        }
      });
      gutter.appendChild(mark);
    }
    // 同じ位置のマークが多くても、次のファイルに重ならない高さを確保する
    doc.style.minHeight = `${Math.max(64, Number.isFinite(prev) ? prev + MARK_HEIGHT : 0)}px`;
  }

  function show(fileIndex, i, mark) {
    clearTimeout(hideTimer);
    const file = data.files[fileIndex];
    const h = file.hunks[i];
    popup.textContent = '';
    const head = document.createElement('div');
    head.className = 'popup-head';
    head.textContent = `${file.path} — #${i + 1} ${h.header}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'popup-close';
    close.textContent = '×';
    close.addEventListener('click', unpin);
    head.appendChild(close);
    const pre = document.createElement('pre');
    for (const l of h.lines) {
      const span = document.createElement('span');
      span.className = l.mark === '-' ? 'pl-del' : l.mark === '+' ? 'pl-add' : l.mark === '\\' ? 'pl-note' : 'pl-ctx';
      span.textContent = `${l.mark}${l.text}\n`;
      pre.appendChild(span);
    }
    popup.append(head, pre);
    const r = mark.getBoundingClientRect();
    popup.style.left = `${r.right + window.scrollX + 8}px`;
    popup.style.top = `${r.top + window.scrollY}px`;
    popup.hidden = false;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (pinned === null) popup.hidden = true;
    }, 200);
  }

  function unpin() {
    pinned = null;
    popup.classList.remove('pinned');
    popup.hidden = true;
  }

  popup.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  popup.addEventListener('mouseleave', () => {
    if (pinned === null) scheduleHide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') unpin();
  });

  function setMode(m) {
    mode = m;
    for (const doc of document.querySelectorAll('.doc')) {
      doc.hidden = doc.dataset.mode !== mode || doc.dataset.split !== String(splitToggle.checked);
    }
    toggle.textContent = `表示: ${MODE_LABEL[m]}（切り替え）`;
    document.body.dataset.mode = m;
    unpin();
    layout();
  }

  toggle.addEventListener('click', () => setMode(mode === 'merged' ? 'new' : 'merged'));
  splitToggle.addEventListener('change', () => setMode(mode));
  new ResizeObserver(() => layout()).observe(document.querySelector('main'));
  setMode('merged');
})();
