"use strict";

/* ==========================================================
   Playlists e menus
   ========================================================== */
async function createPlaylist(firstSongId) {
  const name = await showDialog({
    title: "Nova playlist",
    input: { placeholder: "Nome da playlist" },
    confirmLabel: "Criar"
  });

  if (!name) return null;

  const playlist = {
    id: "p" + Date.now(),
    name: name,
    songIds: firstSongId !== undefined ? [firstSongId] : []
  };

  playlists.push(playlist);
  savePlaylists();
  renderLibrary();
  showToast("Playlist \"" + name + "\" criada");
  return playlist;
}

function toggleInPlaylist(playlist, song) {
  const i = playlist.songIds.indexOf(song.id);

  if (i >= 0) {
    playlist.songIds.splice(i, 1);
    showToast("Removida de \"" + playlist.name + "\"");
  } else {
    playlist.songIds.push(song.id);
    showToast("Adicionada a \"" + playlist.name + "\"");
  }

  savePlaylists();
  renderLibrary();
}

function addToPlaylistSheet(song) {
  const actions = playlists.map(p => ({
    icon: p.songIds.includes(song.id) ? "check_circle" : "playlist_add",
    label: p.name,
    run: () => toggleInPlaylist(p, song)
  }));

  actions.push({
    icon: "add",
    label: "Nova playlist",
    run: () => createPlaylist(song.id)
  });

  openSheet("Adicionar à playlist", actions);
}

function pickLrcFor(songId) {
  lrcTargetId = songId;
  lrcInput.click();
}

async function deleteSong(song) {
  const ok = await showDialog({
    title: "Excluir música?",
    text: "\"" + song.name + "\" será removida da sua biblioteca.",
    confirmLabel: "Excluir",
    danger: true
  });

  if (!ok) return;

  if (song.id === currentId) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    currentId = null;
    closeFullPlayer();
  }

  URL.revokeObjectURL(song.url);
  if (song.cover) URL.revokeObjectURL(song.cover);

  songs.splice(songs.indexOf(song), 1);
  playlists.forEach(p => {
    p.songIds = p.songIds.filter(id => id !== song.id);
  });
  savePlaylists();

  queue = queue.filter(id => id !== song.id);
  playHistory = playHistory.filter(id => id !== song.id);
  const deletedFromStorage = await dbDelete(song.id);

  nativeRefreshUpcoming();
  refreshAll();
  showToast(deletedFromStorage
    ? "Música excluída"
    : "Removida desta sessão, mas não foi possível apagá-la do armazenamento.");
}

function openSongMenu(song, opts = {}) {
  const actions = [
    {
      icon: "playlist_add",
      label: "Adicionar à playlist",
      run: () => addToPlaylistSheet(song)
    }
  ];

  if (opts.playlistId) {
    const p = playlists.find(x => x.id === opts.playlistId);
    if (p) {
      actions.push({
        icon: "playlist_remove",
        label: "Remover desta playlist",
        run: () => toggleInPlaylist(p, song)
      });
    }
  }

  actions.push({
    icon: song.favorite ? "favorite_border" : "favorite",
    label: song.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
    run: () => toggleFavorite(song)
  });

  actions.push({
    icon: "edit",
    label: song.coverBlob ? "Trocar capa pela galeria" : "Escolher capa da galeria",
    run: () => pickCoverFor(song.id)
  });

  actions.push({
    icon: "lyrics",
    label: song.lyrics ? "Trocar letra (.lrc)" : "Importar letra (.lrc)",
    run: () => pickLrcFor(song.id)
  });

  if (song.lyrics && !hasSyncedLyrics(song)) {
    actions.push({
      icon: "search",
      label: "Buscar letra sincronizada",
      run: () => requestOnlineLyrics(song, true)
    });
  }

  if (song.lyrics) {
    actions.push({
      icon: "speaker_notes_off",
      label: "Remover letra",
      run: () => {
        song.lyrics = "";
        dbPut(toRecord(song));
        if (song.id === currentId) renderLyrics(song);
        showToast("Letra removida");
      }
    });
  }

  actions.push({
    icon: "delete",
    label: "Excluir música",
    danger: true,
    run: () => deleteSong(song)
  });

  openSheet(song.name, actions);
}

/* ==========================================================
   Listas (Library e Search)
   ========================================================== */
function toggleFavorite(song) {
  song.favorite = !song.favorite;
  dbPut(toRecord(song));
  renderAll();
  if (song.id === currentId) updateFullPlayer();
  if (song.favorite) popHeart(song);
}

function setFavoriteControl(button, song) {
  button.setAttribute("aria-pressed", String(song.favorite));
  button.setAttribute(
    "aria-label",
    (song.favorite ? "Remover " : "Adicionar ") + song.name + " dos favoritos"
  );
}

// coração "estoura" ao favoritar
function popHeart(song) {
  const nodes = Array.from(
    document.querySelectorAll('.icon-btn.fav[data-fav="' + song.id + '"]')
  );
  if (song.id === currentId) nodes.push($("fpFav"));

  nodes.forEach(n => {
    n.classList.remove("pop");
    void n.offsetWidth;
    n.classList.add("pop");
    setTimeout(() => n.classList.remove("pop"), 650);
  });
}

function createSongItem(song, context, opts = {}) {
  const isCurrent = song.id === currentId;
  const item = el("div", "song-item" + (isCurrent ? " playing" : ""));

  const play = el("button", "song-main");
  play.type = "button";
  play.setAttribute("aria-label", "Tocar " + song.name + " — " + song.artist);

  const cover = el("div", "song-cover");
  setCover(cover, song.cover);

  if (isCurrent) {
    const eq = el("div", "eq" + (audio.paused ? " paused" : ""));
    eq.innerHTML = "<i></i><i></i><i></i>";
    cover.appendChild(eq);
  }

  const info = el("div", "song-info");
  info.append(el("strong", "", song.name), el("small", "", song.artist));
  play.append(cover, info);

  const fav = el("button", "icon-btn fav" + (song.favorite ? " active" : ""));
  setFavoriteControl(fav, song);
  fav.dataset.fav = String(song.id);
  setIcon(fav, song.favorite ? "favorite" : "favorite_border");
  fav.onclick = e => {
    e.stopPropagation();
    toggleFavorite(song);
  };

  const more = el("button", "icon-btn");
  more.setAttribute("aria-label", "Mais opções");
  setIcon(more, "more_vert");
  more.onclick = e => {
    e.stopPropagation();
    openSongMenu(song, opts);
  };

  play.onclick = () => {
    if (song.id === currentId) togglePlay();
    else playSong(song.id, context);
  };

  attachRipple(item);

  item.append(play, fav, more);
  return item;
}

function showEmpty(container, title, message, showButton) {
  container.innerHTML = "";

  const empty = el("div", "empty-state");
  empty.appendChild(el("span", "material-symbols-rounded", "library_music"));
  empty.appendChild(el("h3", "", title));
  empty.appendChild(el("p", "", message));

  if (showButton) {
    const button = el("button", "", "Adicionar músicas");
    button.onclick = openFilePicker;
    empty.appendChild(button);
  }

  container.appendChild(empty);
}

function renderSearch() {
  const container = $("searchSongList");
  container.innerHTML = "";

  const query = $("searchInput").value.trim().toLowerCase();

  const results = songs.filter(
    s =>
      s.name.toLowerCase().includes(query) ||
      s.artist.toLowerCase().includes(query)
  );

  if (results.length === 0) {
    $("searchStatus").textContent = query
      ? "Nenhum resultado para " + query + "."
      : "Nenhuma música na coleção.";
    showEmpty(
      container,
      songs.length === 0 ? "Nenhuma música adicionada" : "Nenhum resultado encontrado",
      songs.length === 0
        ? "Adicione músicas para pesquisar sua coleção."
        : "Experimente pesquisar por outro nome.",
      songs.length === 0
    );
    return;
  }

  $("searchStatus").textContent = query
    ? results.length + (results.length === 1 ? " resultado para " : " resultados para ") + query + "."
    : results.length + (results.length === 1 ? " música na coleção." : " músicas na coleção.");
  const ids = results.map(s => s.id);
  results.forEach(song => container.appendChild(createSongItem(song, ids)));
}

function librarySongs() {
  if (libraryFilter === "all") return songs.slice();
  if (libraryFilter === "fav") return songs.filter(s => s.favorite);

  const p = playlists.find(x => x.id === libraryFilter);
  if (!p) {
    libraryFilter = "all";
    return songs.slice();
  }

  return p.songIds.map(getSong).filter(Boolean);
}

function renderFilters() {
  const box = $("filters");
  box.innerHTML = "";

  const addChip = (label, value, extra) => {
    const active = libraryFilter === value;
    const chip = el("button", "filter" + (active ? " active" : "") + (extra ? " " + extra : ""));
    if (active) chip.appendChild(el("span", "material-symbols-rounded", "check"));
    chip.appendChild(document.createTextNode(label));
    chip.onclick = () => {
      libraryFilter = value;
      renderLibrary();
    };
    box.appendChild(chip);
  };

  addChip("Todas", "all");
  addChip("Favoritas", "fav");
  playlists.forEach(p => addChip(p.name, p.id));

  const add = el("button", "filter new");
  add.appendChild(el("span", "material-symbols-rounded", "add"));
  add.appendChild(document.createTextNode("Playlist"));
  add.onclick = async () => {
    const p = await createPlaylist();
    if (p) {
      libraryFilter = p.id;
      renderLibrary();
    }
  };
  box.appendChild(add);
}

function renderPlaylistBar(playlist, list) {
  const bar = $("playlistBar");

  if (!playlist) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  bar.innerHTML = "";

  const info = el("div", "pl-info");
  info.append(
    el("strong", "", playlist.name),
    el("span", "", list.length + (list.length === 1 ? " música" : " músicas"))
  );

  const play = el("button", "tonal-btn");
  play.appendChild(el("span", "material-symbols-rounded", "play_arrow"));
  play.appendChild(document.createTextNode("Tocar"));
  play.onclick = () => {
    if (list.length === 0) {
      showToast("A playlist está vazia");
      return;
    }
    const ids = list.map(s => s.id);
    const first = shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
    playSong(first, ids);
  };

  const rename = el("button", "icon-btn");
  rename.setAttribute("aria-label", "Renomear playlist");
  setIcon(rename, "edit");
  rename.onclick = async () => {
    const name = await showDialog({
      title: "Renomear playlist",
      input: { value: playlist.name, placeholder: "Nome da playlist" },
      confirmLabel: "Salvar"
    });
    if (name) {
      playlist.name = name;
      savePlaylists();
      renderLibrary();
    }
  };

  const del = el("button", "icon-btn");
  del.setAttribute("aria-label", "Excluir playlist");
  setIcon(del, "delete");
  del.onclick = async () => {
    const ok = await showDialog({
      title: "Excluir playlist?",
      text: "As músicas continuam na biblioteca.",
      confirmLabel: "Excluir",
      danger: true
    });
    if (ok) {
      playlists = playlists.filter(p => p !== playlist);
      savePlaylists();
      libraryFilter = "all";
      renderLibrary();
      showToast("Playlist excluída");
    }
  };

  bar.append(info, play, rename, del);
}

function groupKey(song, type) {
  const raw = type === "albums" ? song.album : song.artist;
  const v = (raw || "").trim();
  if (type === "albums") return v || "Sem álbum";
  return v && !/^(arquivo local|unknown)$/i.test(v) ? v : "Artista desconhecido";
}

function buildGroups(type) {
  const map = new Map();
  songs.forEach(s => {
    const k = groupKey(s, type);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  });
  return Array.from(map, ([key, list]) => ({ key, list })).sort((a, b) => a.key.localeCompare(b.key, "pt-BR"));
}

function renderLibTabs() {
  document.querySelectorAll("#libTabs .lib-tab").forEach(b => {
    const on = b.dataset.tab === libraryTab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
}

document.querySelectorAll("#libTabs .lib-tab").forEach(b => {
  b.addEventListener("click", () => {
    libraryTab = b.dataset.tab;
    libraryGroup = null;
    renderLibrary();
  });
});

$("libraryHeadAdd").onclick = () => openFilePicker();

function renderGroups(container, type) {
  const groups = buildGroups(type);
  if (!groups.length) {
    showEmpty(container, "Sua biblioteca está vazia", "As músicas que você adicionar aparecerão aqui.", false);
    return;
  }
  groups.forEach((g, i) => {
    const item = el("div", "song-item");
    const btn = el("button", "song-main");
    btn.type = "button";
    const cover = el("div", "song-cover");
    const withCover = g.list.find(s => s.cover);
    setCover(cover, withCover ? withCover.cover : null);
    const info = el("div", "song-info");
    info.append(el("strong", "", g.key), el("small", "", plural(g.list.length, "música", "músicas")));
    btn.append(cover, info);
    btn.onclick = () => {
      libraryGroup = { type, key: g.key };
      renderLibrary();
    };
    attachRipple(item);
    item.appendChild(btn);
    container.appendChild(item);
  });
}

function renderLibrary() {
  const container = $("songList");
  container.innerHTML = "";
  renderLibTabs();

  $("libraryCount").textContent =
    songs.length + (songs.length === 1 ? " música adicionada" : " músicas adicionadas");

  const page = $("libraryPage");
  page.dataset.tab = libraryTab;

  if (libraryTab !== "songs") {
    $("playlistBar").hidden = true;
    const box = $("filters");
    box.innerHTML = "";
    if (libraryGroup) {
      const back = el("button", "filter active");
      back.appendChild(el("span", "material-symbols-rounded", "arrow_back"));
      back.appendChild(document.createTextNode(libraryGroup.key));
      back.onclick = () => { libraryGroup = null; renderLibrary(); };
      box.appendChild(back);
      const list = songs.filter(s => groupKey(s, libraryGroup.type) === libraryGroup.key);
      if (!list.length) { libraryGroup = null; renderLibrary(); return; }
      const ids = list.map(s => s.id);
      list.forEach(song => container.appendChild(createSongItem(song, ids)));
    } else {
      renderGroups(container, libraryTab);
    }
    return;
  }

  const list = librarySongs();
  const playlist = playlists.find(p => p.id === libraryFilter) || null;

  renderFilters();
  renderPlaylistBar(playlist, list);

  if (list.length === 0) {
    if (playlist) {
      showEmpty(container, "Playlist vazia", "Use o menu ⋮ de uma música para adicioná-la aqui.", false);
    } else if (libraryFilter === "fav") {
      showEmpty(container, "Nenhuma favorita", "Marque músicas com o coração para encontrá-las aqui.", false);
    } else {
      showEmpty(container, "Sua biblioteca está vazia", "As músicas que você adicionar aparecerão aqui.", false);
    }
    return;
  }

  const ids = list.map(s => s.id);
  const opts = playlist ? { playlistId: playlist.id } : {};
  list.forEach(song => container.appendChild(createSongItem(song, ids, opts)));
}

function renderAll() {
  renderSearch();
  renderLibrary();
}

/* ==========================================================
   Your Mix
   ========================================================== */
const homeTargets = { artMain: null, artSmall1: null, artSmall2: null, artSmall3: null, artSmall4: null };
let homeTab = "foryou";
const FAV_IDS = ["artSmall1", "artSmall2", "artSmall3", "artSmall4"];

function renderHomeTab() {
  $("homePage").dataset.tab = homeTab;
  document.querySelectorAll("#homeChips .hchip").forEach(b => {
    const on = b.dataset.tab === homeTab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
}

document.querySelectorAll("#homeChips .hchip").forEach(b => {
  b.addEventListener("click", () => {
    homeTab = b.dataset.tab;
    renderHomeTab();
  });
});

function rankedForHome() {
  const arr = songs.slice();

  if (mixMode === "plays") {
    arr.sort(
      (a, b) =>
        b.playCount - a.playCount ||
        b.lastPlayed - a.lastPlayed ||
        a.id - b.id
    );
  } else {
    arr.sort((a, b) => b.lastPlayed - a.lastPlayed || a.id - b.id);
  }

  return arr;
}

function renderMixMode() {
  document.querySelectorAll("#mixMode button").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === mixMode);
  });
}

document.querySelectorAll("#mixMode button").forEach(b => {
  b.addEventListener("click", () => {
    mixMode = b.dataset.mode;
    lsSet("mixMode", mixMode);
    renderMixMode();
    updateHome();
  });
});

function renderGreeting() {
  const h = new Date().getHours();
  const base = h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const text = (base + (settings.name ? ", " + settings.name : "")).toUpperCase();
  const node = $("greeting");
  if (node.textContent === text) return;

  // primeira vez: só escreve. Depois: troca com uma transição suave
  if (!node.textContent || node.dataset.ready !== "1") {
    node.textContent = text;
    node.dataset.ready = "1";
    return;
  }

  node.classList.add("greet-out");
  setTimeout(() => {
    node.textContent = text;
    node.classList.remove("greet-out");
  }, 350);
}

// Confere o horário a cada 10 s e quando você volta para o app
setInterval(renderGreeting, 10000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderGreeting();
});
window.addEventListener("focus", renderGreeting);

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function hCard(song, ctx, sub, rank) {
  const card = el("button", "h-card");

  const cover = el("div", "h-cover");
  setCover(cover, song.cover);
  if (rank) cover.appendChild(el("span", "h-rank", String(rank)));

  card.append(cover, el("strong", "", song.name), el("small", "", sub));

  card.onclick = () => {
    if (song.id === currentId) togglePlay();
    else playSong(song.id, ctx);
  };

  return card;
}

function fillRow(section, list, arr, subFn, ranked) {
  section.hidden = arr.length === 0;
  list.innerHTML = "";
  const ids = arr.map(s => s.id);
  arr.forEach((s, i) => list.appendChild(hCard(s, ids, subFn(s), ranked ? i + 1 : 0)));
}

let homeSig = "";

function renderHomeExtras() {
  const stats = $("homeStats");
  stats.hidden = songs.length === 0;

  const sig = songs
    .map(s => [s.id, s.playCount, s.lastPlayed, s.cover ? 1 : 0, s.favorite ? 1 : 0, s.name, s.artist].join(":"))
    .join("|");
  if (sig === homeSig) return;
  homeSig = sig;

  const plays = songs.reduce((n, s) => n + s.playCount, 0);
  const favs = songs.filter(s => s.favorite).length;

  stats.innerHTML = "";
  [
    [songs.length, "música", "músicas"],
    [plays, "reprodução", "reproduções"],
    [favs, "favorita", "favoritas"]
  ].forEach(([n, one, many]) => {
    const card = el("div", "stat");
    card.append(el("strong", "", String(n)), el("span", "", n === 1 ? one : many));
    stats.appendChild(card);
  });

  const top = songs
    .filter(s => s.playCount > 0)
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayed - a.lastPlayed)
    .slice(0, 8);
  fillRow($("topSection"), $("topList"), top, s => plural(s.playCount, "vez", "vezes"), true);

  const recent = songs
    .filter(s => s.lastPlayed > 0)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, 8);
  fillRow($("recentSection"), $("recentList"), recent, s => s.artist, false);

  const favList = songs.filter(s => s.favorite);
  fillRow($("favSection"), $("favList"), favList, s => s.artist, false);
}

function updateHome() {
  const ranked = rankedForHome();
  const main = current() || ranked[0] || null;

  // favoritas primeiro; se faltar, completa com as mais ouvidas
  const favs = songs.filter(s => s.favorite);
  const pool = favs.concat(ranked.filter(s => !s.favorite && s !== main));
  const picks = FAV_IDS.map((_, i) => pool[i] || null);

  homeMain = main;
  homeTargets.artMain = main ? main.id : null;
  setCover($("artMain"), main ? main.cover : null);
  $("artMain").setAttribute("aria-label", main ? "Tocar " + main.name + " — " + main.artist : "Adicionar músicas");

  FAV_IDS.forEach((id, i) => {
    const song = picks[i];
    homeTargets[id] = song ? song.id : null;
    setCover($(id), song ? song.cover : null);
    $(id).setAttribute("aria-label", song ? "Tocar " + song.name + " — " + song.artist : "Adicionar músicas");
  });

  $("contTitle").textContent = main ? main.name : "Sua coleção musical";
  $("contArtist").textContent = main ? main.artist : "Adicione músicas para começar";
  $("heroSubtitle") && ($("heroSubtitle").textContent = main ? main.name : "");

  renderGreeting();
  renderHomeExtras();
  renderHomeTab();
  updateMiniPlayer();
}

["artMain"].concat(FAV_IDS).forEach(id => {
  $(id).addEventListener("click", () => {
    const songId = homeTargets[id];

    if (songId === null || !getSong(songId)) {
      openFilePicker();
      return;
    }

    if (songId === currentId) togglePlay();
    else playSong(songId, allIds());
  });
});


$("favHead").addEventListener("click", () => {
  libraryFilter = "fav";
  libraryTab = "songs";
  openPage("library");
});
