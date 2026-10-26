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

  // マークを置く候補の要素と、その行範囲
  function candidates(doc) {
    return [...doc.querySelectorAll('.markdown-body [data-ls], .markdown-body [data-l]')].map((el) => {
      const ls = Number(el.dataset.ls ?? el.dataset.l);
      const le = el.dataset.le !== undefined ? Number(el.dataset.le) : ls + 1;
      return { el, ls, le };
    });
  }

  // 指定行を含む最も内側の要素。なければ直後の要素、それもなければ文末
  function anchorFor(doc, elements, line) {
    let best = null;
    let bestLs = -1;
    let next = null;
    let nextLs = Infinity;
    for (const { el, ls, le } of elements) {
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
    if (!doc || file.classList.contains('collapsed')) return;
    const gutter = doc.querySelector('.gutter');
    gutter.textContent = '';
    const base = doc.getBoundingClientRect().top;
    const elements = candidates(doc);
    const items = hunks.map((h, i) => {
      const anchor = anchorFor(doc, elements, h.target[mode]);
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
      mark.anchorElement = it.anchor;
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
    // hunk ヘッダーの開始行から、各行の変更前・変更後の行番号を数える
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(h.header);
    let oldNo = Number(m[1]);
    let newNo = Number(m[2]);
    const width = String(Math.max(oldNo, newNo) + h.lines.length).length;
    pre.style.setProperty('--no-width', `${width}ch`);
    const number = (n) => {
      const span = document.createElement('span');
      span.className = 'pl-no';
      span.textContent = n === null ? '' : String(n);
      return span;
    };
    for (const l of h.lines) {
      const row = document.createElement('div');
      row.className = l.mark === '-' ? 'pl-del' : l.mark === '+' ? 'pl-add' : l.mark === '\\' ? 'pl-note' : 'pl-ctx';
      const showOld = l.mark === ' ' || l.mark === '-';
      const showNew = l.mark === ' ' || l.mark === '+';
      row.append(number(showOld ? oldNo++ : null), number(showNew ? newNo++ : null));
      const text = document.createElement('span');
      text.className = 'pl-text';
      text.textContent = `${l.mark}${l.text}`;
      row.appendChild(text);
      pre.appendChild(row);
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
    updateNav();
  }

  // ツールバーの下端。スクロール位置の判定と移動先の基準にする
  const toolbar = document.querySelector('.toolbar');
  const currentFile = document.getElementById('current-file');
  const fileList = document.querySelector('.file-list');
  const prevButton = document.getElementById('prev-hunk');
  const nextButton = document.getElementById('next-hunk');
  const MARGIN = 16;
  const viewTop = () => toolbar.getBoundingClientRect().bottom + MARGIN;

  // 表示位置にあるファイル名と、前後の hunk ボタンの状態を更新する
  function updateNav() {
    let current = null;
    for (const file of document.querySelectorAll('.file')) {
      if (file.getBoundingClientRect().top > viewTop()) break;
      current = file;
    }
    for (const item of fileList.querySelectorAll('li')) {
      const isCurrent = current !== null && item.dataset.file === current.dataset.file;
      item.classList.toggle('current', isCurrent);
      // 目次がスクロールする場合も、表示中のファイルが目次の表示範囲に入るようにする
      if (isCurrent) {
        const list = fileList.getBoundingClientRect();
        const r = item.getBoundingClientRect();
        if (r.top < list.top) fileList.scrollTop -= list.top - r.top;
        else if (r.bottom > list.bottom) fileList.scrollTop += r.bottom - list.bottom;
      }
    }
    if (current) {
      const path = current.querySelector('.file-header h2').textContent;
      const status = current.querySelector('.file-status').textContent;
      currentFile.textContent = `${path}（${status}）`;
      currentFile.title = path;
    } else {
      currentFile.textContent = '';
    }
    const marks = visibleMarks();
    prevButton.disabled = !marks.some((m) => m.getBoundingClientRect().top < viewTop() - 2);
    nextButton.disabled = !marks.some((m) => m.getBoundingClientRect().top > viewTop() + 2);
  }

  // 表示中の本文のマーク（文書順）。折りたたんだファイルは含めない
  const visibleMarks = () => [...document.querySelectorAll('.file:not(.collapsed) .doc:not([hidden]) .mark')];

  // マークがツールバーのすぐ下に来るようにスクロールし、対応する本文を一時的に強調する
  function jump(forward) {
    const marks = visibleMarks();
    const top = viewTop();
    const target = forward
      ? marks.find((m) => m.getBoundingClientRect().top > top + 2)
      : marks.reverse().find((m) => m.getBoundingClientRect().top < top - 2);
    if (!target) return;
    window.scrollBy(0, target.getBoundingClientRect().top - top);
    const anchor = target.anchorElement;
    anchor.classList.add('md-focus');
    setTimeout(() => anchor.classList.remove('md-focus'), 1200);
  }

  // ファイルの折りたたみ。見出しが画面より上に行った場合は、見出しが見える位置に戻す
  for (const button of document.querySelectorAll('.collapse-toggle')) {
    button.addEventListener('click', () => {
      const file = button.closest('.file');
      const collapsed = file.classList.toggle('collapsed');
      button.textContent = collapsed ? '▶' : '▼';
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? '展開する' : '折りたたむ');
      fileList.querySelector(`li[data-file="${file.dataset.file}"]`).classList.toggle('collapsed', collapsed);
      if (pinned !== null && pinned.startsWith(`${file.dataset.file}:`)) unpin();
      layout();
      const top = file.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom - 8;
      if (top < 0) window.scrollBy(0, top);
      updateNav();
    });
  }

  prevButton.addEventListener('click', () => jump(false));
  nextButton.addEventListener('click', () => jump(true));
  let navFrame = 0;
  window.addEventListener('scroll', () => {
    cancelAnimationFrame(navFrame);
    navFrame = requestAnimationFrame(updateNav);
  }, { passive: true });

  toggle.addEventListener('click', () => setMode(mode === 'merged' ? 'new' : 'merged'));
  splitToggle.addEventListener('change', () => setMode(mode));
  new ResizeObserver(() => {
    layout();
    updateNav();
  }).observe(document.querySelector('main'));
  // ファイル一覧から移動したとき、見出しがツールバーのすぐ下に来るようにする
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--toolbar-height', `${toolbar.offsetHeight}px`);
  }).observe(toolbar);
  setMode('merged');
})();
