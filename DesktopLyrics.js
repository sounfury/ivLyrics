/** Desktop lyrics using Spotify's Document Picture-in-Picture window. No helper app. */
(() => {
  'use strict';
  if (window.ivLyricsDesktop) return;
  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14Zm-9-8h7v6h-7z"/></svg>';
  let pip = null, timer = null, button = null, opening = false;
  let uri = null, lines = [], active = -2, currentLine = null, offset = 0;
  let generation = 0, snapshotRevision = null, loadError = '', lastOffsetCheck = 0;
  let nodes = null, syllableNodes = [], size = 30;
  try { size = Math.max(18, Math.min(60, Number(localStorage.getItem('ivLyrics:desktop:font-size')) || 30)); } catch {}

  const getTrack = () => {
    const item = Spicetify.Player.data?.item;
    return item?.uri ? {
      uri: item.uri,
      title: item.name || item.metadata?.title || '',
      artist: item.artists?.map(a => a.name).join(', ') || item.metadata?.artist_name || '',
      album: item.album?.name || item.metadata?.album_title || '',
      duration: item.duration?.milliseconds || Number(item.metadata?.duration) || 0
    } : null;
  };
  const original = line => String(line?.originalText || line?.text || '');
  const translation = line => String(line?.translationText || line?.text2 || line?.translation || '').replace(/\u200B/g, '');
  const notify = text => Spicetify.showNotification?.(text, true);

  function accept(next) {
    if (!Array.isArray(next) || !next.length || next === lines) return;
    lines = next;
    active = -2;
    currentLine = null;
  }

  async function refreshOffset(track, token) {
    try {
      const value = await window.LyricsService?.getSyncOffset?.(track.uri);
      if (token === generation) offset = Number(value) || 0;
    } catch { /* A missing offset must not stop playback. */ }
  }

  async function loadTrack(track) {
    const token = ++generation;
    uri = track?.uri || null;
    lines = [];
    active = -2;
    currentLine = null;
    snapshotRevision = null;
    loadError = '';
    offset = 0;
    nodes.title.textContent = track ? `${track.title} · ${track.artist}` : '暂无播放';
    if (!track) return;
    await refreshOffset(track, token);
    if (token !== generation) return;
    const snapshot = window.LyricsService?.getLyricsSnapshot?.(uri);
    if (snapshot?.displayLyrics?.length) {
      accept(snapshot.displayLyrics);
      snapshotRevision = snapshot.revision;
      return;
    }
    try {
      // Uses the same provider, translation settings and cache as the ivLyrics page.
      const result = await window.LyricsService.getFullLyrics(track, { sendToOverlay: false });
      if (token !== generation || uri !== track.uri) return;
      const latest = window.LyricsService.getLyricsSnapshot?.(uri);
      accept(latest?.displayLyrics?.length ? latest.displayLyrics : result.lyrics);
      loadError = result.error ? '暂无可用歌词' : '';
      active = -2;
    } catch (error) {
      if (token === generation) {
        loadError = '歌词加载失败，请在 ivLyrics 中重试';
        active = -2;
      }
      console.warn('[DesktopLyrics] Failed to load lyrics:', error);
    }
  }

  function renderLine(index) {
    const line = lines[index];
    active = index;
    currentLine = line;
    syllableNodes = [];
    nodes.line.replaceChildren();
    const lead = line?.vocals?.lead;
    const units = lead?.syllables || line?.syllables;
    if (units?.length) {
      for (const unit of units) {
        const span = pip.document.createElement('span');
        span.textContent = unit.text;
        span.className = 'syllable';
        nodes.line.appendChild(span);
        syllableNodes.push({ span, start: Number(unit.startTime), end: Number(unit.endTime), value: -1 });
      }
    } else {
      nodes.line.textContent = line ? original(line) : (!uri ? '暂无播放' : loadError || (lines.length ? '♪' : '正在加载歌词…'));
    }
    nodes.translation.textContent = translation(line);
    nodes.next.textContent = original(lines[index >= 0 ? index + 1 : 0]);
  }

  function tick() {
    if (!pip || pip.closed || !nodes) return;
    const track = getTrack();
    if ((track?.uri || null) !== uri) void loadTrack(track);
    const snapshot = window.LyricsService?.getLyricsSnapshot?.(uri);
    if (snapshot?.displayLyrics?.length && snapshot.revision !== snapshotRevision) {
      snapshotRevision = snapshot.revision;
      accept(snapshot.displayLyrics);
    }
    if (track && Date.now() - lastOffsetCheck > 1500) {
      lastOffsetCheck = Date.now();
      void refreshOffset(track, generation);
    }
    // getSyncOffset is the amount added to lyric timestamps by the overlay sender.
    const position = Spicetify.Player.getProgress() - offset;
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if (Number.isFinite(lines[i].startTime) && lines[i].startTime <= position) index = i;
    }
    // Unsynced lyrics have no cursor; show the first line rather than a false timing.
    if (lines.length && !lines.some(line => Number.isFinite(line.startTime))) index = 0;
    if (index !== active || lines[index] !== currentLine) renderLine(index);
    for (const unit of syllableNodes) {
      const value = Math.round(Math.max(0, Math.min(1, (position - unit.start) / Math.max(1, unit.end - unit.start))) * 100);
      if (value !== unit.value) {
        unit.span.style.setProperty('--fill', `${value}%`);
        unit.value = value;
      }
    }
    const paused = !Spicetify.Player.isPlaying();
    nodes.play.textContent = paused ? '播放' : '暂停';
    nodes.play.setAttribute('aria-label', paused ? '播放' : '暂停');
  }

  function cleanup() {
    ++generation;
    if (timer !== null && pip) pip.clearInterval(timer);
    timer = null;
    pip = null;
    nodes = null;
    lines = [];
    uri = null;
    active = -2;
    currentLine = null;
    syllableNodes = [];
    button && (button.active = false);
  }

  async function open() {
    if (pip && !pip.closed) { pip.focus(); return; }
    if (opening) return;
    if (!window.documentPictureInPicture?.requestWindow) {
      notify('这版 Spotify 不支持网页画中画，请更新 Spotify 后重试。');
      return;
    }
    opening = true;
    try {
      // Must be requested directly from the user's click, before any async work.
      pip = await documentPictureInPicture.requestWindow({ width: 660, height: 280 });
      pip.document.title = 'ivLyrics · 桌面歌词';
      const style = pip.document.createElement('style');
      style.textContent = `
        :root{color-scheme:dark;--size:${size}px}*{box-sizing:border-box}
        body{margin:0;background:#131b1a;color:#f4f0e8;font-family:'Yu Gothic UI','Microsoft YaHei UI',sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
        header{display:flex;align-items:center;gap:14px;padding:12px 20px 6px;font-size:11px;color:#94a6a0}
        #title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:5px 7px;border-radius:5px}button:hover{color:#fff;background:#ffffff12}button:focus-visible{outline:2px solid #b8e6cf}
        main{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:10px 24px 18px;gap:12px}
        #line{font-size:var(--size);font-weight:700;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}
        .syllable{--fill:0%;background:linear-gradient(to right,#f4f0e8 var(--fill),#687770 var(--fill));background-clip:text;-webkit-background-clip:text;color:transparent}
        #translation{color:#c9d8ce;font-size:calc(var(--size)*.6);line-height:1.55;white-space:pre-wrap}
        #translation:empty{display:none}#next{font-size:calc(var(--size)*.65);color:#6b7b74;line-height:1.5;white-space:pre-wrap}
        @media(max-height:200px){header{padding:5px 14px 0}main{padding:4px 15px 8px;gap:4px}#next{display:none}}
      `;
      pip.document.head.appendChild(style);
      pip.document.body.innerHTML = '<header><span id="title"></span><button id="smaller" aria-label="缩小字号">A−</button><button id="larger" aria-label="放大字号">A+</button><button id="play">播放</button></header><main><div id="line"></div><div id="translation"></div><div id="next"></div></main>';
      nodes = Object.fromEntries(['title', 'line', 'translation', 'next', 'play'].map(id => [id, pip.document.getElementById(id)]));
      nodes.play.onclick = () => Spicetify.Player.togglePlay();
      const resize = delta => {
        size = Math.max(18, Math.min(60, size + delta));
        pip.document.documentElement.style.setProperty('--size', `${size}px`);
        try { localStorage.setItem('ivLyrics:desktop:font-size', String(size)); } catch {}
      };
      pip.document.getElementById('smaller').onclick = () => resize(-2);
      pip.document.getElementById('larger').onclick = () => resize(2);
      pip.addEventListener('pagehide', cleanup, { once: true });
      button && (button.active = true);
      uri = null;
      void loadTrack(getTrack());
      timer = pip.setInterval(tick, 40);
      tick();
    } catch (error) {
      if (pip && !pip.closed) pip.close();
      cleanup();
      console.error('[DesktopLyrics] Could not open PiP:', error);
      notify('桌面歌词窗口未能打开，请再点击一次按钮。');
    } finally {
      opening = false;
    }
  }

  function close() { if (pip && !pip.closed) pip.close(); }
  window.ivLyricsDesktop = {
    open, close,
    getState: () => ({ open: !!pip && !pip.closed, uri, lines: lines.length, active, offset, translation: nodes?.translation.textContent || '', timerActive: timer !== null })
  };
  window.addEventListener('pagehide', close, { once: true });
  const init = () => {
    if (!window.Spicetify?.Topbar?.Button || !window.LyricsService) { setTimeout(init, 300); return; }
    button = new Spicetify.Topbar.Button('桌面歌词（画中画）', ICON, () => {
      if (pip && !pip.closed) close(); else void open();
    });
  };
  init();
})();
