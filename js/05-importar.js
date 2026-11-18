"use strict";

/* ==========================================================
   Adicionar músicas
   ========================================================== */
function openFilePicker() {
  fileInput.click();
}

const audioExt = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|weba|webm|aiff|aif|alac|amr|3gp)$/i;
const lrcExt = /\.lrc$/i;

function fileIdentity(file) {
  if (file.sourceDocumentId) return String(file.sourceDocumentId);
  return [file.name, file.size, file.lastModified || 0, file.sourcePath || file.webkitRelativePath || ""].join("::");
}

function lyricsMatchKey(file) {
  const path = (file.sourcePath || file.webkitRelativePath || file.name || "").replace(/\\/g, "/");
  return path.replace(/\.[^/.]+$/, "").normalize("NFKC").toLocaleLowerCase("pt-BR");
}

function lyricsFromTag(value) {
  if (typeof value === "string") return value.replace(/^\uFEFF/, "").trim();
  if (!value || typeof value !== "object") return "";
  const text = value.lyrics || value.text || value.value || "";
  return typeof text === "string" ? text.replace(/^\uFEFF/, "").trim() : "";
}

const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const LRCLIB_CLIENT = "ReprodutorMusicalWeb/1.0 (https://github.com/Gustavoeude/Aplicativo-de-reprodutor-de)";
const lyricsLookupStatus = new Map();
const lyricsLookupInFlight = new Map();
let lyricsLookupQueue = Promise.resolve();
let lastLyricsLookupAt = 0;

function normalizeLyricsLookup(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function lyricsLookupTitle(song) {
  return String(song && song.name || "").replace(/^\s*\d{1,3}\s*[-._)\]]+\s*/, "").trim();
}

function lyricsLookupArtist(song) {
  const artist = normalizeLyricsLookup(song && song.artist);
  return !artist || ["arquivo local", "artista desconhecido", "unknown", "unknown artist", "various artists", "n a", "na"].includes(artist) ? "" : artist;
}
function lyricsTitleVariants(value) {
  const original = normalizeLyricsLookup(value);
  if (!original) return [];
  const withoutVersion = original
    .replace(/\s*\b(remaster(?:ed)?|deluxe|explicit|clean|radio edit|album version|single version|live|acoustic|demo|instrumental)\b.*$/i, "")
    .trim();
  return [...new Set([original, withoutVersion].filter(Boolean))];
}
function mediaStoreDurationSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // MediaStore.Audio.Media.DURATION é exposto em milissegundos.
  return n > 1000 ? n / 1000 : n;
}
function readLocalTrackDuration(song) {
  const known = Number(song && song.duration);
  if (Number.isFinite(known) && known > 0) return Promise.resolve(known);
  if (!song || !song.url) return Promise.resolve(null);
  return new Promise(resolve => {
    const probe = document.createElement("audio");
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeAttribute("src");
      probe.load();
      resolve(Number.isFinite(value) && value > 0 ? value : null);
    };
    const timer = setTimeout(() => finish(null), 7000);
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => finish(probe.duration), { once: true });
    probe.addEventListener("error", () => finish(null), { once: true });
    probe.src = song.url;
    probe.load();
  });
}

function hasSyncedLyrics(song) {
  return !!(song && song.lyrics && parseLrc(song.lyrics).synced);
}

function chooseLyricsRecord(song, records, duration) {
  const titleVariants = lyricsTitleVariants(lyricsLookupTitle(song));
  if (!titleVariants.length || !Array.isArray(records)) return null;
  const artist = lyricsLookupArtist(song);
  const album = normalizeLyricsLookup(song && song.album);
  const titleMatches = records.filter(record => titleVariants.includes(
    normalizeLyricsLookup(record.trackName || record.name)
  ));
  if (!titleMatches.length) return null;
  const candidates = titleMatches.filter(record => record.syncedLyrics || record.plainLyrics);
  candidates.sort((a, b) => {
    const score = record => {
      const recordTitle = normalizeLyricsLookup(record.trackName || record.name);
      const recordArtist = normalizeLyricsLookup(record.artistName);
      const recordAlbum = normalizeLyricsLookup(record.albumName);
      let value = recordTitle === titleVariants[0] ? 6 : 3;
      if (artist && recordArtist === artist) value += 6;
      if (album && recordAlbum === album) value += 3;
      if (record.syncedLyrics) value += 2;
      if (Number.isFinite(duration) && Number.isFinite(Number(record.duration))) {
        const delta = Math.abs(Number(record.duration) - duration);
        if (delta <= 5) value += 5;
        else if (delta <= 10) value += 2;
        else value -= Math.min(5, delta / 30);
      }
      return value;
    };
    const scoreDelta = score(b) - score(a);
    if (scoreDelta) return scoreDelta;
    if (album) {
      const albumA = Number(normalizeLyricsLookup(a.albumName) === album);
      const albumB = Number(normalizeLyricsLookup(b.albumName) === album);
      if (albumA !== albumB) return albumB - albumA;
    }
    if (Number.isFinite(duration)) return Math.abs(Number(a.duration) - duration) - Math.abs(Number(b.duration) - duration);
    return 0;
  });
  return candidates[0] || null;
}

async function fetchLyricsRecord(song) {
  const title = lyricsLookupTitle(song);
  if (!title) return null;
  const artist = lyricsLookupArtist(song);
  const search = async params => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    let response;
    try {
      response = await fetch(LRCLIB_SEARCH_URL + "?" + params.toString(), {
        method: "GET",
        headers: { "Lrclib-Client": LRCLIB_CLIENT },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 429) {
      const error = new Error("rate-limited");
      const retryHeader = response.headers.get("Retry-After");
      const retrySeconds = Number(retryHeader);
      const retryDate = retryHeader && Number.isNaN(retrySeconds) ? Date.parse(retryHeader) : NaN;
      error.retryAfter = Math.max(1, Number.isFinite(retrySeconds) && retrySeconds > 0
        ? retrySeconds
        : Number.isFinite(retryDate) ? Math.ceil((retryDate - Date.now()) / 1000) : 60);
      error.retryReason = "rate";
      throw error;
    }
    if (response.status === 503) {
      const error = new Error("service-busy");
      const retryHeader = response.headers.get("Retry-After");
      const retrySeconds = Number(retryHeader);
      const retryDate = retryHeader && Number.isNaN(retrySeconds) ? Date.parse(retryHeader) : NaN;
      error.retryAfter = Math.max(1, Number.isFinite(retrySeconds) && retrySeconds > 0
        ? retrySeconds
        : Number.isFinite(retryDate) ? Math.ceil((retryDate - Date.now()) / 1000) : 5);
      error.retryReason = "busy";
      throw error;
    }
    if (!response.ok) throw new Error("lyrics-service-" + response.status);
    return response.json();
  };
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set("artist_name", song.artist);
  if (song.album) params.set("album_name", song.album);
  const duration = await readLocalTrackDuration(song);
  let records = await search(params);
  let selected = chooseLyricsRecord(song, records, duration);
  // Metadados incompletos ou divergentes do MediaStore não devem esconder
  // uma letra que existe. Tenta novamente sem artista/álbum restritivos.
  if (!selected && (artist || song.album)) {
    const fallback = new URLSearchParams({ track_name: title });
    records = await search(fallback);
    selected = chooseLyricsRecord(song, records, duration);
  }
  return selected;
}

function updateLyricsLookupView(song) {
  if (!song || !songs.includes(song)) return;
  updateMiniPlayer();
  if (song.id === currentId && lyricsView) renderLyrics(song);
}

function requestOnlineLyrics(song, force = false) {
  if (!song || !songs.includes(song)) return Promise.resolve(false);
  // Uma letra simples não deve bloquear uma nova busca por uma versão sincronizada.
  if (song.lyrics && (!force || hasSyncedLyrics(song))) return Promise.resolve(false);
  if (!force && !settings.autoLyrics) return Promise.resolve(false);
  if (lyricsLookupInFlight.has(song.id)) return lyricsLookupInFlight.get(song.id);
  const now = Date.now();
  if (song.lyricsRetryAt > now) {
    if (!(force && song.lyricsRetryReason === "error")) {
      lyricsLookupStatus.set(song.id, song.lyricsRetryReason === "error" ? "error" : "limited");
      updateLyricsLookupView(song);
      return Promise.resolve(false);
    }
    song.lyricsRetryAt = 0;
    song.lyricsRetryReason = "";
  }
  if (!force && song.lyricsSearchAt && now - song.lyricsSearchAt < 24 * 60 * 60 * 1000) {
    lyricsLookupStatus.set(song.id, "not-found");
    return Promise.resolve(false);
  }

  const task = lyricsLookupQueue.then(async () => {
    if (!songs.includes(song) || (song.lyrics && (!force || hasSyncedLyrics(song))) || (!force && !settings.autoLyrics)) return false;
    const wait = Math.max(0, 1500 - (Date.now() - lastLyricsLookupAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    if (!songs.includes(song) || (song.lyrics && (!force || hasSyncedLyrics(song)))) return false;
    lyricsLookupStatus.set(song.id, "searching");
    updateLyricsLookupView(song);
    lastLyricsLookupAt = Date.now();
    try {
      const record = await fetchLyricsRecord(song);
      if (!songs.includes(song)) return false;
      song.lyricsSearchAt = Date.now();
      song.lyricsRetryAt = 0;
      song.lyricsRetryReason = "";
      if (record && record.syncedLyrics) {
        song.lyrics = record.syncedLyrics;
        song.lyricsSource = "lrclib";
        song.lyricsSourceId = record.id || null;
        lyricsLookupStatus.set(song.id, "found");
      } else if (record && !song.lyrics) {
        song.lyrics = record.plainLyrics || "";
        song.lyricsSource = "lrclib";
        song.lyricsSourceId = record.id || null;
        lyricsLookupStatus.set(song.id, song.lyrics ? "found" : "not-found");
      } else if (song.lyrics) {
        // Mantém a letra já salva se a busca não encontrou uma versão sincronizada.
        lyricsLookupStatus.set(song.id, "found");
      } else {
        lyricsLookupStatus.set(song.id, "not-found");
      }
      await dbPut(toRecord(song));
      refreshAll();
      updateLyricsLookupView(song);
      return !!record;
    } catch (error) {
      if (!songs.includes(song)) return false;
      if (error && error.retryAfter) {
        song.lyricsRetryAt = Date.now() + error.retryAfter * 1000;
        song.lyricsRetryReason = error.retryReason || "rate";
        lyricsLookupStatus.set(song.id, "limited");
      } else {
        song.lyricsRetryAt = Date.now() + 5 * 60 * 1000;
        song.lyricsRetryReason = "error";
        lyricsLookupStatus.set(song.id, "error");
      }
      await dbPut(toRecord(song));
      updateLyricsLookupView(song);
      return false;
    }
  });
  lyricsLookupQueue = task.catch(() => false);
  const tracked = task.finally(() => lyricsLookupInFlight.delete(song.id));
  lyricsLookupInFlight.set(song.id, tracked);
  return tracked;
}

async function fetchOnlineCover(song, force) {
  if (!force && !settings.autoCovers) return false;
  if (!song || song.coverBlob || !song.name) return false;

  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const title = normalize(song.name);
  const artist = normalize(song.artist);
  const album = normalize(song.album);
  const queries = [...new Set([
    [song.name, song.artist].filter(Boolean).join(" "),
    [song.name, song.album].filter(Boolean).join(" "),
    song.name
  ].filter(Boolean))];

  try {
    let match = null;
    for (const query of queries) {
      const response = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(query) + "&entity=song&limit=25");
      if (!response.ok) continue;
      const data = await response.json();
      const results = data.results || [];
      const exact = results.filter(item => normalize(item.trackName) === title);
      match = exact.find(item => {
        const candidateArtist = normalize(item.artistName);
        const candidateAlbum = normalize(item.collectionName);
        return (!artist || candidateArtist === artist || candidateArtist.includes(artist) || artist.includes(candidateArtist)) &&
          (!album || !candidateAlbum || candidateAlbum === album || candidateAlbum.includes(album) || album.includes(candidateAlbum));
      }) || exact[0] || null;
      if (match) break;
    }

    if (!match || !match.artworkUrl100) return false;
    const imageUrl = match.artworkUrl100.replace(/100x100bb/, "600x600bb");
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) return false;
    const blob = await imageResponse.blob();
    if (!blob.type.startsWith("image/")) return false;

    song.coverBlob = blob;
    if (song.cover) URL.revokeObjectURL(song.cover);
    song.cover = URL.createObjectURL(blob);
    await dbPut(toRecord(song));
    refreshAll();
    if (song.id === currentId) updateFullPlayer();
    return true;
  } catch (_) {
    return false;
  }
}
function pickCoverFor(songId) {
  const song = getSong(songId);
  if (!song) return;
  const input = $("coverInput");
  input.onchange = async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    song.coverBlob = file;
    if (song.cover) URL.revokeObjectURL(song.cover);
    song.cover = URL.createObjectURL(file);
    await dbPut(toRecord(song));
    refreshAll();
    if (song.id === currentId) updateFullPlayer();
    showToast("Capa atualizada");
  };
  input.click();
}

async function addFile(file, automaticLyrics = "") {
  const sourceKey = fileIdentity(file);
  const duplicate = songs.find(s => s.file && (s.sourceKey || fileIdentity(s.file)) === sourceKey);
  if (duplicate) {
    if (!duplicate.coverBlob) fetchOnlineCover(duplicate);
    if (!duplicate.lyrics && automaticLyrics) {
      duplicate.lyrics = automaticLyrics;
      duplicate.lyricsSource = "lrc";
      const stored = await dbPut(toRecord(duplicate));
      if (duplicate.id === currentId) renderLyrics(duplicate);
      return { added: false, stored, lyricsAdded: true };
    }
    if (!duplicate.lyrics && settings.autoLyrics) requestOnlineLyrics(duplicate);
    return { added: false, stored: true, lyricsAdded: false };
  }

  const fileBaseName = file.name.replace(/\.[^/.]+$/, "").trim();
  const nameParts = fileBaseName.split(/\s+-\s+/, 2);
  const hasArtistInFileName = nameParts.length === 2 && nameParts[0].trim() && nameParts[1].trim();
  const song = {
    id: Date.now() + Math.random(),
    name: hasArtistInFileName ? nameParts[1].trim() : fileBaseName,
    artist: hasArtistInFileName ? nameParts[0].trim() : "Arquivo local",
    album: "",
    genre: "",
    sourceKey,
    favorite: false,
    file: file,
    url: URL.createObjectURL(file),
    coverBlob: null,
    cover: null,
    playCount: 0,
    lastPlayed: 0,
    lyrics: automaticLyrics || "",
    lyricsSource: automaticLyrics ? "lrc" : "",
    lyricsSourceId: null,
    lyricsSearchAt: 0,
    lyricsRetryAt: 0,
    lyricsRetryReason: "",
    seed: null
  };

  songs.push(song);
  const stored = await dbPut(toRecord(song));

  if (window.jsmediatags) {
    try {
      window.jsmediatags.read(file, {
        onSuccess: result => {
          if (!songs.includes(song)) return;
        const tags = result.tags || {};

        if (tags.title) song.name = tags.title;
        if (tags.artist) song.artist = tags.artist;
        if (tags.album) song.album = tags.album;
        const tagGenre = cleanGenre(tags.genre);
        if (tagGenre) song.genre = tagGenre;
        const embeddedLyrics = lyricsFromTag(tags.lyrics);
        if (!song.lyrics && embeddedLyrics) {
          song.lyrics = embeddedLyrics;
          song.lyricsSource = "embedded";
          if (song.id === currentId) renderLyrics(song);
        }

        if (tags.picture) {
          const picture = tags.picture;
          const bytes = new Uint8Array(picture.data);
          const blob = new Blob([bytes], { type: picture.format || "image/jpeg" });
          song.coverBlob = blob;
          song.cover = URL.createObjectURL(blob);
        }

        dbPut(toRecord(song));
        refreshAll();
        if (!song.coverBlob) fetchOnlineCover(song);
        if (!song.lyrics && settings.autoLyrics) requestOnlineLyrics(song);
        },
        onError: () => {
          refreshAll();
          fetchOnlineCover(song);
          if (!song.lyrics && settings.autoLyrics) requestOnlineLyrics(song);
        }
      });
    } catch {
      showToast("A música foi adicionada, mas não consegui ler suas informações.");
      if (!song.lyrics && settings.autoLyrics) requestOnlineLyrics(song);
    }
  } else {
    fetchOnlineCover(song);
    if (!song.lyrics && settings.autoLyrics) requestOnlineLyrics(song);
  }

  return { added: true, stored, lyricsAdded: !!automaticLyrics };
}

async function readSidecarLyrics(files) {
  const bySong = new Map();
  for (const file of files) {
    if (!lrcExt.test(file.name)) continue;
    const key = lyricsMatchKey(file);
    if (!key || bySong.has(key)) continue;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "").trim();
      if (text && parseLrc(text).lines.length) bySong.set(key, text);
    } catch (e) { logErr("importar:434", e); }
  }
  return bySong;
}

// Recebe músicas e, se estiverem disponíveis no mesmo lote/pasta, associa arquivos LRC homônimos.
async function importFiles(list, origem, options = {}) {
  const selectedFiles = Array.from(list || []);
  const files = selectedFiles.filter(
    f => (f.type || "").startsWith("audio/") || audioExt.test(f.name)
  );
  const sidecars = await readSidecarLyrics(selectedFiles);

  let added = 0;
  let notStored = 0;
  let lyricsAdded = 0;
  for (const file of files) {
    const result = await addFile(file, sidecars.get(lyricsMatchKey(file)) || "");
    if (result.added) {
      added++;
      if (!result.stored) notStored++;
    }
    if (result.lyricsAdded) lyricsAdded++;
  }

  refreshAll();

  if (options.silent) {
    return { files: files.length, added, notStored, lyricsAdded };
  } else if (files.length === 0) {
    showToast(selectedFiles.some(f => lrcExt.test(f.name))
      ? "Selecione também a música correspondente para associar a letra."
      : origem ? "Nenhuma música encontrada nessa pasta" : "Nenhum áudio selecionado");
  } else if (added === 0 && lyricsAdded === 0) showToast("Essas músicas já estão na biblioteca");
  else if (added === 0) showToast(lyricsAdded + (lyricsAdded === 1 ? " letra associada à música existente" : " letras associadas às músicas existentes"));
  else if (notStored) showToast(added + " música(s) adicionada(s) só nesta sessão; não foi possível salvá-las.");
  else {
    let message = added + (added === 1 ? " música adicionada" : " músicas adicionadas") + (origem ? " de " + origem : "");
    if (lyricsAdded) message += " · " + lyricsAdded + (lyricsAdded === 1 ? " letra encontrada" : " letras encontradas");
    showToast(message);
  }
  return { files: files.length, added, notStored, lyricsAdded };
}

/* ==========================================================
   Biblioteca de áudio do Android (MediaStore)
   ========================================================== */
function normalizeMediaAudioPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  return normalized === "/" ? "/" : normalized.replace(/\/+$/g, "");
}

function mediaAudioFolderKey(folder) {
  const volume = String(folder && folder.volumeName || "");
  return volume + "::" + normalizeMediaAudioPath(folder && folder.relativePath);
}

function mediaAudioCanonicalLocation(volumeName, path) {
  let volume = String(volumeName || "");
  let normalizedPath = normalizeMediaAudioPath(path);
  if (volume === "external_primary" || volume === "primary") volume = "primary";
  else if (volume === "external") {
    const selfPrimary = normalizedPath.match(/^\/storage\/self\/primary\/?(.*)$/i);
    const emulated = normalizedPath.match(/^\/storage\/emulated\/0\/?(.*)$/i);
    const mounted = normalizedPath.match(/^\/storage\/([^/]+)\/?(.*)$/i);
    if (selfPrimary || emulated) {
      volume = "primary";
      normalizedPath = (selfPrimary || emulated)[1] || "";
    } else if (mounted) {
      volume = mounted[1];
      normalizedPath = mounted[2] || "";
    } else volume = "primary";
  }
  return {
    volume: volume.toLocaleLowerCase("en-US"),
    path: normalizedPath.replace(/^\/+|\/+$/g, "").normalize("NFKC").toLocaleLowerCase("en-US")
  };
}

function mediaAudioCanonicalFileKey(volumeName, relativePath, name) {
  const fullPath = [normalizeMediaAudioPath(relativePath), String(name || "").replace(/^\/+/, "")]
    .filter(Boolean).join("/");
  const location = mediaAudioCanonicalLocation(volumeName, fullPath);
  if (!location.volume || !location.path) return "";
  return "android-audio-path::" + location.volume + "::" + location.path;
}

function mediaAudioCanonicalFromDocumentId(documentId) {
  const id = String(documentId || "");
  const split = id.indexOf(":");
  if (split <= 0 || split === id.length - 1) return "";
  return mediaAudioCanonicalFileKey(id.slice(0, split), "", id.slice(split + 1));
}

function mediaAudioCanonicalFromSaf(treeUri, relativePath) {
  const match = String(treeUri || "").match(/\/tree\/([^/?#]+)/i);
  if (!match) return "";
  let documentId;
  try { documentId = decodeURIComponent(match[1]); } catch (_) { return ""; }
  const split = documentId.indexOf(":");
  if (split <= 0) return "";
  const volume = documentId.slice(0, split);
  const rootPath = documentId.slice(split + 1);
  const fullPath = [rootPath, normalizeMediaAudioPath(relativePath)].filter(Boolean).join("/");
  return mediaAudioCanonicalFileKey(volume, "", fullPath);
}

function mediaAudioCanonicalFromWatchedSourceKey(sourceKey) {
  const key = String(sourceKey || "");
  if (key.startsWith("android-audio-path::")) return key;
  if (key.startsWith("android-document::")) {
    const rest = key.slice("android-document::".length);
    const split = rest.indexOf("::");
    if (split < 0 || !rest.slice(0, split).includes("externalstorage.documents")) return "";
    return mediaAudioCanonicalFromDocumentId(rest.slice(split + 2));
  }
  const parts = key.split("::");
  if (parts.length < 5 || !parts[3].startsWith("content://")) return "";
  return mediaAudioCanonicalFromSaf(parts[3], parts.slice(4).join("::"));
}

function mediaAudioCanonicalKeyIsExcluded(canonicalKey, excluded = getMediaAudioExcludedFolders()) {
  const prefix = "android-audio-path::";
  const key = String(canonicalKey || "");
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  const split = rest.indexOf("::");
  if (split < 0) return false;
  const volume = rest.slice(0, split);
  const path = rest.slice(split + 2);
  return excluded.some(folder => {
    const location = mediaAudioCanonicalLocation(folder.volumeName, folder.relativePath);
    return location.volume === volume
      && (!location.path || path === location.path || path.startsWith(location.path + "/"));
  });
}

function getMediaAudioExcludedFolders() {
  const saved = lsGet("mediaAudioExcludedFolders", []);
  if (!Array.isArray(saved)) return [];
  const unique = new Map();
  saved.forEach(folder => {
    if (!folder || typeof folder !== "object") return;
    const volumeName = String(folder.volumeName || "");
    if (!volumeName) return;
    const normalized = {
      volumeName,
      relativePath: normalizeMediaAudioPath(folder.relativePath),
      name: String(folder.name || "Pasta")
    };
    unique.set(mediaAudioFolderKey(normalized), normalized);
  });
  return Array.from(unique.values());
}

function getMediaAudioImportExclusions() {
  const unique = new Map();
  const add = folder => {
    const location = mediaAudioCanonicalLocation(folder.volumeName, folder.relativePath);
    const key = location.volume + "::" + location.path;
    if (!unique.has(key)) unique.set(key, folder);
  };
  getMediaAudioExcludedFolders().forEach(add);
  if (typeof getIgnoredFolders === "function") {
    getIgnoredFolders().forEach(folder => {
      const canonical = mediaAudioCanonicalFromSaf(folder.uri, "");
      const prefix = "android-audio-path::";
      if (!canonical.startsWith(prefix)) return;
      const rest = canonical.slice(prefix.length);
      const split = rest.indexOf("::");
      if (split <= 0) return;
      add({
        volumeName: rest.slice(0, split),
        relativePath: rest.slice(split + 2),
        name: String(folder.name || "Pasta")
      });
    });
  }
  return Array.from(unique.values());
}

function setMediaAudioExcludedFolders(folders) {
  const unique = new Map();
  (Array.isArray(folders) ? folders : []).forEach(folder => {
    if (!folder || !folder.volumeName) return;
    const normalized = {
      volumeName: String(folder.volumeName),
      relativePath: normalizeMediaAudioPath(folder.relativePath),
      name: String(folder.name || "Pasta")
    };
    unique.set(mediaAudioFolderKey(normalized), normalized);
  });
  lsSet("mediaAudioExcludedFolders", Array.from(unique.values()));
}

function setMediaAudioFoldersCache(folders) {
  const unique = new Map();
  (Array.isArray(folders) ? folders : []).forEach(folder => {
    if (!folder || !folder.volumeName) return;
    const normalized = {
      volumeName: String(folder.volumeName),
      relativePath: normalizeMediaAudioPath(folder.relativePath),
      name: String(folder.name || "Pasta"),
      count: Math.max(0, Number(folder.count) || 0)
    };
    unique.set(mediaAudioFolderKey(normalized), normalized);
  });
  lsSet("mediaAudioFoldersCache", Array.from(unique.values()));
  lsSet("mediaAudioFoldersCacheLoaded", true);
}

function getMediaAudioFoldersCache() {
  const saved = lsGet("mediaAudioFoldersCache", []);
  return Array.isArray(saved) ? saved.filter(folder => folder && folder.volumeName).map(folder => ({
    volumeName: String(folder.volumeName),
    relativePath: normalizeMediaAudioPath(folder.relativePath),
    name: String(folder.name || "Pasta"),
    count: Math.max(0, Number(folder.count) || 0)
  })) : [];
}

function mediaAudioFolderIsExcluded(folder, excluded = getMediaAudioImportExclusions()) {
  const location = mediaAudioCanonicalLocation(folder && folder.volumeName, folder && folder.relativePath);
  return excluded.some(parent => {
    const parentLocation = mediaAudioCanonicalLocation(parent.volumeName, parent.relativePath);
    return parentLocation.volume === location.volume
      && (!parentLocation.path || location.path === parentLocation.path || location.path.startsWith(parentLocation.path + "/"));
  });
}

async function readMediaAudioFile(item, volumeName) {
  if (!MN || typeof MN.readFolderFileChunk !== "function" || !item || !item.uri) {
    throw new Error("Leitura de áudio do Android indisponível");
  }
  const parts = [];
  let offset = 0;
  let done = false;
  while (!done) {
    const chunk = await MN.readFolderFileChunk({ uri: item.uri, offset, chunkSize: 512 * 1024 });
    const binary = atob(chunk.base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length) parts.push(bytes);
    offset = Number(chunk.nextOffset) || (offset + bytes.length);
    done = !!chunk.done;
    if (!bytes.length && !done) throw new Error("O Android não retornou dados do áudio.");
  }
  const file = new File(parts, item.name || "áudio", {
    type: item.mimeType || "application/octet-stream",
    lastModified: Math.max(0, Number(item.lastModified) || 0)
  });
  const canonicalKey = mediaAudioCanonicalFileKey(volumeName, item.relativePath, item.name);
  const sourceId = canonicalKey || item.sourceKey;
  if (sourceId) Object.defineProperty(file, "sourceDocumentId", { value: String(sourceId) });
  const path = [normalizeMediaAudioPath(item.relativePath), item.name || ""].filter(Boolean).join("/");
  if (path) Object.defineProperty(file, "sourcePath", { value: path });
  return file;
}


// O carregamento direto usa um File vazio para manter a biblioteca instantânea.
// Ao abrir as letras, lemos o áudio somente então para recuperar letras
// incorporadas que antes eram encontradas pelo jsmediatags na importação.
const embeddedLyricsInFlight = new Map();
async function loadEmbeddedLyrics(song) {
  if (!song || song.lyrics || !song.sourceUri || !MN || typeof window.jsmediatags === "undefined") return false;
  if (embeddedLyricsInFlight.has(song.id)) return embeddedLyricsInFlight.get(song.id);
  const task = (async () => {
    lyricsLookupStatus.set(song.id, "reading-local");
    updateLyricsLookupView(song);
    try {
      const file = await readMediaAudioFile({
        uri: song.sourceUri,
        name: song.file && song.file.name || song.name || "audio",
        mimeType: song.file && song.file.type || "application/octet-stream"
      }, "");
      return await new Promise(resolve => {
        window.jsmediatags.read(file, {
          onSuccess: async result => {
            const embedded = lyricsFromTag(result && result.tags && result.tags.lyrics);
            if (!embedded || !songs.includes(song)) {
              resolve(false);
              return;
            }
            song.lyrics = embedded;
            song.lyricsSource = "embedded";
            song.lyricsSourceId = null;
            song.lyricsSearchAt = 0;
            song.lyricsRetryAt = 0;
            song.lyricsRetryReason = "";
            await dbPut(toRecord(song));
            lyricsLookupStatus.set(song.id, "found");
            refreshAll();
            updateLyricsLookupView(song);
            resolve(true);
          },
          onError: () => resolve(false)
        });
      });
    } catch (error) {
      logErr("lyrics:embedded-media", error);
      return false;
    } finally {
      if (!song.lyrics) {
        lyricsLookupStatus.delete(song.id);
        updateLyricsLookupView(song);
      }
    }
  })();
  embeddedLyricsInFlight.set(song.id, task);
  task.finally(() => embeddedLyricsInFlight.delete(song.id));
  return task;
}

function requestLyrics(song, force = false) {
  return loadEmbeddedLyrics(song).then(found => found || requestOnlineLyrics(song, force));
}

async function loadMediaStoreCover(song) {
  if (!song || song.coverBlob || !song.artworkUri || !MN || typeof MN.readMediaAudioArtwork !== "function") return false;
  try {
    const result = await MN.readMediaAudioArtwork({ uri: song.artworkUri });
    const base64 = String(result && result.base64 || "");
    if (!base64) return false;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: result.mimeType || "image/jpeg" });
    if (!blob.type.startsWith("image/")) return false;
    song.coverBlob = blob;
    if (song.cover) URL.revokeObjectURL(song.cover);
    song.cover = URL.createObjectURL(blob);
    await dbPut(toRecord(song));
    refreshAll();
    if (song.id === currentId) updateFullPlayer();
    return true;
  } catch (e) {
    logErr("media-audio:artwork", e);
    return false;
  }
}

function directMediaAudioSong(item, volumeName, canonical) {
  const name = String(item && item.name || "áudio");
  const baseName = name.replace(/\.[^/.]+$/, "").trim() || "Música";
  const title = String(item && item.title || baseName).trim() || baseName;
  const artist = String(item && item.artist || "Arquivo local").trim() || "Arquivo local";
  const sourceUri = String(item && item.uri || "");
  if (!sourceUri.startsWith("content://")) throw new Error("URI MediaStore inválido");
  const file = new File([], name, {
    type: item.mimeType || "application/octet-stream",
    lastModified: Math.max(0, Number(item.lastModified) || 0)
  });
  try { Object.defineProperty(file, "sourceDocumentId", { value: canonical }); } catch (_) {}
  try { Object.defineProperty(file, "sourcePath", { value: [item.relativePath || "", name].filter(Boolean).join("/") }); } catch (_) {}
  return {
    id: "android-" + canonical,
    name: title,
    artist,
    album: String(item && item.album || ""),
    genre: String(item && item.genre || ""),
    sourceKey: canonical,
    sourceUri,
    artworkUri: String(item && item.artworkUri || ""),
    duration: mediaStoreDurationSeconds(item && item.duration),
    favorite: false,
    file,
    url: URL.createObjectURL(file),
    coverBlob: null,
    cover: null,
    playCount: 0,
    lastPlayed: 0,
    lyrics: "",
    lyricsSource: "",
    lyricsSourceId: null,
    lyricsSearchAt: 0,
    lyricsRetryAt: 0,
    lyricsRetryReason: "",
    seed: null
  };
}

async function importMediaAudioFoldersDirect(folders, options = {}) {
  const excluded = options.excludedFolders || getMediaAudioImportExclusions();
  const active = (Array.isArray(folders) ? folders : []).filter(folder => !mediaAudioFolderIsExcluded(folder, excluded));
  const expected = active.reduce((sum, folder) => sum + (Number(folder.count) || 0), 0);
  const existing = new Set();
  songs.forEach(song => {
    const key = mediaAudioCanonicalFromWatchedSourceKey(song.sourceKey || "");
    if (key) existing.add(key);
  });
  let processed = 0;
  let added = 0;
  let failed = 0;
  let sinceRefresh = 0;
  let firstRendered = false;
  for (const folder of active) {
    let afterId = "";
    let done = false;
    while (!done) {
      const page = await MN.listMediaAudioFiles({
        volumeName: folder.volumeName,
        relativePath: normalizeMediaAudioPath(folder.relativePath),
        afterId,
        limit: 50
      });
      const items = Array.isArray(page && page.items) ? page.items : [];
      for (const item of items) {
        try {
          const itemFolder = { volumeName: folder.volumeName, relativePath: item.relativePath || folder.relativePath };
          const canonical = mediaAudioCanonicalFileKey(folder.volumeName, item.relativePath || folder.relativePath, item.name);
          if (!mediaAudioFolderIsExcluded(itemFolder, excluded) && canonical && !existing.has(canonical)) {
            const song = directMediaAudioSong(item, folder.volumeName, canonical);
            songs.push(song);
            existing.add(canonical);
            const stored = await dbPut(toRecord(song));
            if (!stored) throw new Error("não foi possível salvar a música");
            added++;
            if (!firstRendered) {
              refreshAll();
              firstRendered = true;
              sinceRefresh = 0;
            }
            if (!song.coverBlob && settings.autoCovers) fetchOnlineCover(song);
            if (settings.autoLyrics) requestOnlineLyrics(song);
          }
        } catch (e) {
          failed++;
          logErr("media-audio:direct-import", e);
        }
        processed++;
        sinceRefresh++;
        if (typeof options.onProgress === "function") options.onProgress({ processed, expected, added, failed, item });
        if (sinceRefresh >= 8) {
          refreshAll();
          sinceRefresh = 0;
        }
      }
      const next = String(page && page.nextAfterId || "");
      done = !!(page && page.done) || !items.length || !next || next === afterId;
      afterId = next;
    }
  }
  refreshAll();
  return { processed, expected, added, failed, direct: true };
}


async function importMediaAudioLibraryDirect(options = {}) {
  const excluded = options.excludedFolders || getMediaAudioImportExclusions();
  const incrementalSince = Math.max(0, Number(options.modifiedAfterMs) || 0);
  const incremental = incrementalSince > 0;
  const existing = new Map();
  const seen = new Set();
  songs.forEach(song => {
    const key = mediaAudioCanonicalFromWatchedSourceKey(song.sourceKey || "");
    if (key) existing.set(key, song);
  });
  let volumeName = "";
  let afterId = "";
  let processed = 0;
  let added = 0;
  let failed = 0;
  let sinceRefresh = 0;
  let firstRendered = false;
  let done = false;
  while (!done) {
    const page = await MN.listMediaAudioLibrary({
      volumeName,
      afterId,
      modifiedAfter: incrementalSince,
      limit: 50
    });
    const items = Array.isArray(page && page.items) ? page.items : [];
    for (const item of items) {
      try {
        const canonical = mediaAudioCanonicalFileKey(page.volumeName, item.relativePath || "", item.name);
        const excludedItem = mediaAudioFolderIsExcluded({ volumeName: page.volumeName, relativePath: item.relativePath || "" }, excluded);
        if (!excludedItem && canonical) {
          seen.add(canonical);
          const existingSong = existing.get(canonical);
          if (existingSong) {
            let metadataChanged = false;
            const nextUri = String(item.uri || "");
            const nextArtworkUri = String(item.artworkUri || "");
            const nextDuration = mediaStoreDurationSeconds(item.duration);
            const nextName = String(item.title || existingSong.name || "").trim();
            const nextArtist = String(item.artist || existingSong.artist || "").trim();
            const nextAlbum = String(item.album || existingSong.album || "").trim();
            if (nextUri && existingSong.sourceUri !== nextUri) {
              existingSong.sourceUri = nextUri;
              metadataChanged = true;
            }
            if (nextArtworkUri && existingSong.artworkUri !== nextArtworkUri) {
              existingSong.artworkUri = nextArtworkUri;
              metadataChanged = true;
            }
            if (nextDuration > 0 && existingSong.duration !== nextDuration) {
              existingSong.duration = nextDuration;
              metadataChanged = true;
            }
            if (nextName && existingSong.name !== nextName) {
              existingSong.name = nextName;
              metadataChanged = true;
            }
            if (nextArtist && existingSong.artist !== nextArtist) {
              existingSong.artist = nextArtist;
              metadataChanged = true;
            }
            if (existingSong.album !== nextAlbum) {
              existingSong.album = nextAlbum;
              metadataChanged = true;
            }
            if (metadataChanged) await dbPut(toRecord(existingSong));
            if (!existingSong.coverBlob) {
              loadMediaStoreCover(existingSong).then(found => {
                if (!found && settings.autoCovers) fetchOnlineCover(existingSong);
              });
            }
          } else {
            const song = directMediaAudioSong(item, page.volumeName, canonical);
            songs.push(song);
            existing.set(canonical, song);
            if (!await dbPut(toRecord(song))) throw new Error("não foi possível salvar a música");
            added++;
            if (!firstRendered) {
              refreshAll();
              firstRendered = true;
              sinceRefresh = 0;
            }
            loadMediaStoreCover(song).then(found => {
              if (!found && settings.autoCovers) fetchOnlineCover(song);
            });
            if (settings.autoLyrics) requestOnlineLyrics(song);
          }
        }
      } catch (e) {
        failed++;
        logErr("media-audio:global-import", e);
      }
      processed++;
      sinceRefresh++;
      if (typeof options.onProgress === "function") options.onProgress({ processed, added, failed, item });
      if (sinceRefresh >= 8) {
        refreshAll();
        sinceRefresh = 0;
      }
    }
    done = !!(page && page.done);
    volumeName = String(page && page.nextVolume || page && page.volumeName || "");
    afterId = String(page && page.nextAfterId || "0");
    if (!items.length && !done && volumeName === String(page && page.volumeName || "")) {
      throw new Error("MediaStore não avançou a paginação global");
    }
  }
  let removed = 0;
  if (!incremental) {
    const stale = songs.filter(song => {
      const canonical = mediaAudioCanonicalFromWatchedSourceKey(song.sourceKey || "");
      return canonical && !seen.has(canonical) && !mediaAudioCanonicalKeyIsExcluded(canonical, excluded);
    });
    for (const song of stale) {
      if (song.url) URL.revokeObjectURL(song.url);
      if (song.cover) URL.revokeObjectURL(song.cover);
      const index = songs.indexOf(song);
      if (index >= 0) songs.splice(index, 1);
      if (await dbDelete(song.id)) removed++;
    }
  }
  refreshAll();
  return { processed, added, removed, failed, direct: true, incremental };
}
async function importMediaAudioFolders(folders, options = {}) {
  if (!MN || typeof MN.listMediaAudioFiles !== "function") {
    throw new Error("A busca de áudios do aparelho não está disponível nesta versão do Nyx.");
  }
  const excluded = options.excludedFolders || getMediaAudioImportExclusions();
  const active = (Array.isArray(folders) ? folders : []).filter(folder => !mediaAudioFolderIsExcluded(folder, excluded));
  const expected = active.reduce((sum, folder) => sum + (Number(folder.count) || 0), 0);
  const existingCanonical = new Set();
  songs.forEach(song => {
    const canonical = mediaAudioCanonicalFromWatchedSourceKey(song.sourceKey || (song.file ? fileIdentity(song.file) : ""));
    if (canonical) existingCanonical.add(canonical);
  });
  let processed = 0;
  let added = 0;
  let failed = 0;
  let sinceRefresh = 0;
  let firstSongRendered = false;

  for (const folder of active) {
    let afterId = "";
    let done = false;
    while (!done) {
      const page = await MN.listMediaAudioFiles({
        volumeName: folder.volumeName,
        relativePath: normalizeMediaAudioPath(folder.relativePath),
        afterId,
        limit: 50
      });
      const items = Array.isArray(page && page.items) ? page.items : [];
      for (const item of items) {
        try {
          const itemFolder = {
            volumeName: folder.volumeName,
            relativePath: item.relativePath || folder.relativePath
          };
          const latestExclusions = () => excluded.concat(getMediaAudioImportExclusions());
          if (mediaAudioFolderIsExcluded(itemFolder, latestExclusions())) {
            processed++;
            if (typeof options.onProgress === "function") options.onProgress({ processed, expected, added, failed, item });
            continue;
          }
          const canonical = mediaAudioCanonicalFileKey(folder.volumeName, item.relativePath || folder.relativePath, item.name);
          if (canonical && existingCanonical.has(canonical)) {
            processed++;
            if (typeof options.onProgress === "function") options.onProgress({ processed, expected, added, failed, item });
            continue;
          }
          const file = await readMediaAudioFile(item, folder.volumeName);
          if (mediaAudioFolderIsExcluded(itemFolder, latestExclusions())) {
            processed++;
            if (typeof options.onProgress === "function") options.onProgress({ processed, expected, added, failed, item });
            continue;
          }
          const result = await addFile(file);
          if (result.added) {
            added++;
            if (canonical) existingCanonical.add(canonical);
          }
        } catch (e) {
          failed++;
          logErr("media-audio:import", e);
        }
        processed++;
        sinceRefresh++;
        if (typeof options.onProgress === "function") options.onProgress({ processed, expected, added, failed, item });
        // Mostre a primeira faixa assim que ela estiver salva. Depois, atualize
        // em lotes menores para não deixar a biblioteca parecer vazia durante a busca.
        if (added > 0 && !firstSongRendered) {
          refreshAll();
          firstSongRendered = true;
          sinceRefresh = 0;
        } else if (sinceRefresh >= 4) {
          refreshAll();
          sinceRefresh = 0;
        }
      }
      const next = String(page && page.nextAfterId || "");
      done = !!(page && page.done) || !items.length || !next || next === afterId;
      afterId = next;
    }
  }
  refreshAll();
  return { processed, expected, added, failed };
}

let mediaAudioSyncPromise = null;
let mediaAudioSyncRequested = false;
let mediaAudioSyncManualRequested = false;
const MEDIA_AUDIO_LAST_SYNC_KEY = "mediaAudioLastSyncAt";
const MEDIA_AUDIO_FULL_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
const MEDIA_AUDIO_SYNC_OVERLAP = 5 * 1000;

async function runMediaAudioSync(manual) {
  if (typeof MN.hasAudioLibraryAccess !== "function" || typeof MN.listMediaAudioFolders !== "function") return null;
  const access = await MN.hasAudioLibraryAccess();
  if (!access || !access.granted) {
    if (manual) showToast("Permita o acesso aos áudios nas configurações do Android para atualizar a biblioteca.");
    return null;
  }
  const now = Date.now();
  const lastSyncAt = Number(lsGet(MEDIA_AUDIO_LAST_SYNC_KEY, 0)) || 0;
  const fullScan = manual || !lastSyncAt || now - lastSyncAt >= MEDIA_AUDIO_FULL_SYNC_INTERVAL;
  let imported;
  try {
    if (typeof MN.listMediaAudioLibrary === "function") {
      imported = await importMediaAudioLibraryDirect({
        // DATE_MODIFIED do MediaStore tem precisão de segundos; a sobreposição
        // evita perder uma alteração feita exatamente na fronteira da sincronização.
        modifiedAfterMs: fullScan ? 0 : Math.max(0, lastSyncAt - MEDIA_AUDIO_SYNC_OVERLAP)
      });
    } else {
      const result = await MN.listMediaAudioFolders();
      const folders = Array.isArray(result && result.folders) ? result.folders : [];
      setMediaAudioFoldersCache(folders);
      imported = typeof MN.listMediaAudioFiles === "function"
        ? await importMediaAudioFoldersDirect(folders)
        : await importMediaAudioFolders(folders);
    }
  } catch (directError) {
    logErr("media-audio:direct-fallback", directError);
    const result = await MN.listMediaAudioFolders();
    const folders = Array.isArray(result && result.folders) ? result.folders : [];
    setMediaAudioFoldersCache(folders);
    imported = await importMediaAudioFolders(folders);
  }
  if (imported && imported.direct) lsSet(MEDIA_AUDIO_LAST_SYNC_KEY, now);
  if (manual) {
    if (imported.failed) showToast("Alguns áudios não puderam ser importados. Você pode tentar novamente em Ajustes.");
    else if (imported.removed) showToast(imported.removed + (imported.removed === 1 ? " música removida" : " músicas removidas") + " da biblioteca");
    else if (imported.added) showToast(imported.added + (imported.added === 1 ? " áudio novo importado" : " áudios novos importados"));
    else showToast("A biblioteca já está atualizada.");
  }
  return imported;
}

function syncMediaAudioLibrary(manual = false) {
  if (!MN || !lsGet("mediaAudioEnabled", false)) return Promise.resolve(null);
  if (mediaAudioSyncPromise) {
    mediaAudioSyncRequested = true;
    mediaAudioSyncManualRequested = mediaAudioSyncManualRequested || manual;
    return mediaAudioSyncPromise;
  }
  mediaAudioSyncPromise = (async () => {
    let report = manual;
    let result = null;
    do {
      mediaAudioSyncRequested = false;
      report = report || mediaAudioSyncManualRequested;
      mediaAudioSyncManualRequested = false;
      try {
        result = await runMediaAudioSync(report);
      } catch (error) {
        logErr("media-audio:sync", error);
        if (report) showToast("Não foi possível atualizar os áudios. Tente novamente.");
        result = null;
      }
      report = false;
    } while (mediaAudioSyncRequested);
    return result;
  })().finally(() => { mediaAudioSyncPromise = null; });
  return mediaAudioSyncPromise;
}

let fileImportTask = Promise.resolve();
fileInput.addEventListener("change", () => {
  fileImportTask = importFiles(fileInput.files);
  fileInput.value = "";
});

/* ==========================================================
   Importar pasta
   ========================================================== */
const folderInput = $("folderInput");

// Percorre a pasta e as subpastas (File System Access API)
async function collectFromDirectory(dirHandle, out, prefix = "") {
  for await (const entry of dirHandle.values()) {
    const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.kind === "file") {
      try {
        const file = await entry.getFile();
        try { Object.defineProperty(file, "sourcePath", { value: relativePath }); } catch (e) { logErr("importar:492", e); }
        if ((file.type || "").startsWith("audio/") || audioExt.test(file.name) || lrcExt.test(file.name)) out.push(file);
      } catch (e) { logErr("importar:494", e); }
    } else if (entry.kind === "directory") {
      await collectFromDirectory(entry, out, relativePath);
    }
  }
}

async function importFolder() {
  // No APK, usa o seletor nativo de pastas do Android (Storage Access Framework).
  if (MN && typeof MN.pickFolder === "function") {
    try {
      const selected = await MN.pickFolder();
      if (!selected || selected.cancelled) return;

      showToast("Lendo a pasta…");
      const listing = await MN.listFolderAudio({ uri: selected.uri });
      const found = [];

      for (const item of (listing.files || [])) {
        let file;
        if (typeof MN.readFolderFileChunk === "function") {
          // Blocos pequenos evitam manter uma Base64 enorme na memória do WebView.
          const parts = [];
          let offset = 0;
          let done = false;
          while (!done) {
            const chunk = await MN.readFolderFileChunk({
              uri: item.uri,
              offset,
              chunkSize: 512 * 1024
            });
            const binary = atob(chunk.base64 || "");
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            if (bytes.length) parts.push(bytes);
            offset = Number(chunk.nextOffset) || (offset + bytes.length);
            done = !!chunk.done;
            if (!bytes.length && !done) throw new Error("O Android não retornou dados do arquivo.");
          }
          file = new File(parts, item.name, {
            type: item.mimeType || "application/octet-stream",
            lastModified: Date.now()
          });
        } else {
          // Compatibilidade com APKs que ainda não possuem a leitura em blocos.
          const result = await MN.readFolderFile({ uri: item.uri });
          const binary = atob(result.base64 || "");
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          file = new File([bytes], item.name, {
            type: item.mimeType || "application/octet-stream",
            lastModified: Date.now()
          });
        }
        try {
          Object.defineProperty(file, "sourcePath", { value: item.relativePath || item.name });
        } catch (e) { logErr("importar:523", e); }
        found.push(file);
      }

      await importFiles(found, "“" + (selected.name || "pasta") + "”");
      return { name: selected.name || "pasta", count: found.length }; // resumo usado pela introdução
    } catch (e) {
      console.error("Falha ao importar pasta pelo Android:", e);
      showToast("Não foi possível ler essa pasta. Tente novamente ou escolha as músicas individualmente.");
      return;
    }
  }

  // Compatibilidade com a versão web.
  if (window.showDirectoryPicker) {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ mode: "read" });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      showToast("A seleção de pasta não está disponível aqui; tentando o seletor do navegador.");
    }

    if (dir) {
      try {
        showToast("Lendo a pasta…");
        const found = [];
        await collectFromDirectory(dir, found, dir.name);
        await importFiles(found, "“" + dir.name + "”");
        return { name: dir.name, count: found.length };
      } catch (_) {
        showToast("Não consegui ler essa pasta; tentando o seletor do navegador.");
      }
    }
  }

  folderInput.click();
}

folderInput.addEventListener("change", () => {
  const list = Array.from(folderInput.files || []);
  let nome = "";
  if (list[0] && list[0].webkitRelativePath) nome = "“" + list[0].webkitRelativePath.split("/")[0] + "”";
  importFiles(list, nome || "a pasta");
  folderInput.value = "";
});
