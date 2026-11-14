"use strict";

/* ==========================================================
   Diretórios de música e diretórios ignorados (Android)
   Pastas monitoradas são verificadas ao abrir/retomar o app e
   pelo botão Atualizar agora. Pastas ignoradas são excluídas
   da varredura em todos os diretórios monitorados.
   ========================================================== */
let watchedSyncing = false;
let watchedLastSync = 0;
const safCoverJobs = new Map();

function normalizeDirectoryList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(item => {
    if (!item || typeof item.uri !== "string" || !item.uri || seen.has(item.uri)) return false;
    seen.add(item.uri);
    return true;
  }).map(item => ({ uri: item.uri, name: item.name || "pasta" }));
}

function getWatchedFolders() {
  const saved = lsGet("watchedFolders", null);
  if (Array.isArray(saved)) return normalizeDirectoryList(saved);
  const legacy = lsGet("watchedFolder", null);
  return legacy && legacy.uri ? [{ uri: legacy.uri, name: legacy.name || "pasta" }] : [];
}

function getIgnoredFolders() {
  return normalizeDirectoryList(lsGet("ignoredFolders", []));
}

function setDirectories(kind, list) {
  lsSet(kind === "ignored" ? "ignoredFolders" : "watchedFolders", normalizeDirectoryList(list));
}

function watchedItemPaths(item, folder) {
  const relativePath = String(item.relativePath || item.name || "").replace(/\\/g, "/");
  const size = Number(item.size) || 0;
  const lastModified = Number(item.lastModified) || 0;
  return {
    relativePath,
    sourcePath: folder.uri + "::" + relativePath,
    sourceKey: [item.name, size, lastModified, folder.uri + "::" + relativePath].join("::"),
    legacyKey: [item.name, size, lastModified, relativePath].join("::")
  };
}

function normalizedSidecarPath(item) {
  return String(item.relativePath || item.name || "")
    .replace(/\\/g, "/")
    .replace(/\.[^/.]+$/, "")
    .normalize("NFKC")
    .toLocaleLowerCase("pt-BR");
}

function isSafAudio(item) {
  return !!item && !/\.lrc$/i.test(item.name || "") &&
    (((item.mimeType || "").startsWith("audio/")) || audioExt.test(item.name || ""));
}

function makeSafSong(item, folder) {
  const base = String(item.name || "Música").replace(/\.[^/.]+$/, "").trim() || "Música";
  const parts = base.split(/\s+-\s+/, 2);
  const hasArtist = parts.length === 2 && parts[0].trim() && parts[1].trim();
  const keys = watchedItemPaths(item, folder);
  return {
    id: Date.now() + Math.random(),
    name: hasArtist ? parts[1].trim() : base,
    artist: hasArtist ? parts[0].trim() : "Arquivo local",
    album: "",
    genre: "",
    duration: 0,
    sourceKey: "saf::" + item.uri,
    sourceUri: item.uri,
    sourceTreeUri: folder.uri,
    sourceSize: Number(item.size) || 0,
    sourceLastModified: Number(item.lastModified) || 0,
    sourceRelativePath: keys.relativePath,
    sourceMimeType: item.mimeType || "application/octet-stream",
    sourceCoverChecked: false,
    sourceMetadataChecked: false,
    sourceMetadataVersion: 0,
    favorite: false,
    file: null,
    url: null,
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

async function readSafSidecar(item) {
  if (typeof MN.readFolderFile !== "function") return "";
  try {
    const result = await MN.readFolderFile({ uri: item.uri });
    const binary = atob(result.base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "").trim();
  } catch (e) {
    logErr("pasta:sidecar", e);
    return "";
  }
}

async function loadSafMetadata(entries) {
  const unique = [];
  for (const entry of entries) {
    const key = String(entry.song.id);
    if ((Number(entry.song.sourceMetadataVersion) >= 1 && entry.song.sourceMetadataChecked && (entry.song.coverBlob || entry.song.sourceCoverChecked)) || safCoverJobs.has(key)) continue;
    const job = Promise.resolve();
    safCoverJobs.set(key, job);
    unique.push({ ...entry, key });
  }
  if (!unique.length) return;

  let cursor = 0;
  let completed = 0;
  const pending = [];
  let flushQueue = Promise.resolve();
  const flush = () => {
    const batch = pending.splice(0);
    if (!batch.length) return flushQueue;
    flushQueue = flushQueue.then(async () => {
      await dbPutMany(batch.map(song => toRecord(song)));
      refreshAll();
    });
    return flushQueue;
  };

  const worker = async () => {
    while (cursor < unique.length) {
      const entry = unique[cursor++];
      const { song, item, key } = entry;
      const metadataVersionBefore = Number(song.sourceMetadataVersion) || 0;
      let metadataRead = false;
      try {
        if (MN && typeof MN.extractEmbeddedCover === "function") {
          const result = await MN.extractEmbeddedCover({ uri: item.uri });
          metadataRead = true;
          song.sourceCoverChecked = true;
          song.sourceMetadataChecked = true;
          song.sourceMetadataVersion = 1;
          const title = String(result && result.title || "").trim();
          const artist = String(result && (result.artist || result.albumArtist) || "").trim();
          const album = String(result && result.album || "").trim();
          const genre = String(result && result.genre || "").trim();
          if (title) song.name = title;
          if (artist) song.artist = artist;
          if (album) song.album = album;
          if (genre) song.genre = typeof cleanGenre === "function" ? cleanGenre(genre) : genre;
          const duration = Number(result && result.durationMs) / 1000;
          if (Number.isFinite(duration) && duration > 0 && duration <= 3600) song.duration = duration;
          if (result && result.base64) {
            const binary = atob(result.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: result.mimeType || "image/jpeg" });
            if (!song.coverBlob && blob.type.startsWith("image/") && blob.size) {
              song.coverBlob = blob;
              if (song.cover) URL.revokeObjectURL(song.cover);
              song.cover = URL.createObjectURL(blob);
            }
          }
        }
      } catch (e) {
        logErr("pasta:extract-metadata", e);
      }

      if (metadataRead) {
        if (metadataVersionBefore < 1) {
          song.lyricsSearchAt = 0;
          if (song.lyricsRetryReason !== "rate" && song.lyricsRetryReason !== "busy") {
            song.lyricsRetryAt = 0;
            song.lyricsRetryReason = "";
          }
        }
        pending.push(song);
        if (pending.length >= 4) await flush();
      }
      if (!song.coverBlob && typeof fetchOnlineCover === "function") void fetchOnlineCover(song);
      if (typeof maybeRequestLyrics === "function") void maybeRequestLyrics(song);
      completed++;
      if (completed % 8 === 0) await flushQueue;
      safCoverJobs.delete(key);
    }
  };

  await Promise.all([worker(), worker()]);
  await flush();
}

async function importSafListing(listing, folder, ignoredUris = []) {
  const items = Array.isArray(listing && listing.files) ? listing.files : [];
  const audio = items.filter(isSafAudio);
  const sidecars = items.filter(item => /\.lrc$/i.test(item.name || ""));
  const ignored = new Set(ignoredUris || []);
  const fresh = [];
  const coverTargets = [];
  const sidecarTargets = [];

  for (const item of audio) {
    if (!item.uri || ignored.has(item.uri)) continue;
    const keys = watchedItemPaths(item, folder);
    const duplicate = songs.find(song =>
      song.sourceUri === item.uri || song.sourceKey === keys.sourceKey ||
      (song.file && [fileIdentity(song.file), song.sourceKey].some(key => key === keys.sourceKey || key === keys.legacyKey))
    );
    if (duplicate) {
      if (duplicate.sourceUri) {
        duplicate.sourceSize = Number(item.size) || duplicate.sourceSize || 0;
        duplicate.sourceLastModified = Number(item.lastModified) || duplicate.sourceLastModified || 0;
        duplicate.sourceTreeUri = folder.uri;
        duplicate.sourceRelativePath = keys.relativePath;
        if (duplicate.sourceUri) sidecarTargets.push({ song: duplicate, item });
        if (Number(duplicate.sourceMetadataVersion) < 1 || !duplicate.sourceMetadataChecked || (!duplicate.coverBlob && !duplicate.sourceCoverChecked)) coverTargets.push({ song: duplicate, item });
      }
      continue;
    }
    const song = makeSafSong(item, folder);
    songs.push(song);
    fresh.push({ song, item });
    coverTargets.push({ song, item });
    sidecarTargets.push({ song, item });
  }

  if (fresh.length) {
    await dbPutMany(fresh.map(({ song }) => toRecord(song)));
    refreshAll();
    showToast("Adicionei " + fresh.length + (fresh.length === 1 ? " música" : " músicas"));
  }

  // Sidecars são pequenos; lê-los sem bloquear a aparição da biblioteca.
  const sidecarByPath = new Map(sidecars.map(item => [normalizedSidecarPath(item), item]));
  const sidecarTask = Promise.all(sidecarTargets.map(async ({ song, item }) => {
    const sidecar = sidecarByPath.get(normalizedSidecarPath(item));
    if (!sidecar || hasSyncedLyrics(song)) return;
    const text = await readSafSidecar(sidecar);
    const parsed = text ? parseLrc(text) : null;
    if (!parsed || !parsed.lines.length || !songs.includes(song) || hasSyncedLyrics(song) || (song.lyrics && !parsed.synced)) return;
    song.lyrics = text;
    song.lyricsSource = "lrc";
    await dbPut(toRecord(song));
    if (song.id === currentId) renderLyrics(song);
  }));
  void sidecarTask.then(() => loadSafMetadata(coverTargets)).catch(e => logErr("pasta:metadata-worker", e));
  return fresh.length;
}

async function syncWatchedFolder(manual) {
  const folders = getWatchedFolders();
  if (!MN || typeof MN.listFolderAudio !== "function" || !folders.length || watchedSyncing) return;
  watchedSyncing = true;
  try {
    const ignoredUris = getIgnoredFolders().map(folder => folder.uri);
    let added = 0;
    for (const folder of folders) {
      const listing = await MN.listFolderAudio({ uri: folder.uri, ignoredUris });
      added += await importSafListing(listing, folder);
    }

    if (!added) {
      if (manual) showToast("Diretórios já estão atualizados");
      watchedLastSync = Date.now();
      return;
    }

    watchedLastSync = Date.now();
  } catch (e) {
    logErr("pasta:sync", e);
    if (manual) showToast("Não consegui ler um diretório. Verifique o acesso à pasta nos Ajustes.");
  } finally {
    watchedSyncing = false;
  }
}

async function addDirectory(kind) {
  if (!MN || typeof MN.pickFolder !== "function") {
    showToast("A seleção de diretórios só funciona no app Android");
    return false;
  }
  try {
    const selected = await MN.pickFolder();
    if (!selected || selected.cancelled) return false;
    const ignored = kind === "ignored";
    const current = ignored ? getIgnoredFolders() : getWatchedFolders();
    if (current.some(folder => folder.uri === selected.uri)) {
      showToast("Esse diretório já está na lista");
      return false;
    }
    current.push({ uri: selected.uri, name: selected.name || "pasta" });
    setDirectories(kind, current);
    if (ignored) {
      showToast("Diretório adicionado à lista de ignorados");
      await syncWatchedFolder(false);
    } else {
      await syncWatchedFolder(true);
    }
    return true;
  } catch (e) {
    logErr("pasta:add", e);
    showToast("Não foi possível adicionar esse diretório");
    return false;
  }
}

async function removeDirectory(kind, uri) {
  const ignored = kind === "ignored";
  const current = ignored ? getIgnoredFolders() : getWatchedFolders();
  setDirectories(kind, current.filter(folder => folder.uri !== uri));
  showToast(ignored
    ? "Diretório removido da lista de ignorados"
    : "Diretório removido; as músicas já adicionadas continuam");
  if (ignored) await syncWatchedFolder(false);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - watchedLastSync > 30000) {
    syncWatchedFolder(false);
  }
});
