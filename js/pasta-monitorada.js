"use strict";

/* ==========================================================
   Diretórios de música e diretórios ignorados (Android)
   Pastas monitoradas são verificadas ao abrir/retomar o app e
   pelo botão Atualizar agora. Pastas ignoradas são excluídas
   da varredura em todos os diretórios monitorados.
   ========================================================== */
let watchedSyncing = false;
let watchedLastSync = 0;
let watchedSyncRequested = false;
let watchedSyncRequestedManual = false;
let watchedSyncRequestedOptions = null;
let watchedSyncWaiters = [];

function resolveWatchedSyncWaiters(result = false) {
  if (watchedSyncing || watchedSyncRequested) return;
  const waiters = watchedSyncWaiters.splice(0);
  waiters.forEach(resolve => resolve(!!result));
}

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
  const documentKey = watchedDocumentKey(item);
  const canonicalKey = typeof mediaAudioCanonicalFromSaf === "function"
    ? mediaAudioCanonicalFromSaf(folder.uri, relativePath)
    : "";
  return {
    relativePath,
    sourcePath: folder.uri + "::" + relativePath,
    sourceKey: canonicalKey || [item.name, size, lastModified, folder.uri + "::" + relativePath].join("::"),
    legacyKey: [item.name, size, lastModified, relativePath].join("::"),
    documentKey,
    canonicalKey
  };
}

function watchedDocumentKey(item) {
  const uri = String(item && item.uri || "");
  const match = uri.match(/^([a-z][a-z\d+.-]*:\/\/[^/]+)\/(?:tree\/[^/]+\/)?document\/([^/?#]+)(?:[?#].*)?$/i);
  if (!match) return "";
  let documentId;
  try { documentId = decodeURIComponent(match[2]); } catch (_) { return ""; }
  return "android-document::" + match[1].toLocaleLowerCase("en-US") + "::" + documentId;
}

async function readWatchedFile(item, folder) {
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
    if (!bytes.length && !done) throw new Error("O Android não retornou dados do arquivo.");
  }
  const file = new File(parts, item.name, {
    type: item.mimeType || "application/octet-stream",
    lastModified: Number(item.lastModified) || 0
  });
  const paths = watchedItemPaths(item, folder);
  try { Object.defineProperty(file, "sourcePath", { value: paths.sourcePath }); } catch (e) { logErr("pasta:read", e); }
  const sourceDocumentId = paths.canonicalKey || paths.documentKey;
  if (sourceDocumentId) {
    try { Object.defineProperty(file, "sourceDocumentId", { value: sourceDocumentId }); }
    catch (e) { logErr("pasta:read-id", e); }
  }
  return file;
}

function normalizedSidecarPath(item) {
  return String(item.relativePath || item.name || "")
    .replace(/\\/g, "/")
    .replace(/\.[^/.]+$/, "")
    .normalize("NFKC")
    .toLocaleLowerCase("pt-BR");
}

async function syncWatchedFolder(manual, options = {}) {
  const folders = getWatchedFolders();
  if (!MN || typeof MN.listFolderAudio !== "function" || !folders.length) return false;
  if (watchedSyncing) {
    watchedSyncRequested = true;
    watchedSyncRequestedManual = watchedSyncRequestedManual || !!manual;
    if (options.cachedListings) watchedSyncRequestedOptions = options;
    return new Promise(resolve => watchedSyncWaiters.push(resolve));
  }
  watchedSyncing = true;
  let syncResult = false;
  try {
    const ignoredUris = getIgnoredFolders().map(folder => folder.uri);
    const mediaExcluded = typeof getMediaAudioImportExclusions === "function" ? getMediaAudioImportExclusions() : [];
    const known = new Set();
    const legacyKnown = new Set();
    for (const song of songs) {
      const key = song.sourceKey || (song.file ? fileIdentity(song.file) : "");
      if (key) {
        known.add(key);
        legacyKnown.add(key);
        if (typeof mediaAudioCanonicalFromWatchedSourceKey === "function") {
          const canonical = mediaAudioCanonicalFromWatchedSourceKey(key);
          if (canonical) known.add(canonical);
        }
      }
    }

    let discovered = 0;
    let failedFolders = false;
    let readFailures = 0;
    let importFailures = 0;
    let addedTotal = 0;
    for (const folder of folders) {
      let listing;
      const cachedListing = options.cachedListings && options.cachedListings.get(folder.uri);
      if (cachedListing) {
        listing = cachedListing;
      } else {
        try {
          listing = await MN.listFolderAudio({ uri: folder.uri, ignoredUris });
        } catch (e) {
          failedFolders = true;
          logErr("pasta:list-folder", e);
          continue;
        }
      }
      const skipPaths = options.skipPathsByUri && options.skipPathsByUri.get(folder.uri) || [];
      const items = (listing.files || []).filter(item => {
        const path = String(item.relativePath || item.name || "").replace(/\\/g, "/");
        if (skipPaths.some(skip => path === skip || path.startsWith(skip + "/"))) return false;
        if (mediaExcluded.length && typeof mediaAudioCanonicalFromSaf === "function"
            && typeof mediaAudioCanonicalKeyIsExcluded === "function") {
          const canonical = mediaAudioCanonicalFromSaf(folder.uri, path);
          if (mediaAudioCanonicalKeyIsExcluded(canonical, mediaExcluded)) return false;
        }
        return true;
      });
      const audio = items.filter(item => !/\.lrc$/i.test(item.name || ""));
      const fresh = audio.filter(item => {
        const keys = watchedItemPaths(item, folder);
        if (keys.canonicalKey && known.has(keys.canonicalKey)) return false;
        if ((keys.documentKey && known.has(keys.documentKey)) || known.has(keys.sourceKey) || legacyKnown.has(keys.legacyKey)) return false;
        if (keys.documentKey) known.add(keys.documentKey);
        if (keys.canonicalKey) known.add(keys.canonicalKey);
        known.add(keys.sourceKey);
        return true;
      });
      if (!fresh.length) continue;

      discovered += fresh.length;
      const sidecars = new Map();
      items.filter(item => /\.lrc$/i.test(item.name || "")).forEach(item => {
        const key = normalizedSidecarPath(item);
        if (!sidecars.has(key)) sidecars.set(key, []);
        sidecars.get(key).push(item);
      });

      // Não espere a leitura de toda a pasta: a primeira faixa aparece na biblioteca
      // assim que estiver pronta; depois atualizamos em lotes para evitar redesenhos excessivos.
      let index = 0;
      while (index < fresh.length) {
        const batchSize = addedTotal === 0 ? 1 : 8;
        const batch = fresh.slice(index, index + batchSize);
        index += batch.length;
        const files = [];
        for (const item of batch) {
          try {
            files.push(await readWatchedFile(item, folder));
          } catch (e) {
            readFailures++;
            logErr("pasta:read-file", e);
            continue;
          }
          for (const sidecar of sidecars.get(normalizedSidecarPath(item)) || []) {
            try { files.push(await readWatchedFile(sidecar, folder)); }
            catch (e) { readFailures++; logErr("pasta:read-sidecar", e); }
          }
        }
        if (files.some(file => !/\.lrc$/i.test(file.name || ""))) {
          const result = await importFiles(files, "diretórios monitorados", { silent: true });
          addedTotal += result.added;
          importFailures += Number(result.failed) || 0;
        }
      }
    }

    if (!discovered) {
      if (manual) showToast(failedFolders
        ? "Não consegui ler um diretório. Verifique o acesso à pasta nos Ajustes."
        : "Diretórios já estão atualizados");
      watchedLastSync = Date.now();
      syncResult = !failedFolders;
      return syncResult;
    }

    if (manual) {
      let message = addedTotal
        ? addedTotal + (addedTotal === 1 ? " música adicionada" : " músicas adicionadas")
        : readFailures ? "Não consegui ler as músicas encontradas. Verifique o acesso à pasta."
        : "As músicas encontradas já estão na biblioteca";
      if (failedFolders) message += ". Alguns diretórios não puderam ser lidos";
      else if (readFailures) message += ". Algumas faixas não puderam ser lidas";
      showToast(message);
    }
    watchedLastSync = Date.now();
    syncResult = !failedFolders && !readFailures && !importFailures;
    return syncResult;
  } catch (e) {
    logErr("pasta:sync", e);
    if (manual) showToast("Não consegui ler um diretório. Verifique o acesso à pasta nos Ajustes.");
    return false;
  } finally {
    watchedSyncing = false;
    if (watchedSyncRequested) {
      const rerunManual = watchedSyncRequestedManual;
      const rerunOptions = watchedSyncRequestedOptions || {};
      watchedSyncRequested = false;
      watchedSyncRequestedManual = false;
      watchedSyncRequestedOptions = null;
      syncWatchedFolder(rerunManual, rerunOptions)
        .then(resolveWatchedSyncWaiters)
        .catch(e => { logErr("pasta:rerun", e); resolveWatchedSyncWaiters(false); });
    } else resolveWatchedSyncWaiters(syncResult);
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
