"use strict";

/* ==========================================================
   Onboarding da primeira abertura (tela cheia, passo a passo)
   Usa a busca automática do aparelho e MN.requestNotifications.
   Visual Material 3 Expressive (forma que se transforma, progresso ondulado).
   Cada passo com ação mostra o resultado (ex.: a pasta escolhida)
   e libera o botão "Continuar".
   ========================================================== */
const OB_KEY = "onboardingDone";

const OB_PATHS = {
  arrow: "M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  battery: "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4zM11 20v-5.5H9L13 7v5.5h2L11 20z",
  folderOff: "M20 6h-8l-2-2H6.83L20 17.17V8c0-1.1-.9-2-2-2zM2.81 2.81L1.39 4.22 2 4.83V18c0 1.1.9 2 2 2h13.17l2.61 2.61 1.41-1.41L2.81 2.81z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
};

function obIcon(name) {
  const d = OB_PATHS[name];
  if (d) return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  return iconSvg(name);
}

function obHasNative() {
  return !!(MN && typeof MN.requestAudioLibraryAccess === "function"
    && typeof MN.listMediaAudioFolders === "function");
}

const obSleep = ms => new Promise(r => setTimeout(r, ms));

function obPlural(n, um, varios) { return n + " " + (n === 1 ? um : varios); }

// ---------- pasta de músicas (Android) ----------
// A pasta escolhida só é registrada em "Lista de Diretórios" e importada DEPOIS do passo
// de pastas ignoradas, para o que o usuário marcar como ignorado nem chegar a entrar.
let obChosen = [];          // [{uri, name}] pastas escolhidas neste tutorial
const obScan = new Map();   // uri -> { name, files, folders }
const obIgnoreSel = new Set();
const obIgnoreSeen = new Set();
let obStatus = null;        // { baseline, expected, done, timer }
let obCommitted = false;
let obMediaFolders = [];
let obMediaScanComplete = false;
const obMediaIgnoreSel = new Set();
const obMediaIgnoreSeen = new Set();
let obMode = "onboarding";

const obIsLrc = f => /\.lrc$/i.test((f && f.name) || "");
const obRel = f => String((f && f.relativePath) || "").replace(/\\/g, "/");

function obScanTotal() {
  let n = 0;
  obScan.forEach(sc => { n += sc.files.filter(f => !obIsLrc(f)).length; });
  return n;
}

// Subpastas que têm músicas (mesma ideia da lista de pastas do PixelPlayer).
function obIgnoreRows() {
  const rows = [];
  obScan.forEach((sc, rootUri) => {
    (sc.folders || []).forEach(folder => {
      const prefix = folder.relativePath + "/";
      const total = sc.files.filter(f => !obIsLrc(f) && obRel(f).startsWith(prefix)).length;
      if (total) rows.push({ uri: folder.uri, rootUri, name: folder.name, path: sc.name + "/" + folder.relativePath, rel: folder.relativePath, total });
    });
  });
  rows.sort((a, b) => a.path.localeCompare(b.path, "pt-BR", { numeric: true }));
  // o que já estava ignorado começa marcado
  const persisted = new Set(getIgnoredFolders().map(f => f.uri));
  rows.forEach(r => {
    if (obIgnoreSeen.has(r.uri)) return;
    obIgnoreSeen.add(r.uri);
    if (persisted.has(r.uri)) obIgnoreSel.add(r.uri);
  });
  return rows;
}

function obIgnoreVisible() { return obHasNative() && obAllIgnoreRows(); }

function obMediaFolderIdentity(folder) {
  const location = mediaAudioCanonicalLocation(folder && folder.volumeName, folder && folder.relativePath);
  return location.volume + "::" + location.path;
}

function obMediaFolderFromSafIgnore(folder) {
  const canonical = mediaAudioCanonicalFromSaf(folder && folder.uri, "");
  const prefix = "android-audio-path::";
  if (!canonical.startsWith(prefix)) return null;
  const rest = canonical.slice(prefix.length);
  const split = rest.indexOf("::");
  if (split <= 0) return null;
  return {
    volumeName: rest.slice(0, split),
    relativePath: rest.slice(split + 2),
    name: String(folder.name || "Pasta")
  };
}

function obMediaIgnoreRows() {
  const savedFolders = getMediaAudioImportExclusions();
  const saved = new Set(savedFolders.map(obMediaFolderIdentity));
  const folders = obMediaFolders.map(folder => ({
    ...folder,
    volumeName: String(folder.volumeName || ""),
    relativePath: normalizeMediaAudioPath(folder.relativePath),
    key: obMediaFolderIdentity(folder)
  }));
  const scanned = new Set(folders.map(obMediaFolderIdentity));
  savedFolders.forEach(folder => {
    const key = obMediaFolderIdentity(folder);
    if (scanned.has(key)) return;
    folders.push({ ...folder, key, count: 0, stale: true });
  });
  folders.forEach(folder => {
    if (obMediaIgnoreSeen.has(folder.key)) return;
    obMediaIgnoreSeen.add(folder.key);
    if (saved.has(folder.key)) obMediaIgnoreSel.add(folder.key);
  });
  return folders.map(folder => {
    const path = folder.relativePath;
    const total = folders.reduce((sum, child) => {
      const childPath = child.relativePath;
      const inside = child.volumeName === folder.volumeName
        && (!path || path === "/" || childPath === path || childPath.startsWith(path + "/"));
      return sum + (inside ? Number(child.count) || 0 : 0);
    }, 0);
    const parentExcluded = folders.some(parent => parent.key !== folder.key
      && obMediaIgnoreSel.has(parent.key)
      && parent.volumeName === folder.volumeName
      && (!parent.relativePath || parent.relativePath === "/" || path.startsWith(parent.relativePath + "/")));
    const primaryAbsolute = path.match(/^\/storage\/(?:emulated\/0|self\/primary)\/?(.*)$/i);
    const externalAbsolute = path.match(/^\/storage\/([^/]+)\/?(.*)$/i);
    const isInternal = /primary/i.test(folder.volumeName)
      || (folder.volumeName === "external" && (!path || path === "/" || !!primaryAbsolute));
    const depth = path && path !== "/" ? path.split("/").filter(Boolean).length - 1 : 0;
    let displayPath;
    if (!path || path === "/") displayPath = isInternal ? "Raiz do armazenamento interno" : "Raiz do armazenamento externo";
    else if (primaryAbsolute) displayPath = "Interno · " + (primaryAbsolute[1] || "Raiz");
    else if (externalAbsolute) displayPath = "Externo · " + (externalAbsolute[2] || "Raiz");
    else displayPath = isInternal ? path : "Externo · " + path;
    return { ...folder, total, depth, displayPath, parentExcluded };
  }).sort((a, b) => a.volumeName.localeCompare(b.volumeName, "pt-BR")
    || a.relativePath.localeCompare(b.relativePath, "pt-BR", { numeric: true }));
}

function obAllIgnoreRows() {
  return obIgnoreRows().length > 0 || obMediaFolders.length > 0;
}

async function obRequestMediaAudioAccess() {
  if (!MN || typeof MN.requestAudioLibraryAccess !== "function"
      || typeof MN.listMediaAudioFolders !== "function") {
    return { label: "Busca do aparelho indisponível", sub: "Use o aplicativo Android para buscar automaticamente suas músicas.", warn: true };
  }
  try {
    const access = await MN.requestAudioLibraryAccess();
    if (!access || !access.granted) {
      return { label: "Permissão não concedida", sub: "Você pode tentar de novo depois nas configurações do Android.", warn: true };
    }
    const result = await MN.listMediaAudioFolders();
    obMediaFolders = Array.isArray(result && result.folders) ? result.folders : [];
    obMediaScanComplete = true;
    obMediaIgnoreSel.clear();
    obMediaIgnoreSeen.clear();
    obMediaIgnoreRows();
    obCommitted = false;
    const count = obMediaFolders.reduce((sum, folder) => sum + (Number(folder.count) || 0), 0);
    if (!count) {
      return { label: "Nenhum áudio encontrado", sub: "Você pode tentar novamente depois nas configurações do Android.", warn: true };
    }
    return { label: "Áudios encontrados", sub: obPlural(obMediaFolders.length, "pasta", "pastas")
      + " · " + obPlural(count, "áudio", "áudios") };
  } catch (error) {
    logErr("onboarding:media-scan", error);
    return { label: "Não foi possível ler os áudios", sub: "Confira a permissão do Android e tente novamente.", warn: true };
  }
}

async function obPickFolder() {
  const selected = await MN.pickFolder();
  if (!selected || selected.cancelled) return null;
  const name = selected.name || "pasta";
  const ignoredUris = getIgnoredFolders().map(f => f.uri);
  const listing = await MN.listFolderAudio({ uri: selected.uri, ignoredUris });
  const files = listing.files || [];
  const folders = Array.isArray(listing.folders) ? listing.folders : [];
  if (!files.some(f => !obIsLrc(f))) {
    return { label: name, sub: "Nenhuma música encontrada nessa pasta", warn: true, retry: true };
  }
  obScan.set(selected.uri, { name, files, folders });
  if (!obChosen.some(f => f.uri === selected.uri)) obChosen.push({ uri: selected.uri, name });
  obCommitted = false;
  const total = obScanTotal();
  const names = obChosen.map(f => f.name);
  return {
    label: names.length > 2 ? names.slice(0, 2).join(", ") + " e mais " + (names.length - 2) : names.join(", "),
    sub: obPlural(total, "música encontrada", "músicas encontradas")
  };
}

// Registra as pastas em "Lista de Diretórios", grava as ignoradas e importa as músicas.
function obCommit() {
  if (obCommitted) return;
  if (obMode !== "media-manager" && !obChosen.length && !obMediaFolders.length && !obMediaScanComplete) return;
  obCommitted = true;
  const rows = obChosen.length ? obIgnoreRows() : [];
  const rowUris = new Set(rows.map(r => r.uri));
  const picked = rows.filter(r => obIgnoreSel.has(r.uri));

  if (obChosen.length) {
    const ignored = getIgnoredFolders().filter(f => !rowUris.has(f.uri));
    picked.forEach(r => ignored.push({ uri: r.uri, name: r.name }));
    setDirectories("ignored", ignored);

    const watched = getWatchedFolders();
    obChosen.forEach(f => { if (!watched.some(w => w.uri === f.uri)) watched.push({ uri: f.uri, name: f.name }); });
    setDirectories("watched", watched);
  }

  if (obMediaScanComplete) {
    setMediaAudioFoldersCache(obMediaFolders);
    const currentRows = obMediaIgnoreRows();
    const currentKeys = new Set(currentRows.map(obMediaFolderIdentity));
    const retained = getMediaAudioExcludedFolders().filter(folder => !currentKeys.has(obMediaFolderIdentity(folder)));
    const selected = currentRows.filter(folder => obMediaIgnoreSel.has(obMediaFolderIdentity(folder)))
      .map(folder => ({ volumeName: folder.volumeName, relativePath: folder.relativePath, name: folder.name }));
    setMediaAudioExcludedFolders(retained.concat(selected));
    if (obMode === "media-manager") {
      const legacyIgnored = getIgnoredFolders();
      const remaining = legacyIgnored.filter(folder => {
        const mediaFolder = obMediaFolderFromSafIgnore(folder);
        return !mediaFolder || !currentKeys.has(obMediaFolderIdentity(mediaFolder));
      });
      if (remaining.length !== legacyIgnored.length) setDirectories("ignored", remaining);
    }
    if (obMediaScanComplete) lsSet("mediaAudioEnabled", true);
  }

  if (obMode === "media-manager") {
    if (obMediaScanComplete) syncMediaAudioLibrary(true);
    return;
  }

  // Importa apenas depois de aplicar as exclusões, somando o fluxo novo e o SAF manual.
  const excludedMedia = getMediaAudioImportExclusions();
  const mediaToImport = obMediaFolders.filter(folder => !mediaAudioFolderIsExcluded(folder, excludedMedia));
  const skipPrefixes = picked.map(r => r.path);
  const skipPathsByUri = new Map();
  picked.forEach(r => {
    if (!skipPathsByUri.has(r.rootUri)) skipPathsByUri.set(r.rootUri, []);
    skipPathsByUri.get(r.rootUri).push(r.rel);
  });
  let expected = mediaToImport.reduce((sum, folder) => sum + (Number(folder.count) || 0), 0);
  obScan.forEach(sc => {
    expected += sc.files.filter(f => {
      if (obIsLrc(f)) return false;
      const full = sc.name + "/" + obRel(f);
      return !skipPrefixes.some(pre => full.startsWith(pre + "/"));
    }).length;
  });

  if (obStatus && obStatus.timer) clearInterval(obStatus.timer);
  obStatus = { baseline: songs.length, expected, done: false, timer: null };
  const st = obStatus;
  st.timer = setInterval(obUpdateStatus, 400);
  obUpdateStatus();
  const tasks = [];
  if (obChosen.length) tasks.push(syncWatchedFolder(true, { cachedListings: obScan, skipPathsByUri }));
  if (mediaToImport.length) tasks.push(importMediaAudioFolders(mediaToImport, {
    excludedFolders: excludedMedia,
    onProgress: () => obUpdateStatus()
  }).catch(e => {
    logErr("onboarding:media-import", e);
    showToast("Alguns áudios não puderam ser importados. Você pode tentar novamente em Ajustes.");
  }));
  Promise.allSettled(tasks).finally(() => {
    st.done = true;
    obUpdateStatus();
    setTimeout(() => { if (obStatus === st) { clearInterval(st.timer); obStatus = null; obUpdateStatus(); } }, 3500);
  });
}

function obUpdateStatus() {
  const box = obRoot && obRoot.querySelector(".ob-status");
  if (!box) { if (!obRoot && obStatus && obStatus.timer && obStatus.done) clearInterval(obStatus.timer); return; }
  if (!obStatus) { box.classList.remove("show"); return; }
  const added = Math.max(0, songs.length - obStatus.baseline);
  box.classList.add("show");
  box.classList.toggle("done", obStatus.done);
  box.querySelector("span").textContent = obStatus.done
    ? obPlural(added, "música na biblioteca", "músicas na biblioteca")
    : "Importando músicas… " + added + (obStatus.expected ? " de " + obStatus.expected : "");
}

// ---------- forma que se transforma entre os passos ----------
const OB_N = 96;
let obShapeR = null;        // raios atuais (para animar de um passo ao outro)
let obShapeAnim = 0;

function obRadii(lobes, amp) {
  const r = [];
  for (let i = 0; i < OB_N; i++) r.push((1 + amp * Math.cos(lobes * (i / OB_N) * Math.PI * 2)) / (1 + amp));
  return r;
}

function obShapePath(r) {
  const n = r.length;
  const pts = r.map((v, i) => {
    const a = (i / n) * Math.PI * 2;
    return [50 + 46 * v * Math.cos(a), 50 + 46 * v * Math.sin(a)];
  });
  const f = x => x.toFixed(2);
  let d = "M" + f(pts[0][0]) + " " + f(pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += "C" + f(p1[0] + (p2[0] - p0[0]) / 6) + " " + f(p1[1] + (p2[1] - p0[1]) / 6) + " " +
      f(p2[0] - (p3[0] - p1[0]) / 6) + " " + f(p2[1] - (p3[1] - p1[1]) / 6) + " " + f(p2[0]) + " " + f(p2[1]);
  }
  return d + "Z";
}

const obBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

function obMorphTo(path, target) {
  cancelAnimationFrame(obShapeAnim);
  const from = obShapeR || target;
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || from === target) { obShapeR = target; path.setAttribute("d", obShapePath(target)); return; }
  path.setAttribute("d", obShapePath(from));
  const t0 = performance.now(), dur = 800;
  const tick = now => {
    if (!obRoot || !path.isConnected) return;
    const k = Math.min(1, (now - t0) / dur), e = obBack(k);
    obShapeR = from.map((v, i) => v + (target[i] - v) * e);
    path.setAttribute("d", obShapePath(obShapeR));
    if (k < 1) obShapeAnim = requestAnimationFrame(tick); else obShapeR = target;
  };
  obShapeAnim = requestAnimationFrame(tick);
}

const OB_WAVE = '<svg viewBox="0 0 96 10" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M0 5Q6 0 12 5T24 5T36 5T48 5T60 5T72 5T84 5T96 5"/></svg>';

// Conteúdo de apoio de cada passo (aparece enquanto ainda não há resultado).
function obExtra(step) {
  const box = el("div", "ob-extra");
  if (step.key === "welcome") {
    const chips = el("div", "ob-chips");
    [["lyrics", "Letras sincronizadas"], ["playlist_add", "Playlists"], ["folder", "Pastas monitoradas"]].forEach(([ic, t]) => {
      const c = el("span");
      c.innerHTML = obIcon(ic) + "<span>" + t + "</span>";
      chips.appendChild(c);
    });
    box.appendChild(chips);
  } else if (step.key === "musicas") {
    const tip = el("div", "ob-tip");
    tip.innerHTML = obIcon("info") + "<span>Com a permissão, o Nyx procura automaticamente os áudios no aparelho.</span>";
    box.appendChild(tip);
  } else if (step.key === "avisos") {
    const lock = el("div", "ob-lock");
    lock.innerHTML = '<span class="ob-lock-cv">' + obIcon("music_note") + '</span>' +
      '<div class="ob-lock-tt"><b>Sua música</b><small>Artista · Nyx</small><div class="ob-lock-pg"><i></i></div></div>' +
      '<span class="ob-lock-pl">' + obIcon("pause") + '</span>';
    box.appendChild(lock);
  } else if (step.key === "bateria") {
    ["Toque em desativar otimização", "Confirme na janela do Android"].forEach(t => {
      const tip = el("div", "ob-tip");
      tip.innerHTML = obIcon("info") + "<span>" + t + "</span>";
      box.appendChild(tip);
    });
  } else return null;
  return box;
}

// Passos: cada um diz o que mostra e o que o botão principal faz.
function obSteps() {
  const native = obHasNative();
  if (obMode === "media-manager") {
    return [{
      key: "mediaManager", title: "Pastas de áudio do aparelho", list: true,
      text: "Marque apenas as pastas que não devem entrar na biblioteca. As demais são incluídas automaticamente. Para ignorar só uma subpasta, marque-a sem marcar a pasta principal. Marcar uma pasta também ignora suas subpastas; músicas já importadas permanecem.",
      primary: "Buscar pastas",
      busy: "Lendo os áudios…",
      run: obRequestMediaAudioAccess,
      again: "Atualizar lista",
      againRun: obRequestMediaAudioAccess
    }];
  }
  const steps = [];
  steps.push({
    key: "welcome", title: "Bem-vindo ao Nyx", app: true, shape: [8, 0.07],
    text: "Vamos deixar tudo pronto para você. Leva menos de um minuto.",
    primary: "Vamos lá"
  });
  steps.push({
      key: "musicas", title: "Suas músicas", icon: "library_music", shape: [6, 0.1],
      text: native
        ? "Permita que o Nyx encontre áudios automaticamente em todas as pastas do aparelho. Depois você escolhe o que quer ignorar."
        : "A busca automática da biblioteca está disponível no aplicativo Android.",
      primary: native ? "Permitir acesso aos áudios" : "Continuar",
      busy: "Procurando áudios…",
      again: native ? "Buscar novamente" : "Continuar",
      againRun: native ? obRequestMediaAudioAccess : null,
      run: native ? obRequestMediaAudioAccess : null,
      orbit: ["folder", "music_note", "playlist_add"]
  });
  if (native) {
    steps.push(
      {
        key: "ignoradas", title: "Pastas ignoradas", list: true,
        text: "Confira as pastas com áudio. Marque só as que não quer na biblioteca; as demais entram automaticamente. Para ignorar apenas uma subpasta, marque-a sem marcar a pasta principal. Marcar uma pasta também ignora suas subpastas.",
        primary: "Continuar",
        skipIf: () => !obIgnoreVisible()
      },
      {
        key: "avisos", title: "Notificações", icon: "notifications", shape: [10, 0.06],
        text: "Ative as notificações para controlar a música pela tela de bloqueio e pela barra de notificações.",
        primary: "Ativar notificações",
        busy: "Aguardando…",
        run: async () => {
          const r = await MN.requestNotifications();
          if (r && r.granted === false) {
            return { label: "Permissão não concedida", sub: "Sem ela, os controles somem da tela de bloqueio. Dá para ativar depois nas configurações do Android.", warn: true };
          }
          return { label: "Notificações ativadas", sub: "Os controles aparecem na tela de bloqueio." };
        },
        orbit: ["skip_next", "pause", "skip_previous"]
      },
    );
    if (typeof MN.requestBatteryExemption === "function") {
      steps.push({
        key: "bateria", title: "Bateria", icon: "battery", shape: [4, 0.12],
        text: "Alguns Androids encerram apps em segundo plano. Desative a otimização de bateria para a música não parar do nada.",
        primary: "Desativar otimização",
        busy: "Aguardando…",
        run: async () => {
          const r = await MN.requestBatteryExemption();
          return r && r.granted
            ? { label: "Otimização já estava desativada", sub: "A música continua tocando em segundo plano." }
            : { label: "Pedido enviado", sub: "Confirme na janela do Android para valer." };
        },
        orbit: ["play_arrow", "check_circle", "repeat"],
        skippable: true
      });
    }
  }
  return steps;
}

let obRoot = null;
let obIndex = 0;
let obAll = [];
let obList = [];
let obDir = 1;
let obBusy = false;
let obActionBusy = false;   // uma ação (pasta, arquivos, permissão) em andamento
let obResults = {};

// Passos visíveis agora (o de pastas ignoradas só aparece se houver subpastas com música).
function obRefreshList() {
  obList = obAll.filter(st => !(st.skipIf && st.skipIf()));
}

function obFinish() {
  obCommit(); // "Pular tudo" também registra a pasta escolhida
  if (obMode === "media-manager" && typeof refreshSettingsPage === "function") refreshSettingsPage();
  if (obMode !== "media-manager") {
    lsSet(OB_KEY, true);
    lsSet("permsAsked", true); // a folha antiga de importação não precisa aparecer depois
  }
  document.documentElement.classList.remove("ob-pending");
  if (!obRoot) return;
  const root = obRoot;
  obRoot = null;
  root.classList.remove("show");
  setTimeout(() => root.remove(), 260);
}

// Troca de passo com saída suave e entrada na direção certa.
function obGo(delta) {
  if (obBusy || !obRoot) return;
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  obDir = delta > 0 ? 1 : -1;
  if (reduced) { obIndex += delta; obRender(); return; }
  obBusy = true;
  obRoot.querySelector(".ob-stage").classList.add(obDir > 0 ? "ob-out-l" : "ob-out-r");
  obRoot.querySelector(".ob-foot").classList.add("ob-foot-out");
  setTimeout(() => {
    obBusy = false;
    if (!obRoot) return;
    obIndex += delta;
    obRender();
  }, 240);
}

function obResultCard(res) {
  const card = el("div", "ob-result" + (res.warn ? " warn" : ""));
  const ic = el("span", "ob-result-ic");
  ic.innerHTML = obIcon(res.warn ? "info" : "check_circle");
  const txt = el("div", "ob-result-tx");
  txt.append(el("strong", "", res.label), el("span", "", res.sub || ""));
  card.append(ic, txt);
  return card;
}

// Lista de pastas com caixas de marcação (passo "Pastas ignoradas").
function obFolderList() {
  const wrap = el("div", "ob-folders");
  const safRows = obMode === "media-manager" ? [] : obIgnoreRows();
  const mediaRows = obMediaIgnoreRows();
  const hint = el("p", "ob-hint");
  const mediaNodes = new Map();
  const refresh = () => {
    const n = obIgnoreSel.size + obMediaIgnoreSel.size;
    hint.textContent = n
      ? obPlural(n, "pasta marcada", "pastas marcadas") + ". O conteúdo delas não será importado."
      : "Nenhuma pasta marcada. Todos os áudios encontrados serão incluídos.";
    const states = new Map(obMediaIgnoreRows().map(folder => [folder.key, folder]));
    mediaRows.forEach(folder => {
      const ref = mediaNodes.get(folder.key);
      if (!ref) return;
      const state = states.get(folder.key);
      const checked = obMediaIgnoreSel.has(folder.key) || !!(state && state.parentExcluded);
      ref.row.classList.toggle("on", checked);
      ref.row.disabled = !!(state && state.parentExcluded);
      ref.row.setAttribute("aria-checked", checked ? "true" : "false");
    });
  };
  if (mediaRows.length) wrap.appendChild(el("div", "ob-list-heading", "Pastas com áudio do aparelho"));
  mediaRows.forEach(folder => {
    const checked = obMediaIgnoreSel.has(folder.key) || folder.parentExcluded;
    const row = el("button", "ob-frow ob-media-row" + (checked ? " on" : ""));
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-checked", checked ? "true" : "false");
    row.disabled = folder.parentExcluded;
    row.style.paddingInlineStart = (14 + Math.min(folder.depth, 5) * 14) + "px";
    const ic = el("span", "ob-fic");
    ic.innerHTML = obIcon("folder");
    const tx = el("span", "ob-ftx");
    tx.append(el("strong", "", folder.name || folder.displayPath.split("/").pop()));
    tx.append(el("small", "", folder.displayPath));
    const chip = el("span", "ob-fcount", obPlural(folder.total, "áudio", "áudios"));
    const box = el("span", "ob-fbox");
    box.innerHTML = obIcon("check");
    row.append(ic, tx, chip, box);
    row.onclick = () => {
      if (folder.parentExcluded) return;
      if (obMediaIgnoreSel.has(folder.key)) obMediaIgnoreSel.delete(folder.key);
      else obMediaIgnoreSel.add(folder.key);
      obCommitted = false;
      refresh();
    };
    mediaNodes.set(folder.key, { row });
    wrap.appendChild(row);
  });
  if (safRows.length) wrap.appendChild(el("div", "ob-list-heading", "Subpastas da pasta escolhida manualmente"));
  safRows.forEach(r => {
    const row = el("button", "ob-frow" + (obIgnoreSel.has(r.uri) ? " on" : ""));
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-checked", obIgnoreSel.has(r.uri) ? "true" : "false");
    const ic = el("span", "ob-fic");
    ic.innerHTML = obIcon("folder");
    const tx = el("span", "ob-ftx");
    tx.append(el("strong", "", r.name));
    if (r.rel.indexOf("/") >= 0) tx.append(el("small", "", r.rel)); // só mostra o caminho de subpastas
    const chip = el("span", "ob-fcount", obPlural(r.total, "música", "músicas"));
    const box = el("span", "ob-fbox");
    box.innerHTML = obIcon("check");
    row.append(ic, tx, chip, box);
    row.onclick = () => {
      const on = !obIgnoreSel.has(r.uri);
      if (on) obIgnoreSel.add(r.uri); else obIgnoreSel.delete(r.uri);
      obCommitted = false;
      row.classList.toggle("on", on);
      row.setAttribute("aria-checked", on ? "true" : "false");
      refresh();
    };
    wrap.appendChild(row);
  });
  refresh();
  return { wrap, hint };
}

function obRender() {
  obRefreshList();
  if (obIndex > obList.length - 1) obIndex = obList.length - 1;
  const step = obList[obIndex];
  const last = obIndex === obList.length - 1;
  const res = obResults[step.key];
  const done = !!(res && !res.retry);
  const stage = obRoot.querySelector(".ob-stage");
  stage.innerHTML = "";
  stage.classList.remove("ob-in", "ob-out-l", "ob-out-r", "ob-from-l", "ob-from-r");
  stage.classList.add(obDir > 0 ? "ob-from-r" : "ob-from-l");
  obRoot.querySelector(".ob-foot").classList.remove("ob-foot-out");

  // progresso
  const dots = obRoot.querySelector(".ob-dots");
  dots.innerHTML = "";
  obList.forEach((_, i) => {
    const d = el("span", i === obIndex ? "on" : i < obIndex ? "done" : "");
    d.innerHTML = OB_WAVE;
    dots.appendChild(d);
  });
  obRoot.querySelector(".ob-count").textContent = (obIndex + 1) + " de " + obList.length;

  // ilustração: forma que se transforma + ícone + satélites
  const art = el("div", "ob-art" + (res ? " small" : ""));
  art.setAttribute("aria-hidden", "true");
  const bd = el("i", "ob-bd");
  const shape = el("div", "ob-shape");
  shape.innerHTML = '<svg viewBox="0 0 100 100"><path d=""/></svg>';
  const main = el("div", "ob-main");
  if (step.app) {
    const img = document.createElement("img");
    img.src = "icon-192.png";
    img.alt = "";
    img.draggable = false;
    main.appendChild(img);
    main.classList.add("ob-app");
  } else {
    main.innerHTML = obIcon(step.icon);
  }
  art.append(bd, shape, main);
  (step.orbit || (step.app ? ["music_note", "play_arrow", "playlist_add"] : [])).forEach((name, i) => {
    const c = el("span", "ob-chip ob-chip-" + (i + 1));
    c.innerHTML = obIcon(name);
    art.appendChild(c);
  });
  if (!step.list) stage.appendChild(art);

  // título, texto e resultado
  const h = el("h1", "ob-title");
  h.textContent = step.title;
  const p = el("p", "ob-text", step.text);
  stage.append(h, p);
  if (res) stage.appendChild(obResultCard(res));
  else { const ex = obExtra(step); if (ex) stage.appendChild(ex); }

  // lista de pastas no lugar da ilustração
  if (step.list) {
    const { wrap, hint } = obFolderList();
    stage.append(wrap, hint);
  }
  if (!step.list) {
    const sh = step.shape || [7, 0.08];
    obMorphTo(shape.querySelector("path"), obRadii(sh[0], sh[1]));
  }
  void stage.offsetWidth;
  stage.classList.add("ob-in");

  // botões
  const foot = obRoot.querySelector(".ob-foot");
  foot.innerHTML = "";
  const advance = () => {
    // a pasta só é registrada e importada depois de decidir o que ignorar
    if (step.key === "ignoradas" || (step.key === "musicas" && !obIgnoreVisible())) obCommit();
    if (last) obFinish(); else obGo(1);
  };

  // executa uma ação, mostra "ocupado" e guarda o resultado
  const exec = async (fn, button, busyText) => {
    if (obBusy || obActionBusy) return;
    obActionBusy = true;
    const lbl = button.querySelector(".ob-lbl");
    const idle = lbl.textContent;
    button.classList.add("busy");
    lbl.textContent = busyText || "Aguardando…";
    let r = null;
    try { r = await fn(); } catch (e) { logErr("onboarding:" + step.key, e); }
    obActionBusy = false;
    if (!obRoot) return;
    button.classList.remove("busy");
    lbl.textContent = idle;
    if (r) { obResults[step.key] = r; obRender(); }
  };

  const links = el("div", "ob-links");
  if (step.run && done && step.again) {
    const again = el("button", "ob-link");
    const againLabel = typeof step.again === "function" ? step.again() : step.again;
    again.innerHTML = obIcon("add") + "<span>" + againLabel + "</span>";
    again.onclick = () => exec(step.againRun || step.run, main2, step.busy);
    links.appendChild(again);
  }
  if (step.skippable && !done) {
    const skip = el("button", "ob-link", "Pular");
    skip.onclick = advance;
    links.appendChild(skip);
  }
  if (links.childNodes.length) foot.appendChild(links);

  const row = el("div", "ob-row");
  if (obIndex > 0) {
    const back = el("button", "ob-back");
    back.innerHTML = obIcon("back");
    back.setAttribute("aria-label", "Voltar");
    back.onclick = () => obGo(-1);
    row.appendChild(back);
  }
  const main2 = el("button", "ob-primary");
  main2.appendChild(el("span", "ob-lbl", done ? (last ? "Concluir" : "Continuar") : step.primary));
  main2.insertAdjacentHTML("beforeend", '<i class="ob-spin" aria-hidden="true"></i>' + obIcon("arrow"));
  main2.onclick = () => {
    if (!step.run || done) advance();
    else exec(step.run, main2, step.busy);
  };
  if (step.secondary && (!done || step.secondaryAlways)) {
    // dois botões conectados: pasta | arquivos soltos
    const group = el("div", "ob-group");
    const sec = el("button", "ob-sec");
    sec.innerHTML = '<i class="ob-spin" aria-hidden="true"></i><span class="ob-lbl">' + step.secondary + "</span>";
    sec.onclick = () => exec(step.runSecondary, sec, "Importando…");
    group.append(main2, sec);
    row.appendChild(group);
  } else row.appendChild(main2);
  foot.appendChild(row);
}

function startOnboarding(instant, mode = "onboarding") {
  if (obRoot) return;
  obMode = mode;
  obAll = obSteps();
  obIndex = 0;
  obDir = 1;
  obBusy = false;
  obActionBusy = false;
  obResults = {};
  obCommitted = false;
  obShapeR = null;
  obChosen = [];
  obScan.clear();
  obIgnoreSel.clear();
  obIgnoreSeen.clear();
  obMediaFolders = [];
  obMediaIgnoreSel.clear();
  obMediaIgnoreSeen.clear();
  obRefreshList();

  const root = el("div", "ob");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", obMode === "media-manager" ? "Gerenciar pastas de áudio" : "Configuração inicial do Nyx");

  const top = el("div", "ob-top");
  const dots = el("div", "ob-dots");
  const count = el("span", "ob-count");
  const skipAll = el("button", "ob-skipall", obMode === "media-manager" ? "Fechar" : "Pular tudo");
  skipAll.onclick = obFinish;
  top.append(dots, count, skipAll);

  const status = el("div", "ob-status");
  status.innerHTML = '<i class="ob-spin" aria-hidden="true"></i><span></span>';
  root.append(top, el("div", "ob-stage"), status, el("div", "ob-foot"));
  if (instant) root.classList.add("show", "ob-now");
  document.body.appendChild(root);
  obRoot = root;
  obRender();
  if (!instant) requestAnimationFrame(() => root.classList.add("show"));
}

function openMediaAudioManager() {
  if (!obHasNative()) {
    showToast("O gerenciamento da biblioteca do aparelho só funciona no Android.");
    return;
  }
  startOnboarding(true, "media-manager");
}

// Chamado ao terminar de carregar as músicas.
function maybeStartOnboarding() {
  if (obRoot) return true; // já está na tela (primeira abertura)
  if (lsGet(OB_KEY, false)) return false;
  // quem já usava o app antes do tutorial existir (atualização) nunca vê o tutorial
  if (lsGet("permsAsked", false)) { lsSet(OB_KEY, true); return false; }
  // quem já tem músicas também não precisa
  if (songs.length) { lsSet(OB_KEY, true); return false; }
  setTimeout(startOnboarding, 300);
  return true;
}

// Primeira instalação: o onboarding é a PRIMEIRA coisa que aparece (o app fica escondido por trás).
if (document.documentElement.classList.contains("ob-pending")) startOnboarding(true);
