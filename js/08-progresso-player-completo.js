"use strict";

/* ==========================================================
   Progresso
   ========================================================== */
function updateProgress() {
  const d = audio.duration;
  const t = audio.currentTime || 0;
  const pct = d && isFinite(d) ? (t / d) * 100 : 0;

  $("miniProgress").style.width = pct + "%";
  const cw = $("contWave");
  if (cw) {
    cw.style.setProperty("--pct", pct + "%");
    $("contTime").textContent = fmt(t) + " / " + fmt(d);
  }

  if (!seeking) {
    const seek = $("seek");
    seek.value = pct * 10;
    seek.style.setProperty("--pct", pct + "%");
    $("curTime").textContent = fmt(t);
  }

  $("durTime").textContent = fmt(d);
  syncLyrics(t);
}

/* ----- Barra de progresso ondulada (Material 3 Expressive) ----- */
const wave = { cv: $("waveCanvas"), ctx: null, raf: 0, last: 0, phase: 0, amp: 0, frame: 0, primary: "#a8c7fa", track: "#333" };

function startWave() {
  if (!wave.cv || !wave.cv.getContext) return;
  if (!wave.ctx) wave.ctx = wave.cv.getContext("2d");
  if (!wave.ctx) return;
  $("seekWrap").classList.add("wave-on");
  if (!wave.raf) wave.raf = requestAnimationFrame(drawWave);
}

function drawWave(ts) {
  if (!fpOpen) { wave.raf = 0; return; }
  wave.raf = requestAnimationFrame(drawWave);

  const cv = wave.cv;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;

  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }

  const dt = Math.min(0.05, (ts - (wave.last || ts)) / 1000);
  wave.last = ts;

  if (wave.frame++ % 20 === 0) {
    const cs = getComputedStyle(document.body);
    wave.primary = cs.getPropertyValue("--md-primary").trim() || wave.primary;
    wave.track = cs.getPropertyValue("--md-surface-container-highest").trim() || wave.track;
  }

  const playing = !audio.paused && !seeking;
  wave.amp += ((playing ? 3.6 : 0) - wave.amp) * Math.min(1, dt * 7);
  wave.phase += dt * (playing ? 4.2 : 1.2);

  const ctx = wave.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const p = Math.max(0, Math.min(1, Number($("seek").value) / 1000));
  const x0 = 4, x1 = w - 4;
  const tx = x0 + (x1 - x0) * p;
  const cy = h / 2;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;

  // parte que falta: linha reta
  if (tx + 9 < x1) {
    ctx.strokeStyle = wave.track;
    ctx.beginPath();
    ctx.moveTo(tx + 9, cy);
    ctx.lineTo(x1, cy);
    ctx.stroke();
  }

  // parte tocada: onda
  const end = tx - 7;
  if (end > x0) {
    ctx.strokeStyle = wave.primary;
    ctx.beginPath();
    for (let x = x0; x <= end; x += 1.5) {
      const edge = Math.min(1, (x - x0) / 14, (end - x) / 14 + 0.15);
      const y = cy + Math.sin((x / 30) * Math.PI * 2 - wave.phase) * wave.amp * Math.max(0, edge);
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // marcador
  ctx.fillStyle = wave.primary;
  const th = seeking ? 28 : 24;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(tx - 2.5, cy - th / 2, 5, th, 2.5);
  else ctx.rect(tx - 2.5, cy - th / 2, 5, th);
  ctx.fill();
}

$("seek").addEventListener("input", () => {
  seeking = true;
  const seek = $("seek");
  const d = audio.duration || 0;
  seek.style.setProperty("--pct", seek.value / 10 + "%");
  $("curTime").textContent = fmt((seek.value / 1000) * d);
});

$("seek").addEventListener("change", () => {
  const seek = $("seek");
  if (audio.duration && isFinite(audio.duration)) {
    audio.currentTime = (seek.value / 1000) * audio.duration;
  }
  seeking = false;
  updatePositionState();
});

/* ==========================================================
   Player completo
   ========================================================== */
function updateFullPlayer() {
  const navSh = $("navShuffle");
  if (navSh) {
    navSh.classList.toggle("on", shuffle);
    navSh.setAttribute("aria-pressed", String(shuffle));
    navSh.setAttribute("aria-label", shuffle ? "Aleatório ligado" : "Aleatório desligado");
  }

  const song = current();
  if (!song) return;

  $("fpTitle").textContent = song.name || "Sem título";
  $("fpArtist").textContent = song.artist || "Artista desconhecido";
  setCover($("fpCover"), song.cover);

  setIcon($("fpFav"), song.favorite ? "favorite" : "favorite_border");
  $("fpFav").classList.toggle("active", song.favorite);
  setFavoriteControl($("fpFav"), song);

  const sh = $("fpShuffle");
  sh.classList.toggle("on", shuffle);
  sh.setAttribute("aria-pressed", String(shuffle));
  sh.setAttribute("aria-label", shuffle ? "Aleatório ligado" : "Aleatório desligado");

  const rep = $("fpRepeat");
  rep.classList.toggle("on", repeat !== "off");
  setIcon(rep, repeat === "one" ? "repeat_one" : "repeat");
  rep.setAttribute("aria-pressed", String(repeat !== "off"));
  rep.setAttribute("aria-label", repeat === "one" ? "Repetir esta música" : repeat === "all" ? "Repetir lista" : "Repetir desligado");

  $("fpLyricsBtn").classList.toggle("on", lyricsView);
  $("fpLyricsBtn").setAttribute("aria-pressed", String(lyricsView));
  $("fpLyricsBtn").setAttribute("aria-label", lyricsView ? "Ocultar letra" : "Mostrar letra");

  // fundo desfocado com a capa
  $("fullPlayer").style.setProperty("--fp-bg", song.cover ? 'url("' + song.cover + '")' : "none");
}

let fpReturnFocus = null;

function openFullPlayer() {
  if (!current()) return;

  updateFullPlayer();
  $("fullPlayer").classList.add("open");
  $("fullPlayer").setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");

  if (!fpOpen) {
    fpReturnFocus = document.activeElement;
    try {
      history.pushState({ fp: 1 }, "");
    } catch (e) { logErr("progresso-player-completo:166", e); }
  }

  fpOpen = true;
  startWave();
  requestAnimationFrame(() => $("fpClose").focus());
  if (lyricsView) requestAnimationFrame(scrollLyricsToActive);
}

function closeFullPlayer(fromPop) {
  if (!fpOpen) return;
  const returnFocus = fpReturnFocus;
  fpReturnFocus = null;
  fpOpen = false;

  $("fullPlayer").classList.remove("open");
  $("fullPlayer").setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");

  if (!fromPop) {
    try {
      if (history.state && history.state.fp) history.back();
    } catch (e) { logErr("progresso-player-completo:188", e); }
  }
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
}

window.addEventListener("popstate", () => {
  if (fpOpen) closeFullPlayer(true);
});

$("fpClose").onclick = () => closeFullPlayer();
$("fpPlay").onclick = togglePlay;
$("fpPrev").onclick = playPrev;
$("fpNext").onclick = playNext;

$("fpFav").onclick = () => {
  const song = current();
  if (song) toggleFavorite(song);
};

$("fpShuffle").onclick = () => {
  shuffle = !shuffle;
  nativeRefreshUpcoming();
  updateFullPlayer();
  showToast(shuffle ? "Aleatório ligado" : "Aleatório desligado");
};

// Botão de aleatório da barra de navegação: liga/desliga e, sem nada tocando, começa uma música ao acaso
$("navShuffle").onclick = () => {
  if (!songs.length) {
    openFilePicker();
    return;
  }
  if (!current()) {
    shuffle = true;
    const pickId = songs[Math.floor(Math.random() * songs.length)].id;
    playSong(pickId, allIds());
    updateFullPlayer();
    showToast("Aleatório ligado");
    return;
  }
  shuffle = !shuffle;
  nativeRefreshUpcoming();
  updateFullPlayer();
  showToast(shuffle ? "Aleatório ligado" : "Aleatório desligado");
};

$("fpRepeat").onclick = () => {
  repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
  nativeRefreshUpcoming();
  updateFullPlayer();
  showToast(
    repeat === "off"
      ? "Repetir desligado"
      : repeat === "all"
      ? "Repetindo a lista"
      : "Repetindo esta música"
  );
};

$("fpMenu").onclick = () => {
  const song = current();
  if (song) openSongMenu(song, { player: true });
};

$("fpLyricsBtn").onclick = () => {
  lyricsView = !lyricsView;
  $("fpStage").classList.toggle("lyrics-on", lyricsView);
  updateFullPlayer();
  if (lyricsView) {
    const song = current();
    if (song && !song.lyrics) requestOnlineLyrics(song, true);
    requestAnimationFrame(scrollLyricsToActive);
  }
};
