/** Desktop lyrics using Spotify's Document Picture-in-Picture window. No helper app. */
(() => {
  'use strict';
  if (window.ivLyricsDesktop) return;
  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14Zm-9-8h7v6h-7z"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>';
  const PREV = '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 6.2v11.6a1 1 0 0 1-1.55.83L10 12.83a1 1 0 0 1 0-1.66l8.45-5.8A1 1 0 0 1 20 6.2Z"/></svg>';
  const NEXT = '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 6.2v11.6a1 1 0 0 0 1.55.83L14 12.83a1 1 0 0 0 0-1.66l-8.45-5.8A1 1 0 0 0 4 6.2Z"/></svg>';
  const MIN_SIZE = 16, MAX_SIZE = 44;
  const AUTO_OPEN_KEY = 'ivLyrics:desktop:auto-open';
  let pip = null, timer = null, button = null, opening = false;
  let autoOpen = false, wasPlaying = false, pendingOpen = false;
  try { autoOpen = localStorage.getItem(AUTO_OPEN_KEY) === 'true'; } catch {}
  let uri = null, lines = [], active = -2, currentLine = null, offset = 0;
  let generation = 0, snapshotRevision = null, loadError = '', lastOffsetCheck = 0;
  let nodes = null, syllableNodes = [], size = 24, paused = null;
  try { size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Number(localStorage.getItem('ivLyrics:desktop:font-size')) || 24)); } catch {}

  const imageUrl = raw => {
    const url = String(raw || '');
    return url.startsWith('spotify:image:') ? `https://i.scdn.co/image/${url.split(':').pop()}` : url;
  };
  const getTrack = () => {
    const item = Spicetify.Player.data?.item;
    return item?.uri ? {
      uri: item.uri,
      title: item.name || item.metadata?.title || '',
      artist: item.artists?.map(a => a.name).join(', ') || item.metadata?.artist_name || '',
      album: item.album?.name || item.metadata?.album_title || '',
      duration: item.duration?.milliseconds || Number(item.metadata?.duration) || 0,
      cover: imageUrl(item.images?.[0]?.url || item.album?.images?.[0]?.url || item.metadata?.image_url)
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

  async function refreshAccent(track, token) {
    try {
      const colors = await Spicetify.colorExtractor?.(track.uri);
      const accent = colors?.VIBRANT_NON_ALARMING || colors?.VIBRANT || colors?.LIGHT_VIBRANT;
      if (token === generation && nodes && accent) pip.document.documentElement.style.setProperty('--accent', accent);
    } catch { /* Keep the default accent. */ }
  }

  function showTrack(track) {
    nodes.island.title = track ? `${track.title} · ${track.artist}` : '';
    nodes.cover.style.backgroundImage = track?.cover ? `url("${track.cover.replace(/"/g, '%22')}")` : '';
    nodes.cover.classList.toggle('empty', !track?.cover);
    pip.document.documentElement.style.removeProperty('--accent');
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
    showTrack(track);
    if (!track) return;
    void refreshAccent(track, token);
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

  // Fit the lyric block (line, background vocals, translation) into the window:
  // shrink a long line onto one row first, otherwise wrap and shrink until the
  // whole block fits the height, so nothing is clipped at the window edges.
  function fit() {
    const block = nodes.lyrics;
    const islandStyle = pip.getComputedStyle(nodes.island);
    const maxHeight = nodes.island.clientHeight - parseFloat(islandStyle.paddingTop) - parseFloat(islandStyle.paddingBottom);
    const apply = (scale, wrap) => {
      block.classList.toggle('wrap', wrap);
      block.style.setProperty('--fit', scale.toFixed(3));
    };
    const widthRatio = el => el.scrollWidth ? el.clientWidth / el.scrollWidth : 1;
    apply(1, false);
    const oneRow = Math.min(1, widthRatio(nodes.line) * 0.98, widthRatio(nodes.translation) * 0.98);
    if (oneRow >= 0.72) {
      apply(oneRow, false);
      if (block.offsetHeight <= maxHeight + 1) return;
    }
    let low = 0.45, high = 1;
    for (let i = 0; i < 7; i++) {
      const scale = (low + high) / 2;
      apply(scale, true);
      if (block.offsetHeight <= maxHeight + 1) low = scale; else high = scale;
    }
    apply(low, true);
  }

  function appendSyllables(parent, units) {
    for (const unit of units) {
      const span = pip.document.createElement('span');
      span.textContent = unit.text;
      span.className = 'syllable';
      parent.appendChild(span);
      syllableNodes.push({ span, start: Number(unit.startTime), end: Number(unit.endTime), value: -1 });
    }
  }

  function renderLine(index) {
    const line = lines[index];
    const changed = index !== active;
    active = index;
    currentLine = line;
    syllableNodes = [];
    nodes.line.replaceChildren();
    const lead = line?.vocals?.lead;
    const units = lead?.syllables || line?.syllables;
    const track = getTrack();
    if (units?.length) {
      appendSyllables(nodes.line, units);
      // Background vocals sing over the lead; show each as a smaller row below it.
      for (const part of line.vocals?.background || []) {
        if (!part?.syllables?.length) continue;
        const row = pip.document.createElement('span');
        row.className = 'bg';
        nodes.line.appendChild(row);
        appendSyllables(row, part.syllables);
      }
    } else if (line) {
      nodes.line.textContent = original(line) || '♪';
    } else {
      // Before the first line (or without lyrics) the island shows the song, like a music activity.
      nodes.line.textContent = track ? track.title : '暂无播放';
    }
    nodes.translation.textContent = line
      ? translation(line)
      : (!uri ? '' : loadError || (lines.length ? track?.artist || '' : '正在加载歌词…'));
    nodes.next.textContent = original(lines[index >= 0 ? index + 1 : 0]);
    fit();
    if (changed && !pip.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.lyrics.animate([
        { opacity: 0, transform: 'translateY(8px) scale(.98)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'none' }
      ], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    }
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
    const progress = Spicetify.Player.getProgress();
    // getSyncOffset is the amount added to lyric timestamps by the overlay sender.
    const position = progress - offset;
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
    const duration = Spicetify.Player.getDuration?.() || track?.duration || 0;
    nodes.progress.style.transform = `scaleX(${duration ? Math.max(0, Math.min(1, progress / duration)) : 0})`;
    const nowPaused = !Spicetify.Player.isPlaying();
    if (nowPaused !== paused) {
      paused = nowPaused;
      nodes.play.innerHTML = paused ? PLAY : PAUSE;
      nodes.play.setAttribute('aria-label', paused ? '播放' : '暂停');
      nodes.island.classList.toggle('paused', paused);
    }
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
    paused = null;
    button && (button.active = false);
  }

  const STYLE = `
    :root{color-scheme:dark;--size:24px;--accent:#9df0c8;background:#000}*{box-sizing:border-box}
    body{margin:0;height:100vh;overflow:hidden;background:#000;color:#fff;font-family:'SF Pro Display','Segoe UI Variable Display','Microsoft YaHei UI','Yu Gothic UI',sans-serif;-webkit-font-smoothing:antialiased;user-select:none}
    #island{position:relative;height:100%;display:flex;align-items:center;gap:14px;padding:10px 14px 10px 12px;-webkit-app-region:drag;app-region:drag;cursor:grab}
    #cover{flex:none;width:44px;height:44px;border-radius:12px;background:#1c1c1e center/cover no-repeat;box-shadow:0 0 0 .5px #ffffff1f inset;transition:transform .45s cubic-bezier(.2,.9,.3,1.3)}
    #cover.empty{background-image:radial-gradient(circle at 30% 30%,#3a3a3c,#1c1c1e)}
    .paused #cover{transform:scale(.86)}
    #lyrics{--fit:1;flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px}
    #line{font-size:calc(var(--size) * var(--fit));font-weight:650;letter-spacing:-.01em;line-height:1.28;white-space:pre;overflow:hidden}
    .bg{display:block;font-size:.7em;font-weight:600}
    .wrap #line,.wrap #translation{white-space:pre-wrap;overflow-wrap:anywhere;text-overflow:clip}
    .syllable{--fill:0%;background:linear-gradient(to right,#fff var(--fill),#ffffff52 var(--fill));background-clip:text;-webkit-background-clip:text;color:transparent}
    .bg .syllable{background-image:linear-gradient(to right,#ffffffc0 var(--fill),#ffffff38 var(--fill))}
    #translation{font-size:calc(var(--size) * .56 * max(var(--fit), .8));color:#ffffffa6;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #translation:empty{display:none}
    #next{display:none;margin-top:4px;font-size:calc(var(--size) * .56);color:#ffffff59;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #side{flex:none;position:relative;width:34px;height:100%;display:flex;align-items:center;justify-content:center;-webkit-app-region:no-drag;app-region:no-drag;cursor:default}
    #bars{display:flex;align-items:center;gap:3px;height:22px;transition:opacity .2s}
    #bars i{width:3.5px;height:100%;border-radius:2px;background:var(--accent);transform-origin:center;animation:wave 1.1s ease-in-out infinite alternate}
    #bars i:nth-child(2){animation-duration:.8s;animation-delay:-.4s}#bars i:nth-child(3){animation-duration:1.3s;animation-delay:-.7s}#bars i:nth-child(4){animation-duration:.95s;animation-delay:-.2s}
    @keyframes wave{0%{transform:scaleY(.25)}50%{transform:scaleY(1)}100%{transform:scaleY(.45)}}
    .paused #bars i{animation-play-state:paused;opacity:.45}
    #controls{position:absolute;right:-6px;top:50%;display:flex;align-items:center;gap:2px;padding:4px 4px 4px 36px;background:linear-gradient(to right,#0000,#000 32px);transform:translateY(-50%) scale(.92);transform-origin:right center;opacity:0;visibility:hidden;transition:opacity .18s,transform .28s cubic-bezier(.2,.9,.3,1.3),visibility 0s .18s}
    #side:hover #bars{opacity:0}
    #side:hover #controls{opacity:1;visibility:visible;transform:translateY(-50%);transition-delay:0s}
    button{-webkit-app-region:no-drag;app-region:no-drag;flex:none;display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:#fff;font-family:inherit;font-size:12px;font-weight:600;line-height:1;cursor:pointer;transition:background .15s,transform .15s}
    button:hover{background:#ffffff1f}button:active{transform:scale(.9)}button:focus-visible{outline:2px solid var(--accent)}
    button svg{width:18px;height:18px;fill:currentColor}#play svg{width:22px;height:22px}
    .text{width:28px;color:#ffffffb3}
    #auto{width:36px;border-radius:16px}#auto.on{color:#000;background:var(--accent)}
    #progress{position:absolute;left:14px;right:14px;bottom:5px;height:2px;border-radius:1px;background:var(--accent);transform-origin:left;opacity:0;transition:opacity .2s}
    #island:has(#side:hover) #progress{opacity:.85}
    @media(min-height:150px){#next:not(:empty){display:block}#cover{width:56px;height:56px;border-radius:14px}}
    @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `;
  const MARKUP = `
    <div id="island">
      <div id="cover"></div>
      <div id="lyrics"><div id="line"></div><div id="translation"></div><div id="next"></div></div>
      <div id="side">
        <div id="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div id="controls">
          <button id="auto" class="text" aria-label="播放时自动打开" title="播放音乐时自动打开桌面歌词">自动</button>
          <button id="smaller" class="text" aria-label="缩小字号" title="缩小字号">A−</button>
          <button id="larger" class="text" aria-label="放大字号" title="放大字号">A+</button>
          <button id="prev" aria-label="上一首" title="上一首">${PREV}</button>
          <button id="play" aria-label="播放"></button>
          <button id="nextTrack" aria-label="下一首" title="下一首">${NEXT}</button>
        </div>
      </div>
      <div id="progress"></div>
    </div>`;

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
      // The browser places the window; pages cannot move it (moveTo is disabled for PiP).
      pip = await documentPictureInPicture.requestWindow({ width: 600, height: 96 });
      pip.document.title = 'ivLyrics · 桌面歌词';
      const style = pip.document.createElement('style');
      style.textContent = STYLE;
      pip.document.head.appendChild(style);
      pip.document.documentElement.style.setProperty('--size', `${size}px`);
      pip.document.body.innerHTML = MARKUP;
      nodes = Object.fromEntries(['island', 'cover', 'lyrics', 'line', 'translation', 'next', 'play', 'progress', 'auto'].map(id => [id, pip.document.getElementById(id)]));
      nodes.auto.classList.toggle('on', autoOpen);
      nodes.auto.onclick = () => setAutoOpen(!autoOpen);
      nodes.play.onclick = () => Spicetify.Player.togglePlay();
      pip.document.getElementById('prev').onclick = () => Spicetify.Player.back();
      pip.document.getElementById('nextTrack').onclick = () => Spicetify.Player.next();
      const resize = delta => {
        size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size + delta));
        pip.document.documentElement.style.setProperty('--size', `${size}px`);
        fit();
        try { localStorage.setItem('ivLyrics:desktop:font-size', String(size)); } catch {}
      };
      pip.document.getElementById('smaller').onclick = () => resize(-2);
      pip.document.getElementById('larger').onclick = () => resize(2);
      pip.addEventListener('resize', () => nodes && fit());
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

  function setAutoOpen(value) {
    autoOpen = !!value;
    if (!autoOpen) pendingOpen = false;
    try { localStorage.setItem(AUTO_OPEN_KEY, String(autoOpen)); } catch {}
    nodes?.auto.classList.toggle('on', autoOpen);
    window.dispatchEvent(new CustomEvent('ivLyrics:desktop-auto-open', { detail: autoOpen }));
  }

  // requestWindow needs a user gesture. Playback started from a click or key in
  // Spotify still carries one; media keys or remote devices do not, so the window
  // waits for the next click or key press in Spotify.
  function onPlayPause() {
    const playing = Spicetify.Player.isPlaying();
    if (playing && !wasPlaying && autoOpen && !(pip && !pip.closed)) {
      if (navigator.userActivation?.isActive) void open();
      else pendingOpen = true;
    }
    if (!playing) pendingOpen = false;
    wasPlaying = playing;
  }

  function openFromGesture(event) {
    if (!pendingOpen) return;
    pendingOpen = false;
    // The topbar button toggles the window itself; opening here would make its click close it.
    if (button?.element?.contains?.(event.target)) return;
    if (autoOpen && Spicetify.Player.isPlaying() && !(pip && !pip.closed)) void open();
  }

  window.ivLyricsDesktop = {
    open, close, setAutoOpen,
    get autoOpen() { return autoOpen; },
    getState: () => ({ open: !!pip && !pip.closed, uri, lines: lines.length, active, offset, translation: nodes?.translation.textContent || '', timerActive: timer !== null })
  };
  window.addEventListener('pagehide', close, { once: true });
  const init = () => {
    if (!window.Spicetify?.Topbar?.Button || !window.LyricsService) { setTimeout(init, 300); return; }
    button = new Spicetify.Topbar.Button('桌面歌词（画中画）', ICON, () => {
      if (pip && !pip.closed) close(); else void open();
    });
    Spicetify.Player.addEventListener('onplaypause', onPlayPause);
    window.addEventListener('pointerdown', openFromGesture, true);
    window.addEventListener('keydown', openFromGesture, true);
    onPlayPause();
  };
  init();
})();
