"use strict";

/* ==========================================================
   Adicionar músicas
   ========================================================== */
function openFilePicker() {
  fileInput.click();
}

$("addBtn").onclick = openFilePicker;
$("libraryAdd").onclick = openFilePicker;

const audioExt = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|weba|webm|aiff|aif|alac|amr|3gp)$/i;
const lrcExt = /\.lrc$/i;

function fileIdentity(file) {
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
  return !artist || ["arquivo local", "artista desconhecido", "unknown"].includes(artist) ? "" : artist;
}

function readLocalTrackDuration(song) {
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
  const title = normalizeLyricsLookup(lyricsLookupTitle(song));
  if (!title || !Array.isArray(records)) return null;
  const artist = lyricsLookupArtist(song);
  // Primeiro tenta título + artista exatos. Se o cadastro do artista variar,
  // mantém os resultados do título e só aceita quando não houver ambiguidade.
  const titleMatches = records.filter(record =>
    normalizeLyricsLookup(record.trackName || record.name) === title
  );
  if (!titleMatches.length) return null;

  let candidates = artist
    ? titleMatches.filter(record => normalizeLyricsLookup(record.artistName) === artist)
    : titleMatches;

  if (!candidates.length) candidates = titleMatches;

  const artists = new Set(candidates.map(record => normalizeLyricsLookup(record.artistName)).filter(Boolean));
  if (artists.size > 1) return null;

  // A duração ajuda a escolher uma versão, mas não deve eliminar uma letra
  // válida quando o arquivo tem alguns segundos de diferença.
  if (Number.isFinite(duration)) {
    const durationMatches = candidates.filter(record =>
      Number.isFinite(Number(record.duration)) && Math.abs(Number(record.duration) - duration) <= 5
    );
    if (durationMatches.length) candidates = durationMatches;
    else if (candidates.some(record => Number.isFinite(Number(record.duration)))) {
      // sem versão parecida: aceita só até 10 s de diferença; mais que isso é outra
      // versão (remix, estendida...) e a letra sairia de sincronia
      const near = candidates.filter(record =>
        Number.isFinite(Number(record.duration)) && Math.abs(Number(record.duration) - duration) <= 10
      );
      if (!near.length) return null;
      candidates = near;
    }
  }
  if (!duration && candidates.length > 1) {
    const albums = new Set(candidates.map(record => normalizeLyricsLookup(record.albumName)).filter(Boolean));
    if (albums.size > 1) return null;
  }
  const album = normalizeLyricsLookup(song && song.album);
  candidates.sort((a, b) => {
    if (album) {
      const albumA = Number(normalizeLyricsLookup(a.albumName) === album);
      const albumB = Number(normalizeLyricsLookup(b.albumName) === album);
      if (albumA !== albumB) return albumB - albumA;
    }
    const sync = Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics);
    if (sync) return sync;
    if (Number.isFinite(duration)) return Math.abs(Number(a.duration) - duration) - Math.abs(Number(b.duration) - duration);
    return 0;
  });
  return candidates.find(record => record.syncedLyrics || record.plainLyrics) || null;
}

async function fetchLyricsRecord(song) {
  const title = lyricsLookupTitle(song);
  if (!title) return null;
  const params = new URLSearchParams({ track_name: title });
  const artist = lyricsLookupArtist(song);
  if (artist) params.set("artist_name", song.artist);
  if (song.album) params.set("album_name", song.album);
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
  const records = await response.json();
  const duration = await readLocalTrackDuration(song);
  return chooseLyricsRecord(song, records, duration);
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
async function importFiles(list, origem) {
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

  if (files.length === 0) {
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
}

fileInput.addEventListener("change", () => {
  importFiles(fileInput.files);
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
