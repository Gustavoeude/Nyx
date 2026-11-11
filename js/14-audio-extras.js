"use strict";

/* ==========================================================
   Temporizador de desligar, equalizador, transição suave
   e leitura de gêneros das músicas já adicionadas
   ========================================================== */

/* ---------- Temporizador de desligar ---------- */
const sleepState = { active: false, endOfTrack: false, endsAt: 0, pending: false, trackId: null };
let sleepPending = null; // { minutes, endOfTrack }: pedido feito antes do player começar a tocar
let sleepJsTimer = 0;    // só usado fora do app Android (navegador/PWA)

function sleepLabel() {
  if (!sleepState.active) return "Desligado";
  if (sleepState.pending) {
    return sleepState.endOfTrack
      ? "Começa quando a música tocar (pausa ao fim dela)"
      : "Começa quando a música tocar (" + sleepPending.minutes + " min)";
  }
  if (sleepState.endOfTrack) return "Pausa ao fim desta música";
  const left = Math.max(1, Math.ceil((sleepState.endsAt - Date.now()) / 60000));
  return "Pausa em " + left + (left === 1 ? " minuto" : " minutos");
}

function refreshSleepUi() {
  if (typeof settingsOpen !== "undefined" && settingsOpen && settingsPage === "reproducao") refreshSettingsPage();
}

function applySleepState(r) {
  sleepState.pending = false;
  sleepState.active = !!(r && r.active);
  sleepState.endOfTrack = !!(r && r.endOfTrack);
  sleepState.endsAt = r && r.remainingMs > 0 ? Date.now() + r.remainingMs : 0;
}

// no navegador (sem player nativo): pausa com um temporizador do próprio app
function sleepFiredJs() {
  clearTimeout(sleepJsTimer);
  sleepState.active = false;
  sleepState.endsAt = 0;
  sleepState.endOfTrack = false;
  try { audio.pause(); } catch (e) { logErr("temporizador:pausa", e); }
  showToast("Temporizador: música pausada.");
  refreshSleepUi();
}

async function refreshSleepState() {
  if (!(MN && nativeMode) || sleepPending) return;
  try {
    const r = await MN.getSleep();
    if (r && !r.idle) applySleepState(r);
  } catch (e) { logErr("temporizador:ler", e); }
}

async function setSleepTimer(minutes, endOfTrack) {
  clearTimeout(sleepJsTimer);
  sleepPending = null;
  const want = minutes > 0 || !!endOfTrack;

  if (MN && nativeMode) {
    let r = null;
    try {
      r = await MN.setSleep({ ms: Math.round((minutes || 0) * 60000), endOfTrack: !!endOfTrack });
    } catch (e) {
      logErr("temporizador:ligar", e);
      showToast("Não consegui ajustar o temporizador.");
      return;
    }
    if (r && r.idle) {
      // nada tocando ainda: guarda o pedido e liga quando a música começar
      if (want) {
        sleepPending = { minutes: minutes || 0, endOfTrack: !!endOfTrack };
        sleepState.active = true;
        sleepState.pending = true;
        sleepState.endOfTrack = !!endOfTrack;
        sleepState.endsAt = 0;
      } else {
        applySleepState(null);
      }
    } else {
      applySleepState(r);
    }
  } else {
    sleepState.pending = false;
    sleepState.active = want;
    sleepState.endOfTrack = !!endOfTrack;
    sleepState.endsAt = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    sleepState.trackId = currentId;
    if (minutes > 0) sleepJsTimer = setTimeout(sleepFiredJs, minutes * 60000);
  }

  if (!want) showToast("Temporizador cancelado");
  else if (endOfTrack) showToast("A música vai pausar quando esta terminar");
  else showToast("A música vai pausar em " + minutes + " minutos");
  refreshSleepUi();
}

// fora do app Android: "ao fim da música" para quando a faixa muda
audio.addEventListener("ended", () => {
  if (MN && nativeMode) return;
  if (sleepState.active && sleepState.endOfTrack && currentId !== sleepState.trackId) sleepFiredJs();
});

if (MN && nativeMode) {
  MN.addListener("sleep", e => {
    applySleepState(e);
    if (e && e.fired) showToast("Temporizador: música pausada.");
    refreshSleepUi();
  });
  // aplica o pedido guardado assim que o player nativo começa a tocar
  MN.addListener("state", st => {
    if (!sleepPending || !st || !st.playing) return;
    const p = sleepPending;
    sleepPending = null;
    setSleepTimer(p.minutes, p.endOfTrack);
  });
}

async function openSleepTimerSheet() {
  await refreshSleepState();
  const actions = [15, 30, 45, 60, 90].map(m => ({
    icon: "bedtime",
    label: m + " minutos",
    run: () => setSleepTimer(m, false)
  }));
  actions.push({ icon: "music_note", label: "Ao fim desta música", run: () => setSleepTimer(0, true) });
  if (sleepState.active) {
    actions.push({ icon: "timer_off", label: "Cancelar temporizador", danger: true, run: () => setSleepTimer(0, false) });
  }
  openSheet("Temporizador de desligar" + (sleepState.active ? " · " + sleepLabel() : ""), actions);
}

/* ---------- Equalizador ---------- */
const EQ_RANGE_DB = 12;
const EQ_PRESETS = [
  { id: "flat", name: "Normal", db: [0, 0, 0, 0, 0], bass: 0 },
  { id: "bass", name: "Graves", db: [6, 4, 0, -1, -2], bass: 0 },
  { id: "treble", name: "Agudos", db: [-3, -1, 0, 3, 6], bass: 0 },
  { id: "vocal", name: "Vocal", db: [-3, -1, 4, 3, -1], bass: 0 },
  { id: "rock", name: "Rock", db: [5, 2, -2, 3, 5], bass: 0 },
  { id: "pop", name: "Pop", db: [-1, 3, 5, 2, -1], bass: 0 },
  { id: "electro", name: "Eletrônica", db: [6, 3, 0, 2, 5], bass: 0 },
  { id: "hiphop", name: "Hip-hop", db: [6, 4, 1, 2, 3], bass: 0 },
  { id: "classical", name: "Clássica", db: [4, 3, -1, 2, 3], bass: 0 },
  { id: "jazz", name: "Jazz", db: [3, 2, -2, 2, 4], bass: 0 }
];

const eqUi = { loaded: false, supported: true, enabled: false, bands: [60, 230, 910, 3600, 14000], db: [0, 0, 0, 0, 0], bass: 0, fadeMs: 0 };
let eqSendTimer = 0;

async function loadAudioFx() {
  if (!MN) return eqUi;
  try {
    const r = await MN.getAudioFx();
    if (r) {
      eqUi.supported = r.supported !== false;
      eqUi.enabled = !!r.enabled;
      eqUi.bass = Math.round(((r.bass || 0) / 1000) * 100);
      eqUi.fadeMs = r.fadeMs || 0;
      if (Array.isArray(r.bands) && r.bands.length === 5) eqUi.bands = r.bands.map(Number);
      if (Array.isArray(r.levels) && r.levels.length === 5) eqUi.db = r.levels.map(v => Math.round(Number(v) / 100));
      eqUi.loaded = true;
    }
  } catch (e) { logErr("equalizador:ler", e); }
  return eqUi;
}

function eqSend(now) {
  clearTimeout(eqSendTimer);
  const go = () => {
    try {
      const r = MN.setEqualizer({
        enabled: eqUi.enabled,
        levels: eqUi.db.map(d => Math.round(d * 100)),
        bass: Math.round(eqUi.bass * 10)
      });
      if (r && r.catch) r.catch(e => logErr("equalizador:enviar", e));
    } catch (e) { logErr("equalizador:enviar", e); }
  };
  if (now) go();
  else eqSendTimer = setTimeout(go, 60);
}

function eqFreqLabel(hz) {
  return hz >= 1000 ? (hz / 1000).toString().replace(".", ",") + " kHz" : hz + " Hz";
}

function eqDbLabel(v) {
  return (v > 0 ? "+" : "") + v + " dB";
}

function eqCurrentPresetId() {
  const p = EQ_PRESETS.find(x => eqUi.bass === 0 && x.db.every((d, i) => d === eqUi.db[i]));
  return p ? p.id : null;
}

function pageEqualizador() {
  const box = el("div", "eq-page");
  const msg = el("div", "set-hint", "Carregando…");
  box.appendChild(msg);

  loadAudioFx().then(() => {
    if (!box.isConnected) return;
    box.replaceChildren();

    if (!eqUi.supported) {
      box.appendChild(el("div", "set-hint", "Este aparelho não oferece equalizador para o player do Nyx."));
      return;
    }

    const body = el("div", "set-sec");
    const sliders = [];
    const chips = [];
    let bassSlider = null;
    let bassLabel = null;

    const paintState = () => {
      body.classList.toggle("eq-off", !eqUi.enabled);
      body.style.opacity = eqUi.enabled ? "" : "0.55";
      const cur = eqCurrentPresetId();
      chips.forEach(({ b, id }) => b.classList.toggle("active", id === cur));
      sliders.forEach(({ slider, label }, i) => {
        slider.value = String(eqUi.db[i]);
        label.textContent = eqDbLabel(eqUi.db[i]);
      });
      if (bassSlider) {
        bassSlider.value = String(eqUi.bass);
        bassLabel.textContent = eqUi.bass + "%";
      }
    };

    // liga/desliga
    const row = el("button", "set-row");
    const text = el("div", "set-row-text");
    text.append(el("strong", "", "Equalizador"), el("span", "", "Ajusta graves, médios e agudos de tudo que toca no Nyx"));
    const sw = el("span", "m3-switch" + (eqUi.enabled ? " on" : ""));
    row.append(text, sw);
    row.onclick = () => {
      eqUi.enabled = !eqUi.enabled;
      sw.classList.toggle("on", eqUi.enabled);
      paintState();
      eqSend(true);
    };
    const top = el("div", "set-sec");
    top.appendChild(row);
    box.appendChild(top);

    // predefinições
    body.appendChild(el("div", "set-label", "Predefinições"));
    const presets = el("div", "filters eq-presets");
    EQ_PRESETS.forEach(p => {
      const b = el("button", "filter", p.name);
      b.type = "button";
      b.onclick = () => {
        eqUi.db = p.db.slice();
        eqUi.bass = p.bass;
        if (!eqUi.enabled) {
          eqUi.enabled = true;
          sw.classList.add("on");
        }
        paintState();
        eqSend(true);
      };
      chips.push({ b, id: p.id });
      presets.appendChild(b);
    });
    body.appendChild(presets);

    // faixas
    body.appendChild(el("div", "set-label", "Faixas de frequência"));
    eqUi.bands.forEach((hz, i) => {
      const r = el("div", "set-row wallpaper-range-row");
      const t = el("div", "set-row-text");
      const label = el("span", "wallpaper-value", eqDbLabel(eqUi.db[i]));
      t.append(el("strong", "", eqFreqLabel(hz)), label);
      const slider = el("input", "wallpaper-range");
      slider.type = "range";
      slider.min = String(-EQ_RANGE_DB);
      slider.max = String(EQ_RANGE_DB);
      slider.step = "1";
      slider.value = String(eqUi.db[i]);
      slider.setAttribute("aria-label", eqFreqLabel(hz));
      slider.oninput = () => {
        eqUi.db[i] = Number(slider.value);
        label.textContent = eqDbLabel(eqUi.db[i]);
        const cur = eqCurrentPresetId();
        chips.forEach(({ b, id }) => b.classList.toggle("active", id === cur));
        eqSend(false);
      };
      slider.onchange = () => eqSend(true);
      r.append(t, slider);
      sliders.push({ slider, label });
      body.appendChild(r);
    });

    // reforço de graves
    body.appendChild(el("div", "set-label", "Reforço de graves"));
    const br = el("div", "set-row wallpaper-range-row");
    const bt = el("div", "set-row-text");
    bassLabel = el("span", "wallpaper-value", eqUi.bass + "%");
    bt.append(el("strong", "", "Graves extras"), bassLabel);
    bassSlider = el("input", "wallpaper-range");
    bassSlider.type = "range";
    bassSlider.min = "0";
    bassSlider.max = "100";
    bassSlider.step = "5";
    bassSlider.value = String(eqUi.bass);
    bassSlider.setAttribute("aria-label", "Reforço de graves");
    bassSlider.oninput = () => {
      eqUi.bass = Number(bassSlider.value);
      bassLabel.textContent = eqUi.bass + "%";
      const cur = eqCurrentPresetId();
      chips.forEach(({ b, id }) => b.classList.toggle("active", id === cur));
      eqSend(false);
    };
    bassSlider.onchange = () => eqSend(true);
    br.append(bt, bassSlider);
    body.appendChild(br);

    // restaurar
    const reset = el("button", "set-row");
    const rt = el("div", "set-row-text");
    rt.append(el("strong", "", "Restaurar"), el("span", "", "Volta todas as faixas para zero"));
    reset.append(rt, el("span", "material-symbols-rounded", "restart_alt"));
    reset.onclick = () => {
      eqUi.db = [0, 0, 0, 0, 0];
      eqUi.bass = 0;
      paintState();
      eqSend(true);
    };
    body.appendChild(reset);

    box.appendChild(body);
    paintState();
  });

  return [box];
}

/* ---------- Transição suave ---------- */
const FADE_OPTIONS = [0, 2000, 4000, 6000, 8000, 12000];

function fadeLabel(ms) {
  return ms > 0 ? ms / 1000 + " segundos" : "Desligada";
}

async function setFadeMs(ms) {
  try {
    await MN.setFade({ ms });
    eqUi.fadeMs = ms;
    showToast(ms > 0 ? "Transição suave: " + fadeLabel(ms) : "Transição suave desligada");
  } catch (e) {
    logErr("transicao:ajustar", e);
    showToast("Não consegui ajustar a transição.");
  }
  refreshSettingsPage();
}

function openFadeSheet() {
  openSheet(
    "Transição suave",
    FADE_OPTIONS.map(ms => ({
      icon: eqUi.fadeMs === ms ? "check" : ms > 0 ? "blur_on" : "block",
      label: fadeLabel(ms),
      run: () => setFadeMs(ms)
    }))
  );
}

/* ---------- Seções da página Reprodução ---------- */
function audioExtrasSections() {
  const out = [];

  const sleepSec = el("div", "set-sec");
  sleepSec.appendChild(el("div", "set-label", "Dormir"));
  const sleepRow = el("button", "set-row");
  const sleepText = el("div", "set-row-text");
  sleepText.append(el("strong", "", "Temporizador de desligar"), el("span", "", sleepLabel()));
  sleepRow.append(sleepText, el("span", "material-symbols-rounded", "bedtime"));
  sleepRow.onclick = openSleepTimerSheet;
  sleepSec.appendChild(sleepRow);
  out.push(sleepSec);
  refreshSleepState().then(() => {
    const label = sleepText.querySelector("span");
    if (label && sleepRow.isConnected) label.textContent = sleepLabel();
  });

  if (MN) {
    const fxSec = el("div", "set-sec");
    fxSec.appendChild(el("div", "set-label", "Som"));

    const eqRow = el("button", "set-row");
    const eqText = el("div", "set-row-text");
    const eqDesc = el("span", "", eqUi.enabled ? "Ligado" : "Desligado");
    eqText.append(el("strong", "", "Equalizador"), eqDesc);
    eqRow.append(eqText, el("span", "material-symbols-rounded", "graphic_eq"));
    eqRow.onclick = () => settingsGo("equalizador");
    fxSec.appendChild(eqRow);

    const fadeRow = el("button", "set-row");
    const fadeText = el("div", "set-row-text");
    const fadeDesc = el("span", "", fadeLabel(eqUi.fadeMs));
    fadeText.append(el("strong", "", "Transição suave"), fadeDesc);
    fadeRow.append(fadeText, el("span", "material-symbols-rounded", "blur_on"));
    fadeRow.onclick = openFadeSheet;
    fxSec.appendChild(fadeRow);

    fxSec.appendChild(el(
      "div",
      "set-hint",
      "A transição suave abaixa o volume no fim de cada música e sobe no começo da próxima. As músicas da fila tocam emendadas, sem pausa entre elas, quando o formato do arquivo permite."
    ));
    out.push(fxSec);

    loadAudioFx().then(() => {
      if (!eqRow.isConnected) return;
      eqDesc.textContent = eqUi.enabled ? "Ligado" : "Desligado";
      fadeDesc.textContent = fadeLabel(eqUi.fadeMs);
    });
  }

  return out;
}

SETTINGS_PAGES.equalizador = { title: "Equalizador", build: pageEqualizador };

/* ---------- Gêneros das músicas já adicionadas ---------- */
let genreScanBusy = false;

function readGenreFromFile(file) {
  return new Promise(resolve => {
    if (!window.jsmediatags || !file) { resolve(""); return; }
    try {
      window.jsmediatags.read(file, {
        onSuccess: r => resolve(cleanGenre(r && r.tags && r.tags.genre)),
        onError: () => resolve("")
      });
    } catch (e) {
      resolve("");
    }
  });
}

async function scanGenres(manual) {
  if (genreScanBusy) return;
  genreScanBusy = true;
  try {
    const todo = songs.filter(s => !s.genre && s.file);
    let found = 0;
    let done = 0;
    for (const song of todo) {
      if (!songs.includes(song)) continue;
      const g = await readGenreFromFile(song.file);
      if (g) {
        song.genre = g;
        found++;
        dbPut(toRecord(song));
      }
      done++;
      if (done % 20 === 0) {
        if (libraryTab === "genres") renderLibrary();
        await new Promise(r => setTimeout(r, 0));
      }
    }
    lsSet("genreScanV1", true);
    if (found && libraryTab === "genres") renderLibrary();
    if (manual) {
      showToast(found
        ? found + (found === 1 ? " música ganhou gênero" : " músicas ganharam gênero")
        : "Nenhum gênero novo encontrado nas etiquetas");
    }
  } catch (e) {
    logErr("generos:ler", e);
    if (manual) showToast("Não consegui ler os gêneros.");
  } finally {
    genreScanBusy = false;
  }
}

// uma vez, em segundo plano, para as músicas que já estavam na biblioteca
function maybeScanGenresOnce() {
  if (lsGet("genreScanV1", false)) return;
  if (!songs.some(s => !s.genre)) return;
  setTimeout(() => scanGenres(false), 2500);
}
