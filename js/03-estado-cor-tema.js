"use strict";

/* ==========================================================
   Estado
   ========================================================== */
const audio = nativeMode ? new NativeAudio() : $("audio");
const fileInput = $("fileInput");
const lrcInput = $("lrcInput");

const songs = [];
let currentId = null;
let queue = [];
let playHistory = [];
let shuffle = false;
let repeat = "off"; // off | all | one
let libraryFilter = "all"; // all | fav | id de playlist
let libraryTab = "songs"; // songs | albums | artists | genres
let libraryGroup = null; // { type, key } ao abrir um álbum/artista
let playlists = lsGet("playlists", []);
let mixMode = lsGet("mixMode", "plays"); // plays | recent
let manualTheme = lsGet("manualTheme", null);
if (manualTheme !== "light" && manualTheme !== "dark") manualTheme = "dark";
let seeking = false;
let lyricsView = false;
let fpOpen = false;
let homeMain = null;
let lrcTargetId = null;
let seed = { h: 173, s: 0.78 };
let settings = Object.assign(
  { accent: "auto", amoled: false, disc: false, name: "", shapes: {}, swipe: true, swipeInvert: false, font: "roboto", autoLyrics: true, autoCovers: true, nativePlayer: true, language: "auto", wallpaper: null, wallpaperOpacity: 0.28, wallpaperBlur: 0 },
  lsGet("settings", {})
);
if (!settings.shapes || typeof settings.shapes !== "object") settings.shapes = {};

function saveSettings() {
  lsSet("settings", settings);
}

const getSong = id => songs.find(s => s.id === id) || null;
const current = () => getSong(currentId);
const allIds = () => songs.map(s => s.id);

function savePlaylists() {
  lsSet("playlists", playlists);
}

/* ==========================================================
   Cor dinâmica (Material 3) — extraída da capa
   ========================================================== */
const DEFAULT_SEED = { h: 84, s: 0.78 }; // lima expressivo até uma capa fornecer sua cor dinâmica
const rootStyle = document.documentElement.style;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }

  return [h, s, l];
}

function extractSeed(url) {
  return new Promise(resolve => {
    const img = new Image();

    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const weight = new Array(36).fill(0);
        const satSum = new Array(36).fill(0);

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          if (l < 0.12 || l > 0.92) continue;
          const w = s * (1 - Math.abs(2 * l - 1));
          const bin = Math.floor(h / 10) % 36;
          weight[bin] += w;
          satSum[bin] += s * w;
        }

        let best = 0;
        for (let i = 1; i < 36; i++) {
          if (weight[i] > weight[best]) best = i;
        }

        if (weight[best] < 0.8) {
          resolve({ h: 220, s: 0.06 }); // capa praticamente cinza
          return;
        }

        resolve({
          h: best * 10 + 5,
          s: Math.min(0.75, Math.max(0.3, satSum[best] / weight[best]))
        });
      } catch {
        resolve(DEFAULT_SEED);
      }
    };

    img.onerror = () => resolve(DEFAULT_SEED);
    img.src = url;
  });
}

function hsl(h, s, l) {
  return "hsl(" + h + " " + s + "% " + l + "%)";
}

function applyPalette() {
  const light = document.body.classList.contains("light");
  const h = Math.round(seed.h);
  const sat = Math.round(Math.min(Math.max(seed.s, 0.04), 0.8) * 100);
  const set = (name, value) => rootStyle.setProperty(name, value);
  const hue = offset => ((h + offset) % 360 + 360) % 360;
  const surfaceHue = hue(180);
  const secondaryHue = hue(190);
  const tertiaryHue = hue(265);
  const primaryChroma = Math.round(Math.min(88, Math.max(18, sat * 0.92)));
  const secondaryChroma = Math.round(Math.min(62, Math.max(26, sat * 0.62)));
  const tertiaryChroma = Math.round(Math.min(74, Math.max(38, sat * 0.76)));

  if (!light) {
    set("--md-primary", hsl(h, primaryChroma, 68));
    set("--md-on-primary", hsl(h, Math.round(primaryChroma * 0.24), 11));
    set("--md-primary-container", hsl(h, Math.round(primaryChroma * 0.62), 19));
    set("--md-on-primary-container", hsl(h, Math.max(34, Math.round(primaryChroma * 0.76)), 93));
    set("--md-secondary", hsl(secondaryHue, secondaryChroma, 77));
    set("--md-on-secondary", hsl(secondaryHue, Math.round(secondaryChroma * 0.28), 11));
    set("--md-secondary-container", hsl(secondaryHue, Math.round(secondaryChroma * 0.5), 16));
    set("--md-on-secondary-container", hsl(secondaryHue, Math.min(82, Math.round(secondaryChroma * 1.18)), 92));
    set("--md-tertiary", hsl(tertiaryHue, tertiaryChroma, 71));
    set("--md-on-tertiary", hsl(tertiaryHue, Math.round(tertiaryChroma * 0.25), 11));
    set("--md-tertiary-container", hsl(tertiaryHue, Math.round(tertiaryChroma * 0.48), 18));
    set("--md-on-tertiary-container", hsl(tertiaryHue, Math.round(tertiaryChroma * 0.9), 93));
    const am = settings.amoled;
    set("--md-surface", am ? "#000000" : hsl(surfaceHue, 18, 5));
    set("--md-surface-container", am ? hsl(surfaceHue, 18, 4) : hsl(surfaceHue, 18, 10));
    set("--md-surface-container-high", am ? hsl(surfaceHue, 18, 8) : hsl(surfaceHue, 17, 14));
    set("--md-surface-container-highest", am ? hsl(surfaceHue, 18, 12) : hsl(surfaceHue, 16, 18));
    set("--md-on-surface", hsl(surfaceHue, 10, 96));
    set("--md-on-surface-variant", hsl(surfaceHue, 18, 72));
    set("--md-outline-variant", hsl(surfaceHue, 18, 28));
    set("--md-error", "#ffb4ab");
    set("--md-warning", "#f5c76b");
    set("--glow", "hsl(" + h + " " + primaryChroma + "% 58% / " + (settings.amoled ? ".24" : ".18") + ")");
  } else {
    set("--md-primary", hsl(h, primaryChroma, 36));
    set("--md-on-primary", "#ffffff");
    set("--md-primary-container", hsl(h, Math.min(90, Math.round(primaryChroma * 0.48)), 90));
    set("--md-on-primary-container", hsl(h, Math.max(22, Math.round(primaryChroma * 0.72)), 15));
    set("--md-secondary", hsl(secondaryHue, secondaryChroma, 40));
    set("--md-on-secondary", "#ffffff");
    set("--md-secondary-container", hsl(secondaryHue, Math.round(secondaryChroma * 0.36), 92));
    set("--md-on-secondary-container", hsl(secondaryHue, Math.max(22, Math.round(secondaryChroma * 0.7)), 15));
    set("--md-tertiary", hsl(tertiaryHue, tertiaryChroma, 39));
    set("--md-on-tertiary", "#ffffff");
    set("--md-tertiary-container", hsl(tertiaryHue, Math.round(tertiaryChroma * 0.36), 92));
    set("--md-on-tertiary-container", hsl(tertiaryHue, Math.max(22, Math.round(tertiaryChroma * 0.7)), 15));
    set("--md-surface", hsl(surfaceHue, 16, 98));
    set("--md-surface-container", hsl(surfaceHue, 18, 95));
    set("--md-surface-container-high", hsl(surfaceHue, 20, 92));
    set("--md-surface-container-highest", hsl(surfaceHue, 22, 88));
    set("--md-on-surface", hsl(surfaceHue, 10, 10));
    set("--md-on-surface-variant", hsl(surfaceHue, 12, 34));
    set("--md-outline-variant", hsl(surfaceHue, 12, 78));
    set("--md-error", "#b3261e");
    set("--md-warning", "#8a5200");
    set("--glow", "hsl(" + h + " " + primaryChroma + "% 78% / .26)");
  }

  const themeColor = light ? hsl(surfaceHue, 16, 98) : settings.amoled ? "#000000" : hsl(surfaceHue, 18, 5);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor);
  syncSystemBars(themeColor, light);
  syncWidgetColors(h, sat);
}

// Widgets da tela inicial: usam um tom escuro da cor do app (e um tom claro no botão play).
let lastWidgetColors = "";
const pendingWidgetColors = new Set();
function syncWidgetColors(h, sat) {
  if (!MN || typeof MN.widgetInfo !== "function") return;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    const hex = css => { ctx.fillStyle = css; return ctx.fillStyle; };
    const s = Math.max(sat, 30);
    const colors = [
      hex(hsl(h, s, 26)),   // fundo do widget
      hex(hsl(h, s, 36)),   // botões anterior/próxima/coração
      hex(hsl(h, 100, 94)), // texto
      hex(hsl(h, 70, 82)),  // texto secundário
      hex(hsl(h, 100, 90))  // botão play
    ].join(",");
    if (colors === lastWidgetColors || pendingWidgetColors.has(colors)) return;
    const r = MN.widgetInfo({ id: "", favorite: false, colors });
    // Só deduplicar quando a ponte assíncrona confirmar a aplicação.
    if (!r || typeof r.then !== "function") return;
    pendingWidgetColors.add(colors);
    r.then(() => {
      lastWidgetColors = colors;
      pendingWidgetColors.delete(colors);
    }, e => {
      pendingWidgetColors.delete(colors);
      logErr("tema:widgets", e);
    });
  } catch (e) { logErr("tema:widgets", e); }
}

// Android: a faixa de baixo do sistema usa a mesma cor do fundo do app.
let lastSystemBars = "";
let pendingSystemBars = "";
function syncSystemBars(css, light) {
  if (!MN || typeof MN.setSystemBars !== "function") return;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = css;
    const hex = ctx.fillStyle; // o canvas converte para #rrggbb
    const key = hex + (light ? "L" : "D");
    if (key === lastSystemBars || key === pendingSystemBars) return;
    const r = MN.setSystemBars({ navColor: hex, light: !!light });
    // Não gravar a chave até que o plugin confirme; a rejeição mantém o retry possível.
    if (!r || typeof r.then !== "function") return;
    pendingSystemBars = key;
    r.then(() => {
      lastSystemBars = key;
      if (pendingSystemBars === key) pendingSystemBars = "";
    }, e => {
      if (pendingSystemBars === key) pendingSystemBars = "";
      logErr("tema:systembars", e);
    });
  } catch (e) { logErr("tema:systembars", e); }
}

let colorToken = 0;

async function updateColor() {
  const song = current() || homeMain;
  const token = ++colorToken;

  if (settings.accent !== "auto") {
    seed = { h: Number(settings.accent), s: 0.7 };
    applyPalette();
    return;
  }

  if (!song || !song.cover) {
    seed = DEFAULT_SEED;
    applyPalette();
    return;
  }

  if (!song.seed) {
    song.seed = await extractSeed(song.cover);
  }

  if (token !== colorToken) return;
  seed = song.seed;
  applyPalette();
}

/* ---------- Tema claro/escuro ---------- */
const systemTheme = window.matchMedia("(prefers-color-scheme: light)");

function applyTheme() {
  const light = manualTheme === null
    ? systemTheme.matches
    : manualTheme === "light";

  document.body.classList.toggle("light", light);
  setIcon($("themeBtn"), light ? "light_mode" : "dark_mode");
  if ($("homeTheme")) setIcon($("homeTheme"), light ? "light_mode" : "dark_mode");
  applyPalette();
}

$("homeTheme").onclick = () => $("themeBtn").click();

$("themeBtn").onclick = () => {
  manualTheme = document.body.classList.contains("light") ? "dark" : "light";
  lsSet("manualTheme", manualTheme);

  // desliga as transições só durante a troca, para ela ser instantânea
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyTheme();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
};

const onSystemThemeChange = () => {
  if (manualTheme === null) applyTheme();
};
if (systemTheme.addEventListener) systemTheme.addEventListener("change", onSystemThemeChange);
else if (systemTheme.addListener) systemTheme.addListener(onSystemThemeChange);
