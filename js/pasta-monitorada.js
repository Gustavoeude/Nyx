"use strict";

/* ==========================================================
   Diretórios de música e diretórios ignorados (Android)
   Pastas monitoradas são verificadas ao abrir/retomar o app e
   pelo botão Atualizar agora. Pastas ignoradas são excluídas
   da varredura em todos os diretórios monitorados.
   ========================================================== */
let watchedSyncing = false;
let watchedLastSync = 0;

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
    sourceKey: "saf::" + item.uri,
    sourceUri: item.uri,
    sourceTreeUri: folder.uri,
    sourceSize: Number(item.size) || 0,
    sourceLastModified: Number(item.lastModified) || 0,
    sourceRelativePath: keys.relativePath,
    sourceMimeType: item.mimeType || "application/octet-stream",
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

async function importSafListing(listing, folder, ignoredUris = []) {
  const items = Array.isArray(listing && listing.files) ? listing.files : [];
  const audio = items.filter(isSafAudio);
  const sidecars = items.filter(item => /\.lrc$/i.test(item.name || ""));
  const ignored = new Set(ignoredUris || []);
  const fresh = [];

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
      }
      continue;
    }
    const song = makeSafSong(item, folder);
    songs.push(song);
    fresh.push({ song, item });
  }

  if (!fresh.length) return 0;
  await dbPutMany(fresh.map(({ song }) => toRecord(song)));
  refreshAll();
  showToast("Adicionei " + fresh.length + (fresh.length === 1 ? " música" : " músicas"));

  // Sidecars são pequenos; lê-los sem bloquear a aparição da biblioteca.
  const sidecarByPath = new Map(sidecars.map(item => [normalizedSidecarPath(item), item]));
  void Promise.all(fresh.map(async ({ song, item }) => {
    const sidecar = sidecarByPath.get(normalizedSidecarPath(item));
    if (!sidecar || song.lyrics) return;
    const text = await readSafSidecar(sidecar);
    if (!text || !parseLrc(text).lines.length || !songs.includes(song) || song.lyrics) return;
    song.lyrics = text;
    song.lyricsSource = "lrc";
    await dbPut(toRecord(song));
    if (song.id === currentId) renderLyrics(song);
  }));
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
