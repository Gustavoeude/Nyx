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
let playlists = lsGet("playlists", []);
let mixMode = lsGet("mixMode", "plays"); // plays | recent
let manualTheme = lsGet("manualTheme", null);
let seeking = false;
let lyricsView = false;
let fpOpen = false;
let homeMain = null;
let lrcTargetId = null;
let seed = { h: 215, s: 0.8 };
let settings = Object.assign(
  { accent: "auto", amoled: false, disc: false, name: "", shapes: {}, swipe: true, swipeInvert: false, font: "roboto", autoLyrics: true, autoCovers: true, nativePlayer: true, wallpaper: null, wallpaperOpacity: 0.28, wallpaperBlur: 0 },
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
const DEFAULT_SEED = { h: 215, s: 0.8 };
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
  const k = f => Math.round(sat * f);

  if (!light) {
    set("--md-primary", hsl(h, sat, 80));
    set("--md-on-primary", hsl(h, sat, 16));
    set("--md-primary-container", hsl(h, k(0.75), 28));
    set("--md-on-primary-container", hsl(h, Math.min(sat + 10, 100), 90));
    set("--md-secondary-container", hsl(h, k(0.3), 26));
    set("--md-on-secondary-container", hsl(h, k(0.4), 90));
    const am = settings.amoled;
    set("--md-surface", am ? "#000000" : hsl(h, k(0.25), 7));
    set("--md-surface-container", am ? hsl(h, k(0.2), 5) : hsl(h, k(0.22), 11));
    set("--md-surface-container-high", am ? hsl(h, k(0.18), 9) : hsl(h, k(0.2), 15));
    set("--md-surface-container-highest", am ? hsl(h, k(0.18), 13) : hsl(h, k(0.2), 19));
    set("--md-on-surface", hsl(h, 12, 92));
    set("--md-on-surface-variant", hsl(h, 10, 72));
    set("--md-outline-variant", hsl(h, 10, 30));
    set("--glow", "hsl(" + h + " " + k(0.75) + "% 30% / " + (settings.amoled ? ".4" : ".6") + ")");
  } else {
    set("--md-primary", hsl(h, sat, 38));
    set("--md-on-primary", "#ffffff");
    set("--md-primary-container", hsl(h, Math.min(sat + 15, 100), 88));
    set("--md-on-primary-container", hsl(h, sat, 14));
    set("--md-secondary-container", hsl(h, k(0.4), 88));
    set("--md-on-secondary-container", hsl(h, k(0.5), 14));
    set("--md-surface", hsl(h, k(0.3), 97));
    set("--md-surface-container", hsl(h, k(0.28), 94));
    set("--md-surface-container-high", hsl(h, k(0.26), 91));
    set("--md-surface-container-highest", hsl(h, k(0.26), 88));
    set("--md-on-surface", hsl(h, 12, 10));
    set("--md-on-surface-variant", hsl(h, 8, 34));
    set("--md-outline-variant", hsl(h, 10, 78));
    set("--glow", "hsl(" + h + " " + Math.min(sat + 15, 100) + "% 80% / .75)");
  }

  const themeColor = !light && settings.amoled ? "#000000" : hsl(h, light ? k(0.3) : k(0.25), light ? 97 : 7);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor);
  syncSystemBars(themeColor, light);
}

// Android: a faixa de baixo do sistema usa a mesma cor do fundo do app.
let lastSystemBars = "";
function syncSystemBars(css, light) {
  if (!MN || typeof MN.setSystemBars !== "function") return;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = css;
    const hex = ctx.fillStyle; // o canvas converte para #rrggbb
    const key = hex + (light ? "L" : "D");
    if (key === lastSystemBars) return;
    lastSystemBars = key;
    const r = MN.setSystemBars({ navColor: hex, light: !!light });
    if (r && typeof r.catch === "function") r.catch(() => {}); // APK antigo sem o método
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
  setIcon($("themeBtn"), light ? "dark_mode" : "light_mode");
  applyPalette();
}

$("themeBtn").onclick = () => {
  manualTheme = document.body.classList.contains("light") ? "dark" : "light";
  lsSet("manualTheme", manualTheme);
  applyTheme();
};

const onSystemThemeChange = () => {
  if (manualTheme === null) applyTheme();
};
if (systemTheme.addEventListener) systemTheme.addEventListener("change", onSystemThemeChange);
else if (systemTheme.addListener) systemTheme.addListener(onSystemThemeChange);
