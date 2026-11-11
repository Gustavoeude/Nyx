"use strict";

/* ==========================================================
   Mini player
   ========================================================== */
// Ondinha de toque estilo Material
function attachRipple(node) {
  node.classList.add("ripple-host");

  node.addEventListener("pointerdown", e => {
    const r = node.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const dot = el("span", "ripple");
    dot.style.width = dot.style.height = size + "px";
    dot.style.left = e.clientX - r.left - size / 2 + "px";
    dot.style.top = e.clientY - r.top - size / 2 + "px";
    node.appendChild(dot);
    dot.addEventListener("animationend", () => dot.remove());
  });
}

let lastMiniId = null;

function updateMiniPlayer() {
  const box = $("nowPlaying");

  if (songs.length === 0) {
    box.hidden = true;
    lastMiniId = null;
    return;
  }

  box.hidden = false;
  const song = current() || homeMain;
  if (!song) return;

  $("nowTitle").textContent = song.name;
  $("nowArtist").textContent = song.artist;
  $("nowInfo").setAttribute("aria-label", "Abrir player completo: " + song.name);
  setCover($("nowCover"), song.cover);
  $("nowLyrics").classList.toggle("has-lyrics", !!song.lyrics);
  $("nowLyrics").setAttribute("aria-label", song.lyrics ? "Mostrar letra disponível" : "Abrir e buscar a letra");

  // animação da capa só quando a música muda
  if (lastMiniId !== null && lastMiniId !== song.id) {
    const cover = $("nowCover");
    cover.classList.remove("pop");
    void cover.offsetWidth;
    cover.classList.add("pop");
    setTimeout(() => cover.classList.remove("pop"), 450);
  }
  lastMiniId = song.id;
}

attachRipple($("nowPlaying"));

$("nowPlaying").addEventListener("click", e => {
  if (e.target.closest("#nowPlay, #nowLyrics")) return;

  if (!current() && homeMain) playSong(homeMain.id, allIds());
  openFullPlayer();
});

$("nowLyrics").addEventListener("click", e => {
  e.stopPropagation();
  if (!current() && homeMain) playSong(homeMain.id, allIds());
  const song = current();
  if (!song) return;
  lyricsView = true;
  $("fpStage").classList.add("lyrics-on");
  renderLyrics(song);
  openFullPlayer();
  startLyricsSyncLoop();
  if (!song.lyrics) requestOnlineLyrics(song, true);
});

$("nowPlay").addEventListener("click", e => {
  e.stopPropagation();
  togglePlay();
});

$("contNext").addEventListener("click", () => {
  if (!current() && homeMain) playSong(homeMain.id, allIds());
  else playNext();
});

$("contWave").addEventListener("click", e => {
  const d = audio.duration;
  if (!d || !isFinite(d)) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * d;
  updateProgress();
});

$("heroPlay").addEventListener("click", () => {
  if (!current() && homeMain) playSong(homeMain.id, allIds());
  else togglePlay();
});

function updatePlayButtons() {
  const playing = !audio.paused && currentId !== null;
  const icon = playing ? "pause" : "play_arrow";

  setIcon($("heroPlay"), icon);
  setIcon($("nowPlay"), icon);
  setIcon($("fpPlay"), icon);

  $("heroPlay").classList.toggle("playing", playing);
  $("fpPlay").classList.toggle("playing", playing);

  // usado pelas animações (capa girando, bolhas, etc.)
  document.body.classList.toggle("is-playing", playing);
}

/* ==========================================================
   Reprodução
   ========================================================== */
function playSong(id, context, back) {
  const song = getSong(id);
  if (!song) return;

  if (context) queue = context.slice();
  else if (!queue.includes(id)) queue = allIds();

  if (!back && currentId !== null && currentId !== id) {
    playHistory.push(currentId);
    if (playHistory.length > 50) playHistory.shift();
  }

  currentId = id;
  song.playCount += 1;
  song.lastPlayed = Date.now();
  dbPut(toRecord(song));

  if (nativeMode) nativeStart(song, true);
  else {
    audio.src = song.url;
    playAudio();
  }

  onSongChanged();
}

function onSongChanged() {
  lrcActive = -1;
  updateHome();
  updatePlayButtons();
  updateMediaSession();
  updateFullPlayer();
  renderLyrics(current());
  renderAll();
  updateColor();
  updateProgress();
}

function refreshAll() {
  updateHome();
  renderAll();
  updatePlayButtons();
  if (current()) updateFullPlayer();
  updateColor();
}

function togglePlay() {
  if (currentId === null) {
    const first = homeMain || songs[0];
    if (first) playSong(first.id, allIds());
    return;
  }

  if (audio.paused) {
    playAudio();
  } else {
    audio.pause();
  }
}

function pickNext(auto) {
  if (queue.length === 0) return null;
  if (repeat === "one" && auto) return currentId;

  const idx = queue.indexOf(currentId);

  if (shuffle) {
    if (queue.length === 1) return queue[0];
    let n;
    do {
      n = queue[Math.floor(Math.random() * queue.length)];
    } while (n === currentId);
    return n;
  }

  if (idx === -1) return queue[0];
  if (idx < queue.length - 1) return queue[idx + 1];
  return repeat === "all" || !auto ? queue[0] : null;
}

function playNext() {
  const next = pickNext(false);
  if (next !== null) playSong(next);
}

function playPrev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  while (playHistory.length) {
    const id = playHistory.pop();
    if (getSong(id)) {
      playSong(id, null, true);
      return;
    }
  }

  const idx = queue.indexOf(currentId);
  if (idx > 0) playSong(queue[idx - 1], null, true);
  else if (queue.length > 1 && repeat === "all") playSong(queue[queue.length - 1], null, true);
  else audio.currentTime = 0;
}

audio.addEventListener("play", () => {
  updatePlayButtons();
  renderAll();
  updateMediaState();
});

audio.addEventListener("pause", () => {
  updatePlayButtons();
  renderAll();
  updateMediaState();
});

let lastPlaybackNotice = 0;
function notifyPlaybackProblem(message) {
  const now = Date.now();
  if (now - lastPlaybackNotice < 1800) return;
  lastPlaybackNotice = now;
  showToast(message);
}

audio.addEventListener("error", () => {
  if (!current()) return;
  const code = audio.error ? audio.error.code : 0;
  if (code === 1) return;
  let message = "Ocorreu um erro ao ler o arquivo de áudio.";
  if (code === 2) message = "Falha ao carregar os dados do arquivo de áudio.";
  else if (code === 3) message = "Não consegui decodificar este arquivo de áudio.";
  else if (code === 4) message = "Este formato não é compatível com o navegador.";
  updatePlayButtons();
  updateMediaState();
  notifyPlaybackProblem(message);
});

audio.addEventListener("ended", () => {
  const next = pickNext(true);

  if (next === null) {
    audio.pause();
    return;
  }

  if (next === currentId) {
    audio.currentTime = 0;
    playAudio();
  } else {
    playSong(next);
  }
});

audio.addEventListener("loadedmetadata", () => {
  updateProgress();
  updatePositionState();
});
audio.addEventListener("durationchange", () => updateProgress());
audio.addEventListener("timeupdate", () => updateProgress());

// mantém a barra da notificação em dia (a cada poucos segundos, pra gastar pouco)
let lastPosUpdate = 0;
audio.addEventListener("timeupdate", () => {
  const now = Date.now();
  if (now - lastPosUpdate > 2000) {
    lastPosUpdate = now;
    updatePositionState();
  }
});
audio.addEventListener("seeked", updatePositionState);
audio.addEventListener("playing", () => {
  updateMediaState();
  updatePositionState();
});

/* ---------- Media Session (notificação / tela de bloqueio) ---------- */
/* ----- Reprodução em segundo plano (só no app Android) -----
   No APK, o plugin nativo "MusicaNative" mantém um serviço em primeiro plano com a
   notificação de mídia. No navegador/PWA ele não existe e nada disso roda. */
function nativeMediaSession() {
  return MN;
}

const nativeState = { title: "", artist: "", playing: false, duration: 0, rate: 1 };
let nativeTimer = 0;
let nativeCover = "";
let nativeCoverDirty = false;
let nativeAskedNotif = false;

function sendNative() {
  if (!MN) return;
  const payload = {
    title: nativeState.title,
    artist: nativeState.artist,
    playing: nativeState.playing,
    position: audio.currentTime || 0,
    duration: nativeState.duration,
    rate: audio.playbackRate || 1
  };
  if (nativeCoverDirty) {
    payload.cover = nativeCover;
    nativeCoverDirty = false;
  }
  try {
    const r = MN.update(payload);
    if (r && r.catch) r.catch(() => {});
  } catch (e) { logErr("reproducao:311", e); }
}

// capa quadrada (JPEG 640px em base64) para a notificação e a tela de bloqueio
function nativeCoverFor(song) {
  if (!song.cover) return Promise.resolve("");
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 640;
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const x = c.getContext("2d");
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = "high";
        const k = Math.max(size / img.width, size / img.height);
        x.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k);
        resolve(c.toDataURL("image/jpeg", 0.92).split(",")[1] || "");
      } catch (_) {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = song.cover;
  });
}

function callNativeMedia(method, payload) {
  if (!MN || nativeMode) return;

  if (method === "setMetadata") {
    nativeState.title = payload.title;
    nativeState.artist = payload.artist;
    nativeState.duration = 0;
    nativeCover = "";
    nativeCoverDirty = true;
    const song = current();
    if (song) {
      const id = song.id;
      nativeCoverFor(song).then(b64 => {
        if (currentId !== id) return;
        nativeCover = b64;
        nativeCoverDirty = true;
        sendNative();
      });
    }
  } else if (method === "setPlaybackState") {
    nativeState.playing = payload.playbackState === "playing";
    if (nativeState.playing && !nativeAskedNotif) {
      nativeAskedNotif = true;
      try {
        const request = MN.requestNotifications();
        if (request && request.then) request.then(result => {
          if (result && result.granted === false) showToast("Permita notificações para ver os controles de música na tela de bloqueio.");
        }).catch(e => logErr("reproducao:362", e));
      } catch (e) { logErr("reproducao:362", e); }
    }
  } else if (method === "setPositionState") {
    nativeState.duration = payload.duration;
  }

  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(sendNative, 80);
}

// botões da notificação, da tela de bloqueio e dos fones
// Eventos do Android que ficaram esperando com o app congelado chegam todos juntos ao reabrir.
// Toques antigos são descartados (senão passam várias músicas de uma vez) e o estado real é relido.
const NATIVE_EVENT_MAX_AGE_MS = 2000;
function isStaleNativeEvent(e) {
  return !!(e && typeof e.ts === "number" && Date.now() - e.ts > NATIVE_EVENT_MAX_AGE_MS);
}

if (MN && MN.addListener) {
  MN.addListener("action", e => {
    if (isStaleNativeEvent(e)) {
      if (nativeMode) nativeResync(false);
      return;
    }
    switch (e && e.action) {
      case "play":
        if (currentId === null) togglePlay();
        else playAudio();
        break;
      case "pause":
        audio.pause();
        break;
      case "next":
        playNext();
        break;
      case "previous":
        playPrev();
        break;
      case "seek":
        if (typeof e.position === "number") {
          audio.currentTime = e.position;
          updatePositionState();
        }
        break;
    }
  });
}

/* ----- Player nativo: copiar arquivos, fila e eventos ----- */
const nativeFiles = new Map(); // id -> { path, size }
const nativeCopyJobs = new Map();
const nativeCovers = new Map(); // id -> { url, path }
const NATIVE_CACHE_BYTES = 2e9; // limite de espaço das músicas copiadas
const NATIVE_LOOKAHEAD = 30; // quantas próximas músicas ficam na fila do player nativo
let nativeToken = 0;
let nativeUpTimer = 0;

function nativeExt(file) {
  const m = /\.([a-z0-9]{1,5})$/i.exec((file && file.name) || "");
  return m ? m[1].toLowerCase() : "audio";
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const t = String(r.result);
      resolve(t.slice(t.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// copia a música para a pasta privada do app (só na primeira vez; depois reaproveita)
function nativeEnsureFile(song) {
  const key = String(song.id);
  const known = nativeFiles.get(key);
  if (known && known.size === song.file.size) return Promise.resolve(known);
  if (nativeCopyJobs.has(key)) return nativeCopyJobs.get(key);

  const job = (async () => {
    const size = song.file.size;
    const ext = nativeExt(song.file);
    const has = await MN.hasFile({ id: key, ext, size });
    if (has && has.exists) {
      const info = { path: has.path, size };
      nativeFiles.set(key, info);
      return info;
    }
    const CHUNK = 768 * 1024;
    let off = 0;
    let last = null;
    do {
      const end = Math.min(size, off + CHUNK);
      const data = await blobToB64(song.file.slice(off, end));
      last = await MN.writeChunk({ id: key, ext, data, first: off === 0, done: end >= size });
      off = end;
    } while (off < size);
    const info = { path: last.path, size };
    nativeFiles.set(key, info);
    return info;
  })().finally(() => nativeCopyJobs.delete(key));

  nativeCopyJobs.set(key, job);
  return job;
}

async function nativeEnsureCover(song) {
  if (!song.cover) return "";
  const key = String(song.id);
  const c = nativeCovers.get(key);
  if (c && c.url === song.cover) return c.path;
  const b64 = await nativeCoverFor(song);
  if (!b64) return "";
  const r = await MN.putCover({ id: key, data: b64 });
  nativeCovers.set(key, { url: song.cover, path: r.path });
  return r.path;
}

async function nativeItem(song) {
  const info = await nativeEnsureFile(song);
  let cover = "";
  try { cover = await nativeEnsureCover(song); } catch (e) { logErr("reproducao:473", e); }
  return { id: String(song.id), path: info.path, title: song.name || "Música", artist: song.artist || "", cover };
}

async function nativeStart(song, autoplay, startAt) {
  const token = ++nativeToken;
  lsSet("nativeFail", (lsGet("nativeFail", 0) || 0) + 1);
  audio.beginLoad(song.id, autoplay);
  const slow = setTimeout(() => showToast("Preparando a música…"), 700);
  try {
    const item = await nativeItem(song);
    if (token !== nativeToken) return;
    await MN.setQueue({
      items: [item],
      autoplay,
      position: Math.max(0, Math.round((startAt || 0) * 1000)),
      repeatOne: repeat === "one" || (repeat === "all" && queue.length === 1)
    });
    nativeRefreshUpcoming();
  } catch (e) {
    if (token !== nativeToken) return;
    console.error(e);
    lsSet("nativeFail", 0); // falha tratada (sem travar o app) não conta para a proteção
    audio.pause();
    notifyPlaybackProblem("Não consegui preparar esta música para o player nativo.");
  } finally {
    clearTimeout(slow);
  }
}

// as próximas músicas ficam na fila do player nativo: tocam mesmo com o app congelado
function upcomingIds(n) {
  if (!queue.length || currentId === null) return [];
  if (shuffle) {
    const pool = queue.filter(id => id !== currentId);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }
  const idx = queue.indexOf(currentId);
  const out = [];
  for (let k = 1; k <= n; k++) {
    let i = idx === -1 ? k - 1 : idx + k;
    if (i >= queue.length) {
      if (repeat === "all") i = i % queue.length;
      else break;
    }
    out.push(queue[i]);
  }
  return out;
}

function nativeRefreshUpcoming() {
  if (!nativeMode) return;
  clearTimeout(nativeUpTimer);
  nativeUpTimer = setTimeout(nativePushUpcoming, 250);
}

async function nativePushUpcoming() {
  const cur = current();
  if (!cur) return;
  const startId = currentId;
  try {
    if (repeat === "one" || (repeat === "all" && queue.length === 1)) {
      await MN.setUpcoming({ afterId: String(startId), items: [], repeatOne: true });
      return;
    }
    // Fila longa: com o app em segundo plano o JavaScript fica congelado e não consegue
    // reabastecer; se a fila nativa acabar, "próxima" e o fim da música deixam de funcionar.
    const ids = upcomingIds(NATIVE_LOOKAHEAD);
    const items = [];
    let sent = 0;
    for (const id of ids) {
      const s = getSong(id);
      if (!s || !s.file) continue;
      items.push(await nativeItem(s));
      if (currentId !== startId) return; // a música mudou no meio: um novo envio já foi agendado
      // envia logo as primeiras para a próxima música já estar pronta; o resto entra depois
      if (sent === 0 && items.length === 5) {
        await MN.setUpcoming({ afterId: String(startId), items: items.slice(), repeatOne: false });
        sent = items.length;
      }
    }
    if (items.length > sent) {
      await MN.setUpcoming({ afterId: String(startId), items, repeatOne: false });
    }
    MN.trim({ maxBytes: NATIVE_CACHE_BYTES, keep: [startId, ...ids].map(String) });
  } catch (e) {
    console.error(e);
  }
}

// o player nativo passou sozinho para outra música (ou o app acordou depois de congelar)
function onNativeTransition(idStr, silent) {
  const song = songs.find(s => String(s.id) === String(idStr));
  if (!song || song.id === currentId) return;
  const wentBack = playHistory.length && playHistory[playHistory.length - 1] === song.id;
  if (wentBack) playHistory.pop();
  else if (currentId !== null) {
    playHistory.push(currentId);
    if (playHistory.length > 50) playHistory.shift();
  }
  if (!queue.includes(song.id)) queue = allIds();
  currentId = song.id;
  if (!silent && !wentBack) {
    song.playCount += 1;
    song.lastPlayed = Date.now();
    dbPut(toRecord(song));
  }
  audio.loadedId = song.id;
  audio._ended = false;
  audio._gotDuration = false;
  onSongChanged();
  nativeRefreshUpcoming();
}

async function nativeResync(silent) {
  try {
    const st = await MN.getState();
    if (!st || !st.id) return;
    if (String(st.id) !== String(currentId)) onNativeTransition(st.id, silent);
    audio.apply(st);
  } catch (e) { logErr("reproducao:587", e); }
}

if (nativeMode) {
  MN.addListener("state", st => audio.apply(st));
  MN.addListener("transition", e => {
    if (isStaleNativeEvent(e)) { nativeResync(false); return; }
    onNativeTransition(e && e.id);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) nativeResync(false);
  });
}

function updateMediaSession() {
  const song = current();
  if (!song) return;

  const type = (song.coverBlob && song.coverBlob.type) || "image/jpeg";
  const art = song.cover
    ? ["96x96", "128x128", "192x192", "256x256", "384x384", "512x512"].map(sizes => ({
        src: song.cover, sizes, type
      }))
    : [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }];

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name, artist: song.artist, album: "Música", artwork: art
      });
    } catch (e) { logErr("reproducao:614", e); }
  }

  callNativeMedia("setMetadata", {
    title: song.name || "Música",
    artist: song.artist || "Artista desconhecido",
    album: "Música",
    artwork: art
  });
}

function updateMediaState() {
  const state = audio.paused ? "paused" : "playing";
  if ("mediaSession" in navigator) {
    try { navigator.mediaSession.playbackState = state; } catch (_) {}
  }
  callNativeMedia("setPlaybackState", { playbackState: state });
}

function updatePositionState() {
  if (!isFinite(audio.duration) || audio.duration <= 0) return;
  const position = Math.min(audio.currentTime || 0, audio.duration);
  const playbackRate = audio.playbackRate || 1;

  if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration, playbackRate, position
      });
    } catch (e) { logErr("reproducao:643", e); }
  }

  callNativeMedia("setPositionState", {
    duration: audio.duration, playbackRate, position
  });
}

function playAudio() {
  let result;
  try { result = audio.play(); }
  catch (error) { notifyPlayRejected(error); return; }
  if (result && result.catch) result.catch(notifyPlayRejected);
}

function notifyPlayRejected(error) {
  if (error && error.name === "AbortError") return;
  if (error && error.name === "NotAllowedError") {
    notifyPlaybackProblem("O navegador bloqueou a reprodução. Toque novamente em reproduzir.");
  } else if (error && error.name === "NotSupportedError") {
    notifyPlaybackProblem("Este formato não é compatível com o navegador.");
  } else {
    notifyPlaybackProblem("Não foi possível iniciar a reprodução desta música.");
  }
}

function initMediaSessionHandlers() {
  const hasWeb = "mediaSession" in navigator;
  if (!hasWeb) return;

  const handlers = {
    play: () => {
      if (currentId === null) togglePlay();
      else playAudio();
    },
    pause: () => audio.pause(),
    stop: () => { audio.pause(); audio.currentTime = 0; },
    previoustrack: playPrev,
    nexttrack: playNext,
    seekbackward: d => {
      audio.currentTime = Math.max(0, audio.currentTime - ((d && d.seekOffset) || 10));
      updatePositionState();
    },
    seekforward: d => {
      const t = audio.currentTime + ((d && d.seekOffset) || 10);
      audio.currentTime = isFinite(audio.duration) ? Math.min(audio.duration, t) : t;
      updatePositionState();
    },
    seekto: d => {
      if (d && typeof d.seekTime === "number") {
        audio.currentTime = d.seekTime;
        updatePositionState();
      }
    }
  };

  Object.keys(handlers).forEach(name => {
    if (hasWeb) {
      try { navigator.mediaSession.setActionHandler(name, handlers[name]); } catch (_) {}
    }
  });
}
