"use strict";

/* ==========================================================
   Helpers
   ========================================================== */
/* ==========================================================
   Ícones embutidos (SVG) — não dependem de internet nem de fonte
   ========================================================== */
const ICONS = {
  "home": "M12 5.69l5 4.5V18h-2v-6H9v6H7v-7.81l5-4.5M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z",
  "notes": "M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z",
  "refresh": "M17.65 6.35A7.96 7.96 0 0012 4a8 8 0 108 8h-2a6 6 0 11-1.76-4.24L13 11h7V4l-2.35 2.35z",
  "close": "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  "settings": "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  "bug_report": "M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z",
  "arrow_back": "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  "music_note": "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
  "play_arrow": "M8 5v14l11-7z",
  "pause": "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  "skip_next": "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  "skip_previous": "M6 6h2v12H6zm3.5 6l8.5 6V6z",
  "shuffle": "M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
  "repeat": "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
  "repeat_one": "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z",
  "favorite": "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  "favorite_border": "M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z",
  "more_vert": "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  "person": "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  "search": "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  "library_music": "M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5c0 1.38-1.12 2.5-2.5 2.5S10 13.88 10 12.5s1.12-2.5 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z",
  "add": "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  "light_mode": "M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z",
  "dark_mode": "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z",
  "keyboard_arrow_down": "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  "lyrics": "M4 4h16v13H8l-4 4V4zm4 3v2h8V7H8zm0 4v2h5v-2H8z",
  "check": "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  "check_circle": "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  "playlist_add": "M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z",
  "playlist_remove": "M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41 6L17 19.41 19.59 22 21 20.59 18.41 18 21 15.41 19.59 14 17 16.59 14.41 14 13 15.41 15.59 18 13 20.59 14.41 22z",
  "delete": "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  "speaker_notes_off": "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  "upload_file": "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.01l1.41 1.41L11 14.84V19h2v-4.16l1.59 1.59L16 15.01 12.01 11 8 15.01z",
  "image": "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM5 5h14v9l-3.5-3.5-4 5L9 12l-4 6V5zm3.5 5A1.5 1.5 0 1 0 8.5 7a1.5 1.5 0 0 0 0 3z",
  "notifications": "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
  "storage": "M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z",
  "folder": "M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z",
  "restart_alt": "M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6 0 2.97-2.17 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93 0-4.42-3.58-8-8-8zm-6 8c0-1.65.67-3.15 1.76-4.24L6.34 7.34C4.9 8.79 4 10.79 4 13c0 4.08 3.05 7.44 7 7.93v-2.02c-2.83-.48-5-2.94-5-5.91z",
  "bedtime": "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.4 2.26-4.4C12.92 3.04 12.46 3 12 3z",
  "graphic_eq": "M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z",
  "blur_on": "M5 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0zm5 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0zm5 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0z",
  "block": "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 014 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0120 12c0 4.42-3.58 8-8 8z",
  "timer_off": "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  "radio_button_unchecked": "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
  "category": "M12 2l-5.5 9h11L12 2zm5.5 11c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zM3 21.5h8v-8H3v8z",
  "translate": "M12 2a10 10 0 100 20 10 10 0 000-20zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 015.08 16zm2.95-8H5.08a7.99 7.99 0 014.33-3.56A15.65 15.65 0 008.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  "edit": "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
};

function iconSvg(name) {
  const d = ICONS[name];
  if (!d) return "";
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="' + d + '"/></svg>';
}

const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;

  if (text !== undefined) {
    if (cls && cls.indexOf("material-symbols-rounded") !== -1 && ICONS[text]) {
      e.innerHTML = iconSvg(text);
    } else {
      e.textContent = text;
    }
  }

  return e;
}

// ícones escritos direto no HTML
document.querySelectorAll(".material-symbols-rounded").forEach(node => {
  const name = node.textContent.trim();
  if (ICONS[name]) node.innerHTML = iconSvg(name);
});

// segurar o dedo num texto não abre "Copiar / Selecionar tudo"
document.addEventListener("contextmenu", e => {
  if (!e.target.closest("input, textarea")) e.preventDefault();
});

function setIcon(element, name) {
  element.innerHTML = "";
  element.appendChild(el("span", "material-symbols-rounded", name));
}

// A capa vem SEMPRE de song.cover (fonte única)
function setCover(element, url) {
  element.innerHTML = "";

  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Capa da música";
    img.draggable = false;
    element.appendChild(img);
  } else {
    setIcon(element, "music_note");
  }
}

function fmt(t) {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ":" + String(s).padStart(2, "0");
}

// Gêneros numerados do ID3v1 (o número vira o nome)
const ID3_GENRES = ["Blues","Classic Rock","Country","Dance","Disco","Funk","Grunge","Hip-Hop","Jazz","Metal","New Age","Oldies","Other","Pop","R&B","Rap","Reggae","Rock","Techno","Industrial","Alternative","Ska","Death Metal","Pranks","Soundtrack","Euro-Techno","Ambient","Trip-Hop","Vocal","Jazz+Funk","Fusion","Trance","Classical","Instrumental","Acid","House","Game","Sound Clip","Gospel","Noise","Alternative Rock","Bass","Soul","Punk","Space","Meditative","Instrumental Pop","Instrumental Rock","Ethnic","Gothic","Darkwave","Techno-Industrial","Electronic","Pop-Folk","Eurodance","Dream","Southern Rock","Comedy","Cult","Gangsta","Top 40","Christian Rap","Pop/Funk","Jungle","Native American","Cabaret","New Wave","Psychedelic","Rave","Showtunes","Trailer","Lo-Fi","Tribal","Acid Punk","Acid Jazz","Polka","Retro","Musical","Rock & Roll","Hard Rock"];

// Limpa o texto do gênero vindo da etiqueta: "(13)", "(17)Rock", "13" ou "Rock; Pop"
function cleanGenre(raw) {
  if (raw === undefined || raw === null) return "";
  let g = String(raw).replace(/\u0000/g, " ").trim();
  // referências numéricas no começo: "(17)", "(9)(131)Metal"
  const refs = [];
  g = g.replace(/^(?:\(\d{1,3}\)\s*)+/, m => {
    (m.match(/\d{1,3}/g) || []).forEach(n => refs.push(Number(n)));
    return "";
  }).trim();
  if (!g && refs.length) g = ID3_GENRES[refs[0]] || "";
  if (/^\d{1,3}$/.test(g)) g = ID3_GENRES[Number(g)] || "";
  g = g.split(";")[0].trim();
  if (!g || /^(unknown|desconhecido|other|outro)$/i.test(g)) return "";
  return g.length > 40 ? g.slice(0, 40) : g;
}

function lsGet(key, fallback) {
  let value;
  try {
    value = localStorage.getItem(key);
  } catch {
    reportStorageIssue();
    return fallback;
  }
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    reportStorageIssue();
  }
}


/* ==========================================================
   Armazenamento permanente (IndexedDB)
   ========================================================== */
const DB_NAME = "musica-db";
const STORE = "songs";
let storageIssueReported = false;

function reportStorageIssue() {
  if (storageIssueReported) return;
  storageIssueReported = true;
  setTimeout(() => showToast("Não foi possível acessar o armazenamento local. Confira as permissões e o espaço disponível."), 0);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbReady = (() => {
  try {
    return openDB().catch(() => {
      reportStorageIssue();
      return null;
    });
  } catch {
    reportStorageIssue();
    return Promise.resolve(null);
  }
})();

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

async function dbPut(record) {
  const db = await dbReady;
  if (!db) return false;
  return new Promise(resolve => {
    let tx;
    try {
      tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
    } catch {
      reportStorageIssue();
      resolve(false);
      return;
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => {
      reportStorageIssue();
      resolve(false);
    };
  });
}

async function dbDelete(id) {
  const db = await dbReady;
  if (!db) return false;
  return new Promise(resolve => {
    let tx;
    try {
      tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
    } catch {
      reportStorageIssue();
      resolve(false);
      return;
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => {
      reportStorageIssue();
      resolve(false);
    };
  });
}

async function dbGetAll() {
  const db = await dbReady;
  if (!db) return [];
  return new Promise(resolve => {
    let settled = false;
    const finish = records => {
      if (settled) return;
      settled = true;
      resolve(records);
    };
    try {
      const tx = db.transaction(STORE);
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => finish(req.result || []);
      req.onerror = () => {
        reportStorageIssue();
        finish([]);
      };
      tx.onerror = tx.onabort = () => {
        reportStorageIssue();
        finish([]);
      };
    } catch {
      reportStorageIssue();
      finish([]);
    }
  });
}

function toRecord(song) {
  return {
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album || "",
    genre: song.genre || "",
    sourceKey: song.sourceKey || fileIdentity(song.file),
    favorite: song.favorite,
    file: song.file,
    coverBlob: song.coverBlob || null,
    playCount: song.playCount || 0,
    lastPlayed: song.lastPlayed || 0,
    lyrics: song.lyrics || "",
    lyricsSource: song.lyricsSource || "",
    lyricsSourceId: song.lyricsSourceId || null,
    lyricsSearchAt: song.lyricsSearchAt || 0,
    lyricsRetryAt: song.lyricsRetryAt || 0,
    lyricsRetryReason: song.lyricsRetryReason || ""
  };
}

function inferLocalArtistFromFilename(file) {
  const baseName = String(file && file.name || "").replace(/\.[^/.]+$/, "").trim();
  const parts = baseName.split(/\s+-\s+/, 2);
  if (parts.length !== 2) return null;
  const artist = parts[0].trim();
  const title = parts[1].trim();
  if (!artist || !title) return null;
  return { artist, title };
}

function makeSong(r) {
  return {
    id: r.id,
    name: r.name,
    artist: r.artist,
    album: r.album || "",
    genre: r.genre || "",
    sourceKey: r.sourceKey || fileIdentity(r.file),
    favorite: !!r.favorite,
    file: r.file,
    url: URL.createObjectURL(r.file),
    coverBlob: r.coverBlob || null,
    cover: r.coverBlob ? URL.createObjectURL(r.coverBlob) : null,
    playCount: r.playCount || 0,
    lastPlayed: r.lastPlayed || 0,
    lyrics: r.lyrics || "",
    lyricsSource: r.lyricsSource || "",
    lyricsSourceId: r.lyricsSourceId || null,
    lyricsSearchAt: r.lyricsSearchAt || 0,
    lyricsRetryAt: r.lyricsRetryAt || 0,
    lyricsRetryReason: r.lyricsRetryReason || "",
    seed: null
  };
}

