"use strict";

/* ==========================================================
   Player nativo (Android): Media3/ExoPlayer, sem depender do WebView
   ========================================================== */
const MN = (() => {
  try {
    const C = window.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform()) {
      return C.registerPlugin ? C.registerPlugin("MusicaNative") : C.Plugins && C.Plugins.MusicaNative;
    }
  } catch (e) { logErr("player-nativo:12", e); }
  return null;
})();

// Proteção: se o app falhar 2 vezes ao começar a tocar no player nativo, ele se desliga sozinho.
let nativeAutoDisabled = false;
const nativeMode = (() => {
  if (!MN) return false;
  try {
    const saved = lsGet("settings", {});
    if (saved.nativePlayer === false) return false;
    if (lsGet("nativeFail", 0) >= 2) {
      saved.nativePlayer = false;
      lsSet("settings", saved);
      lsSet("nativeFail", 0);
      nativeAutoDisabled = true;
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
})();

// Imita a parte do <audio> que o app usa, para o resto do código não precisar mudar.
class NativeAudio {
  constructor() {
    this._l = {};
    this.paused = true;
    this._pos = 0;
    this._posAt = 0;
    this.duration = NaN;
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
    this.volume = 1;
    this.error = null;
    this.readyState = 0;
    this.loadedId = null;
    this._ended = false;
    this._gotDuration = false;
    this._loadPendingId = null;
    this._loadAutoplay = false;
  }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); }
  removeEventListener(type, fn) { this._l[type] = (this._l[type] || []).filter(f => f !== fn); }
  _emit(type) {
    (this._l[type] || []).slice().forEach(fn => {
      try { fn.call(this, { type, target: this }); } catch (e) { console.error(e); }
    });
  }
  get currentTime() {
    if (!this.paused && this._posAt) return this._pos + ((performance.now() - this._posAt) / 1000) * (this.playbackRate || 1);
    return this._pos;
  }
  set currentTime(v) {
    v = Math.max(0, Number(v) || 0);
    this._pos = v;
    this._posAt = this.paused ? 0 : performance.now();
    try { MN.seek({ position: v * 1000 }); } catch (e) { logErr("player-nativo:68", e); }
    setTimeout(() => this._emit("seeked"), 0);
    this._emit("timeupdate");
  }
  get src() { return ""; }
  set src(_) {} // no modo nativo quem escolhe a música é nativeStart()
  load() {}
  removeAttribute() {
    try { MN.stopPlayer(); } catch (e) { logErr("player-nativo:76", e); }
    this.loadedId = null;
    this._pos = 0;
    this._posAt = 0;
    this.duration = NaN;
    this.setPlaying(false);
    this.needsReload = false;
    this._loadPendingId = null;
  }
  play() {
    if (this.loadedId !== null) {
      // o player nativo foi esvaziado (botão X da notificação): carrega a música de novo
      if (this.needsReload) {
        const song = songs.find(s => String(s.id) === String(this.loadedId));
        if (song) {
          const at = this._pos || 0;
          this.needsReload = false;
          nativeStart(song, true, at);
          return Promise.resolve();
        }
      }
      if (this._loadPendingId !== null && String(this._loadPendingId) === String(this.loadedId)) this._loadAutoplay = true;
      this.setPlaying(true);
      try { MN.play(); } catch (e) { logErr("player-nativo:86", e); }
    }
    return Promise.resolve();
  }
  pause() {
    if (this._loadPendingId !== null && String(this._loadPendingId) === String(this.loadedId)) this._loadAutoplay = false;
    this.setPlaying(false);
    try { if (this.loadedId !== null) MN.pause(); } catch (e) { logErr("player-nativo:92", e); }
  }
  setPlaying(on) {
    if (on && this.paused) {
      this.paused = false;
      this._posAt = performance.now();
      this._emit("play");
      this._emit("playing");
    } else if (!on && !this.paused) {
      this._pos = this.currentTime;
      this.paused = true;
      this._posAt = 0;
      this._emit("pause");
    }
  }
  beginLoad(id, autoplay) {
    this.loadedId = id;
    this.needsReload = false;
    this._loadPendingId = id;
    this._loadAutoplay = !!autoplay;
    this._seenReady = false;
    this._ended = false;
    this._gotDuration = false;
    this.error = null;
    this._pos = 0;
    this._posAt = 0;
    this.duration = NaN;
    this._emit("loadstart");
    this.setPlaying(autoplay);
  }
  loadAutoplay(id, fallback) {
    return this._loadPendingId !== null && String(this._loadPendingId) === String(id)
      ? this._loadAutoplay
      : !!fallback;
  }
  finishLoad(id, failed) {
    if (String(this.loadedId) !== String(id)) return;
    if (failed) this.needsReload = true;
    if (this._loadPendingId !== null && String(this._loadPendingId) === String(id)) this._loadPendingId = null;
  }
  // recebe o estado do player nativo
  apply(st) {
    if (!st) return;

    // Erros de inicialização podem chegar sem ID de faixa. Tratar antes da
    // validação evita deixar a interface presa em "Preparando a música".
    if (st.error) {
      if (st.id && this.loadedId !== null && String(this.loadedId) !== String(st.id)) return;
      this.error = { code: 3 };
      if (this.loadedId !== null) this.finishLoad(this.loadedId, true);
      this._emit("error");
      this.setPlaying(false);
      return;
    }

    if (this.loadedId === null || String(this.loadedId) !== String(st.id)) return;
    const wasPaused = this.paused;
    if (st.state === 3 || st.playing) lsSet("nativeFail", 0); // tocou de verdade: zera a proteção

    if (st.state === 3) this._seenReady = true;
    if (st.state === 2 || st.state === 3) this.needsReload = false;
    else if (st.state === 1 && this._seenReady) this.needsReload = true; // player esvaziado

    const dur = st.duration > 0 ? st.duration / 1000 : NaN;
    if (!(isNaN(dur) && isNaN(this.duration)) && dur !== this.duration) {
      this.duration = dur;
      if (!this._gotDuration && !isNaN(dur)) {
        this._gotDuration = true;
        this._emit("loadedmetadata");
      }
      this._emit("durationchange");
    }

    this._pos = Math.max(0, st.position / 1000);
    this.playbackRate = st.rate || 1;

    if (st.state === 4) {
      // fim da fila nativa
      this._pos = isNaN(dur) ? this._pos : dur;
      this.setPlaying(false);
      this._emit("timeupdate");
      if (!this._ended) {
        this._ended = true;
        this._emit("ended");
      }
      return;
    }

    this._ended = false;
    this.setPlaying(!!st.playing);
    // a posição foi lida no Android um pouco antes de chegar aqui: soma esse atraso
    const lat = st.ts ? Math.min(1500, Math.max(0, Date.now() - st.ts)) : 0;
    this._posAt = this.paused ? 0 : performance.now() - lat;
    if (!wasPaused || !this.paused) this._emit("timeupdate");
  }
}

