"use strict";

/* ==========================================================
   Pesquisa
   ========================================================== */
$("searchInput").addEventListener("input", renderSearch);

/* ==========================================================
   Inicialização
   ========================================================== */
async function loadSongs() {
  const records = await dbGetAll();
  records.sort((a, b) => a.id - b.id);

  for (const r of records) {
    if (!r || !r.file) continue;
    const song = makeSong(r);
    const genericArtist = !song.artist || ["arquivo local", "artista desconhecido", "unknown"].includes(String(song.artist).trim().toLowerCase());
    if (genericArtist) {
      const inferred = inferLocalArtistFromFilename(song.file);
      if (inferred) {
        song.artist = inferred.artist;
        // Atualiza o título apenas quando ele ainda corresponde ao nome completo do arquivo.
        const savedTitle = String(song.name || "").trim();
        const fileTitle = String(song.file.name || "").replace(/\.[^/.]+$/, "").trim();
        if (!savedTitle || savedTitle === fileTitle) song.name = inferred.title;
        await dbPut(toRecord(song));
      }
    }
    songs.push(song);
  }

  const valid = new Set(allIds());
  let changed = false;
  playlists.forEach(p => {
    const kept = p.songIds.filter(id => valid.has(id));
    if (kept.length !== p.songIds.length) {
      p.songIds = kept;
      changed = true;
    }
  });
  if (changed) savePlaylists();
}

applyTheme();
applySettings();
renderMixMode();
renderAll();
updateHome();
updatePlayButtons();
renderLyrics(null);
initMediaSessionHandlers();
loadCustomFonts();
$("homePage").classList.add("stagger");
setTimeout(() => $("homePage").classList.remove("stagger"), 1100);

loadSongs().then(() => {
  refreshAll();
  if (!maybeStartOnboarding()) maybeAskPermissionsFirstRun();
  if (typeof syncWatchedFolder === "function") syncWatchedFolder(false);
  if (nativeMode) nativeResync(true); // se o player nativo já estava tocando, acompanha
  if (nativeAutoDisabled) setTimeout(() => showToast("O player nativo foi desligado depois de falhas. Dá para religar nos Ajustes."), 1500);
});

/* ==========================================================
   Instalação como app (PWA) e uso offline
   ========================================================== */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
