"use strict";

/* ==========================================================
   Fila salva: ao reabrir o app, continua de onde parou
   (música, fila, posição, aleatório e repetir). Volta pausado.
   ========================================================== */
const SAVED_QUEUE_KEY = "savedQueue";
const SAVED_QUEUE_MAX = 3000; // limite de músicas guardadas na fila
let savedQueueRestoring = false;
let lastQueueSave = 0;

function saveQueueState(force) {
  if (savedQueueRestoring || currentId === null || !songs.length) return;
  const now = Date.now();
  if (!force && now - lastQueueSave < 4000) return;
  lastQueueSave = now;

  const dur = audio.duration;
  lsSet(SAVED_QUEUE_KEY, {
    id: currentId,
    queue: queue.slice(0, SAVED_QUEUE_MAX),
    position: Math.max(0, audio.currentTime || 0),
    duration: isFinite(dur) && dur > 0 ? dur : 0,
    shuffle: !!shuffle,
    repeat,
    history: playHistory.slice(-20),
    at: now
  });
}

// salva de tempos em tempos enquanto toca e sempre que o app sai da tela
audio.addEventListener("timeupdate", () => saveQueueState(false));
audio.addEventListener("pause", () => saveQueueState(true));
audio.addEventListener("seeked", () => saveQueueState(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveQueueState(true);
});
window.addEventListener("pagehide", () => saveQueueState(true));

// Apaga a fila salva quando a música dela deixa de existir (ex.: excluída)
function dropSavedQueueIfMissing() {
  const st = lsGet(SAVED_QUEUE_KEY, null);
  if (st && !getSong(st.id)) lsSet(SAVED_QUEUE_KEY, null);
}

async function restoreSavedQueue() {
  const st = lsGet(SAVED_QUEUE_KEY, null);
  if (!st || currentId !== null || !songs.length) return false;

  savedQueueRestoring = true;
  try {
    const valid = new Set(allIds());
    let id = st.id;
    let pos = Number(st.position) || 0;
    let dur = Number(st.duration) || 0;

    // O player nativo guarda a última música e a posição, mesmo se o Android fechou o app
    // enquanto tocava em segundo plano; isso é mais recente que o que o app salvou.
    if (MN && MN.getLastPlayed) {
      try {
        const last = await MN.getLastPlayed();
        if (last && last.id) {
          const found = songs.find(s => String(s.id) === String(last.id));
          if (found && (Number(st.at) || 0) <= Date.now()) {
            if (String(found.id) !== String(id)) dur = 0;
            id = found.id;
            pos = (Number(last.position) || 0) / 1000;
          }
        }
      } catch (e) { logErr("fila-salva:ultima", e); }
    }

    // a música pode ter mudado enquanto a leitura acima esperava
    if (currentId !== null) return false;

    const song = getSong(id);
    if (!song) return false;

    let q = Array.isArray(st.queue) ? st.queue.filter(x => valid.has(x)) : [];
    if (!q.includes(song.id)) q = allIds();

    queue = q;
    shuffle = !!st.shuffle;
    repeat = st.repeat === "all" || st.repeat === "one" ? st.repeat : "off";
    playHistory = Array.isArray(st.history) ? st.history.filter(x => valid.has(x)) : [];
    currentId = song.id;

    if (nativeMode) {
      // Só carrega no player nativo quando você der play (evita iniciar o serviço e copiar
      // arquivo à toa). O NativeAudio já sabe recarregar a música na posição certa.
      audio.loadedId = song.id;
      audio.needsReload = true;
      audio._pos = Math.max(0, pos);
      audio._posAt = 0;
      if (dur > 0) {
        audio.duration = dur;
        audio._gotDuration = true;
      }
    } else {
      audio.src = song.url;
      const seekWhenReady = () => {
        audio.removeEventListener("loadedmetadata", seekWhenReady);
        try { if (pos > 0 && isFinite(audio.duration)) audio.currentTime = Math.min(pos, audio.duration); } catch (e) { logErr("fila-salva:posicao", e); }
      };
      audio.addEventListener("loadedmetadata", seekWhenReady);
    }

    onSongChanged();
    return true;
  } catch (e) {
    logErr("fila-salva:restaurar", e);
    return false;
  } finally {
    savedQueueRestoring = false;
  }
}
