"use strict";

/* ==========================================================
   Fontes (do Google, do sistema e importadas por você)
   ========================================================== */
const GOOGLE_FONTS = [
  { id: "roboto", name: "Roboto", note: "Padrão do app", family: "Roboto", css: null },
  { id: "poppins", name: "Poppins", note: "Redonda e moderna", family: "Poppins", css: "Poppins:wght@400;500;700;900" },
  { id: "nunito", name: "Nunito", note: "Suave e arredondada", family: "Nunito", css: "Nunito:wght@400;500;700;900" },
  { id: "montserrat", name: "Montserrat", note: "Geométrica", family: "Montserrat", css: "Montserrat:wght@400;500;700;900" },
  { id: "playfair", name: "Playfair Display", note: "Elegante, com serifa", family: "Playfair Display", css: "Playfair+Display:wght@400;500;700;900" },
  { id: "pixelify", name: "Pixelify Sans", note: "Pixelada, parecida com a do Minecraft", family: "Pixelify Sans", css: "Pixelify+Sans:wght@400;500;700", pixel: true },
  { id: "silkscreen", name: "Silkscreen", note: "Pixelada, em maiúsculas", family: "Silkscreen", css: "Silkscreen:wght@400;700", pixel: true },
  { id: "pressstart", name: "Press Start 2P", note: "Pixelada de arcade (bem larga)", family: "Press Start 2P", css: "Press+Start+2P", pixel: true, wide: true },
  { id: "system", name: "Fonte do sistema", note: "A do seu Android", family: "system-ui", css: null }
];

let customFonts = []; // { id, name, family, data }

const fontDbReady = (() => {
  try {
    return new Promise(resolve => {
      const req = indexedDB.open("musica-fonts", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("fonts", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return Promise.resolve(null);
  }
})();

async function fontDbPut(rec) {
  const db = await fontDbReady;
  if (!db) return;
  db.transaction("fonts", "readwrite").objectStore("fonts").put(rec);
}

async function fontDbDelete(id) {
  const db = await fontDbReady;
  if (!db) return;
  db.transaction("fonts", "readwrite").objectStore("fonts").delete(id);
}

async function fontDbAll() {
  const db = await fontDbReady;
  if (!db) return [];
  return new Promise(resolve => {
    const req = db.transaction("fonts").objectStore("fonts").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

const loadedFontCss = new Set();
function ensureGoogleFont(f) {
  if (!f || !f.css || loadedFontCss.has(f.id)) return;
  loadedFontCss.add(f.id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=" + f.css + "&display=swap";
  document.head.appendChild(link);
}

async function registerCustomFont(rec) {
  const face = new FontFace(rec.family, rec.data, { weight: "100 900", style: "normal" });
  await face.load();
  document.fonts.add(face);
}

async function loadCustomFonts() {
  const all = await fontDbAll();
  for (const rec of all) {
    try {
      await registerCustomFont(rec);
      customFonts.push(rec);
    } catch (e) { logErr("fontes-letras:77", e); }
  }
  applyFont();
}

function applyFont() {
  const root = document.documentElement;
  const g = GOOGLE_FONTS.find(f => f.id === settings.font);
  const c = customFonts.find(f => f.id === settings.font);

  let family = '"Roboto", system-ui, sans-serif';
  let pixel = false, wide = false, custom = false;

  if (g) {
    ensureGoogleFont(g);
    family = g.id === "system" ? "system-ui, sans-serif" : '"' + g.family + '", system-ui, sans-serif';
    pixel = !!g.pixel;
    wide = !!g.wide;
    custom = g.id !== "roboto";
  } else if (c) {
    family = '"' + c.family + '", system-ui, sans-serif';
    custom = true;
  }

  root.style.setProperty("--app-font", family);
  document.body.classList.toggle("font-custom", custom);
  document.body.classList.toggle("font-pixel", pixel);
  document.body.classList.toggle("font-wide", wide);
}

function cleanFontName(fileName) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Minha fonte";
}

async function importFontFile(file) {
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    showToast("Essa fonte é grande demais (máximo 15 MB)");
    return;
  }

  const id = "custom-" + Date.now();
  const rec = { id, name: cleanFontName(file.name), family: "UserFont-" + id, data: await file.arrayBuffer() };

  try {
    await registerCustomFont(rec);
  } catch (_) {
    showToast("Esse arquivo não parece ser uma fonte válida");
    return;
  }

  customFonts.push(rec);
  await fontDbPut(rec);
  settings.font = id;
  saveSettings();
  applyFont();
  refreshSettingsPage();
  showToast("Fonte “" + rec.name + "” adicionada");
}

$("fontInput").addEventListener("change", () => {
  const file = $("fontInput").files && $("fontInput").files[0];
  importFontFile(file);
  $("fontInput").value = "";
});

$("homeSettings").onclick = () => openSettings();

/* ==========================================================
   Letras (.lrc)
   ========================================================== */
let lrcLines = [];
let lrcSynced = false;
let lrcActive = -1;

function parseLrc(text) {
  const lines = [];
  let synced = false;
  const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/im.exec(text);
  const fileOffset = off ? Number(off[1]) / 1000 : 0; // ms; positivo = letra antes

  text.split(/\r?\n/).forEach(raw => {
    const stamps = Array.from(
      raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)
    );

    const content = raw
      .replace(/\[[^\]]*\]/g, "")
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "")
      .trim();

    if (stamps.length === 0) {
      if (content) lines.push({ t: null, text: content });
      return;
    }

    synced = true;
    stamps.forEach(m => {
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
      lines.push({
        t: Number(m[1]) * 60 + Number(m[2]) + frac - fileOffset,
        text: content || "♪"
      });
    });
  });

  if (synced) {
    return {
      synced: true,
      lines: lines.filter(l => l.t !== null).sort((a, b) => a.t - b.t)
    };
  }

  return { synced: false, lines };
}

function renderLyrics(song) {
  const box = $("fpLyrics");
  const oldAdjust = $("lrcAdjust");
  if (oldAdjust) oldAdjust.remove();
  box.innerHTML = "";
  lrcLines = [];
  lrcSynced = false;
  lrcActive = -1;

  if (!song || !song.lyrics) {
    const empty = el("div", "lrc-empty");
    empty.appendChild(el("span", "material-symbols-rounded", "lyrics"));
    const state = lyricsLookupStatus.get(song && song.id);
    const messages = {
      searching: "Buscando letras online…",
      "not-found": "Não encontramos uma letra correspondente.",
      error: "Não foi possível buscar agora. Verifique a conexão e tente novamente.",
      limited: "A busca está temporariamente limitada. Tente novamente mais tarde."
    };
    const message = el("p", "", messages[state] || "Esta música ainda não tem letra.");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    empty.appendChild(message);

    if (state !== "searching") {
      const actions = el("div", "lyrics-actions");
      const searchBtn = el("button", "tonal-btn");
      searchBtn.appendChild(el("span", "material-symbols-rounded", "search"));
      searchBtn.appendChild(document.createTextNode("Buscar na internet"));
      searchBtn.onclick = () => {
        if (song) requestOnlineLyrics(song, true);
      };
      actions.appendChild(searchBtn);

      const importBtn = el("button", "tonal-btn");
      importBtn.appendChild(el("span", "material-symbols-rounded", "upload_file"));
      importBtn.appendChild(document.createTextNode("Importar .lrc"));
      importBtn.onclick = () => {
        if (song) pickLrcFor(song.id);
      };
      actions.appendChild(importBtn);
      empty.appendChild(actions);
    }

    empty.appendChild(el("small", "lyrics-search-note", "A busca envia apenas título, artista e álbum ao LRCLIB; o arquivo de áudio não é enviado."));
    box.appendChild(empty);
    return;
  }

  const parsed = parseLrc(song.lyrics);
  lrcLines = parsed.lines;
  lrcSynced = parsed.synced;

  lrcLines.forEach(line => {
    const p = el("p", "lrc-line" + (lrcSynced ? "" : " plain"), line.text);

    if (lrcSynced) {
      p.onclick = () => {
        audio.currentTime = Math.max(0, line.t - lyricsAdjust());
      };
    }

    box.appendChild(p);
  });

  if (!lrcSynced) {
    const actions = el("div", "lyrics-actions");
    const searchSynced = el("button", "tonal-btn");
    searchSynced.appendChild(el("span", "material-symbols-rounded", "sync"));
    searchSynced.appendChild(document.createTextNode("Buscar letra sincronizada"));
    const lookupState = lyricsLookupStatus.get(song && song.id);
    if (lookupState === "searching") {
      searchSynced.disabled = true;
      searchSynced.lastChild.textContent = "Buscando versão sincronizada…";
    }
    searchSynced.onclick = () => {
      if (song) requestOnlineLyrics(song, true);
    };
    actions.appendChild(searchSynced);
    box.appendChild(actions);
    const lookupNotes = {
      "not-found": "Não encontramos outra versão sincronizada para esta faixa.",
      unsynced: "A busca não retornou uma versão sincronizada; mantive a letra atual.",
      error: "Não foi possível consultar a busca agora. Verifique a conexão e tente novamente.",
      limited: "A busca está temporariamente limitada. Tente novamente mais tarde."
    };
    if (lookupNotes[lookupState]) box.appendChild(el("small", "lyrics-search-note", lookupNotes[lookupState]));
  }

  if (lrcSynced) $("fpStage").appendChild(buildLyricsAdjust());

  if (song.lyricsSource === "lrclib") {
    const source = el("a", "lyrics-source", "Letra encontrada pelo LRCLIB");
    source.href = song.lyricsSourceId
      ? "https://lrclib.net/api/get/" + encodeURIComponent(song.lyricsSourceId)
      : "https://lrclib.net/";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    box.appendChild(source);
  }

  syncLyrics(audio.currentTime || 0);
}

function scrollLyricsToActive() {
  const box = $("fpLyrics");
  const node = box.children[lrcActive];
  if (!node || !lrcSynced) return;

  box.scrollTo({
    top: node.offsetTop - box.clientHeight / 2 + node.offsetHeight / 2,
    behavior: "smooth"
  });
}

let lyricsSyncFrame = 0;

function stopLyricsSyncLoop() {
  if (lyricsSyncFrame) cancelAnimationFrame(lyricsSyncFrame);
  lyricsSyncFrame = 0;
}

function startLyricsSyncLoop() {
  if (lyricsSyncFrame || !lyricsView || !fpOpen || audio.paused || !lrcSynced) return;
  const tick = () => {
    lyricsSyncFrame = 0;
    if (!lyricsView || !fpOpen || audio.paused || !lrcSynced) return;
    syncLyrics(audio.currentTime || 0);
    lyricsSyncFrame = requestAnimationFrame(tick);
  };
  syncLyrics(audio.currentTime || 0);
  lyricsSyncFrame = requestAnimationFrame(tick);
}

const LYRICS_LEAD = 0.25; // a linha acende um pouco antes, para parecer em sincronia

function lyricsOffsetFor(id) {
  const m = lsGet("lyricsOffsets", {});
  return Number(m && m[id]) || 0;
}

function setLyricsOffset(id, v) {
  const m = lsGet("lyricsOffsets", {}) || {};
  if (Math.abs(v) < 0.05) delete m[id];
  else m[id] = Math.round(v * 10) / 10;
  lsSet("lyricsOffsets", m);
}

function lyricsAdjust() {
  return LYRICS_LEAD + lyricsOffsetFor(currentId);
}

function fmtOffset(v) {
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1).replace(".", ",") + " s";
}

function buildLyricsAdjust() {
  const wrap = el("div", "lrc-adjust");
  wrap.id = "lrcAdjust";
  const panel = el("div", "lrc-adjust-panel");
  const label = el("span", "lrc-adjust-val", "");
  const paint = () => { label.textContent = fmtOffset(lyricsOffsetFor(currentId)); };
  const step = d => {
    setLyricsOffset(currentId, lyricsOffsetFor(currentId) + d);
    paint();
    const nodes = $("fpLyrics").children;
    if (nodes[lrcActive]) nodes[lrcActive].classList.remove("active");
    lrcActive = -1;
    syncLyrics(audio.currentTime || 0);
  };
  const minus = el("button", "lrc-adjust-btn", "−0,5");
  minus.setAttribute("aria-label", "Atrasar a letra em meio segundo");
  minus.onclick = () => step(-0.5);
  const plus = el("button", "lrc-adjust-btn", "+0,5");
  plus.setAttribute("aria-label", "Adiantar a letra em meio segundo");
  plus.onclick = () => step(0.5);
  const reset = el("button", "lrc-adjust-btn", "Zerar");
  reset.onclick = () => { setLyricsOffset(currentId, 0); step(0); };
  panel.append(minus, label, plus, reset);

  const toggle = el("button", "lrc-adjust-toggle", "Ajustar letra");
  toggle.setAttribute("aria-expanded", "false");
  toggle.onclick = () => {
    const open = wrap.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  };
  wrap.append(panel, toggle);
  paint();
  return wrap;
}

function syncLyrics(t) {
  if (!lrcSynced || lrcLines.length === 0) return;

  const target = t + lyricsAdjust();
  let lo = 0;
  let hi = lrcLines.length - 1;
  let idx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lrcLines[mid].t <= target) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (idx === lrcActive) return;

  const nodes = $("fpLyrics").children;
  if (nodes[lrcActive]) nodes[lrcActive].classList.remove("active");
  lrcActive = idx;

  if (idx >= 0 && nodes[idx]) {
    nodes[idx].classList.add("active");
    if (lyricsView && fpOpen) scrollLyricsToActive();
  }
}

audio.addEventListener("playing", startLyricsSyncLoop);
audio.addEventListener("pause", stopLyricsSyncLoop);
audio.addEventListener("ended", stopLyricsSyncLoop);

lrcInput.addEventListener("change", async () => {
  const file = lrcInput.files && lrcInput.files[0];
  lrcInput.value = "";
  if (!file) return;

  const song = getSong(lrcTargetId !== null ? lrcTargetId : currentId);
  if (!song) {
    showToast("Escolha uma música primeiro");
    return;
  }

  try {
    song.lyrics = await file.text();
    song.lyricsSource = "lrc";
    song.lyricsSourceId = null;
  } catch {
    showToast("Não consegui ler esse arquivo");
    return;
  }

  dbPut(toRecord(song));
  if (song.id === currentId) renderLyrics(song);
  showToast("Letra adicionada");
});
