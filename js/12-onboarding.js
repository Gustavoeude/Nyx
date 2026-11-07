"use strict";

/* ==========================================================
   Onboarding da primeira abertura (tela cheia, passo a passo)
   Reaproveita importFolder, openFilePicker, addDirectory e
   MN.requestNotifications. Visual Material 3 Expressive (forma que se transforma, progresso ondulado).
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
  return !!(MN && typeof MN.pickFolder === "function");
}

const obSleep = ms => new Promise(r => setTimeout(r, ms));

// Espera as músicas escolhidas pelo seletor de arquivos terminarem de entrar na biblioteca.
async function obWatchSongs(before) {
  let last = songs.length;
  let stable = 0;
  for (let i = 0; i < 240 && obRoot; i++) { // até ~2 min
    await obSleep(500);
    if (songs.length !== last) { last = songs.length; stable = 0; }
    else if (last > before && ++stable >= 3) break;
  }
  return songs.length - before;
}

function obPlural(n, um, varios) { return n + " " + (n === 1 ? um : varios); }

// ---------- pasta de músicas (Android) ----------
// A pasta escolhida só é registrada em "Lista de Diretórios" e importada DEPOIS do passo
// de pastas ignoradas, para o que o usuário marcar como ignorado nem chegar a entrar.
let obChosen = [];          // [{uri, name}] pastas escolhidas neste tutorial
const obScan = new Map();   // uri -> { name, files, folders }
const obIgnoreSel = new Set();
const obIgnoreSeen = new Set();
let obStatus = null;        // { baseline, expected, done, timer }

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
  obScan.forEach(sc => {
    (sc.folders || []).forEach(folder => {
      const prefix = folder.relativePath + "/";
      const total = sc.files.filter(f => !obIsLrc(f) && obRel(f).startsWith(prefix)).length;
      if (total) rows.push({ uri: folder.uri, name: folder.name, path: sc.name + "/" + folder.relativePath, rel: folder.relativePath, total });
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

function obIgnoreVisible() { return obHasNative() && obIgnoreRows().length > 0; }

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
  const total = obScanTotal();
  const names = obChosen.map(f => f.name);
  return {
    label: names.length > 2 ? names.slice(0, 2).join(", ") + " e mais " + (names.length - 2) : names.join(", "),
    sub: obPlural(total, "música encontrada", "músicas encontradas")
  };
}

// Registra as pastas em "Lista de Diretórios", grava as ignoradas e importa as músicas.
function obCommit() {
  if (!obChosen.length) return;
  const rows = obIgnoreRows();
  const rowUris = new Set(rows.map(r => r.uri));
  const picked = rows.filter(r => obIgnoreSel.has(r.uri));

  const ignored = getIgnoredFolders().filter(f => !rowUris.has(f.uri));
  picked.forEach(r => ignored.push({ uri: r.uri, name: r.name }));
  setDirectories("ignored", ignored);

  const watched = getWatchedFolders();
  obChosen.forEach(f => { if (!watched.some(w => w.uri === f.uri)) watched.push({ uri: f.uri, name: f.name }); });
  setDirectories("watched", watched);

  // quantas músicas devem entrar (para o indicador de progresso)
  const skipPrefixes = picked.map(r => r.path);
  let expected = 0;
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
  syncWatchedFolder(true).catch(e => logErr("onboarding:sync", e)).finally(() => {
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
    tip.innerHTML = obIcon("info") + "<span>Escolha a pasta principal. O Nyx encontra as subpastas sozinho. Você pode adicionar mais de uma pasta e mudar isso depois em Ajustes.</span>";
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
  const steps = [
    {
      key: "welcome", title: "Bem-vindo ao Nyx", app: true, shape: [8, 0.07],
      text: "Vamos deixar tudo pronto para você. Leva menos de um minuto.",
      primary: "Vamos lá"
    },
    {
      key: "musicas", title: "Suas músicas", icon: "library_music", shape: [6, 0.1],
      text: native
        ? "Escolha a pasta onde ficam suas músicas. O Nyx guarda essa pasta em Ajustes > Biblioteca e importa tudo dela."
        : "Escolha arquivos de áudio ou uma pasta para montar sua biblioteca. O app só recebe o que você selecionar.",
      primary: native ? "Escolher pasta" : "Escolher arquivos",
      busy: native ? "Lendo a pasta…" : "Importando…",
      secondary: native ? "Escolher arquivos" : "",
      again: native ? "Adicionar outra pasta" : "Escolher mais arquivos",
      run: native ? obPickFolder : obPickWeb,
      runSecondary: obPickFiles,
      orbit: ["folder", "music_note", "playlist_add"]
    }
  ];
  if (native) {
    steps.push(
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
      {
        // só aparece se a pasta escolhida tem subpastas com música
        key: "ignoradas", title: "Pastas ignoradas", list: true,
        text: "Tudo é importado por padrão. Toque nas pastas que você não quer na biblioteca, como toques e sons de apps.",
        primary: "Continuar",
        skipIf: () => !obIgnoreVisible()
      }
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

// Navegador (PWA): sem pasta monitorada, só arquivos.
async function obPickWeb() {
  const before = songs.length;
  openFilePicker();
  const added = await obWatchSongs(before);
  return added > 0 ? { label: "Arquivos adicionados", sub: obPlural(added, "música adicionada", "músicas adicionadas") } : null;
}

async function obPickFiles() {
  const before = songs.length;
  openFilePicker();
  const added = await obWatchSongs(before);
  return added > 0 ? { label: "Arquivos adicionados", sub: obPlural(added, "música adicionada", "músicas adicionadas") } : null;
}

let obRoot = null;
let obIndex = 0;
let obAll = [];
let obList = [];
let obDir = 1;
let obBusy = false;
let obResults = {};

// Passos visíveis agora (o de pastas ignoradas só aparece se houver subpastas com música).
function obRefreshList() {
  obList = obAll.filter(st => !(st.skipIf && st.skipIf()));
}

function obFinish() {
  obCommit(); // "Pular tudo" também registra a pasta escolhida
  lsSet(OB_KEY, true);
  lsSet("permsAsked", true); // a folha antiga de importação não precisa aparecer depois
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
  const rows = obIgnoreRows();
  const hint = el("p", "ob-hint");
  const refresh = () => {
    const n = rows.filter(r => obIgnoreSel.has(r.uri)).length;
    hint.textContent = n
      ? obPlural(n, "pasta marcada", "pastas marcadas") + ". As músicas dela não entram na biblioteca."
      : "Nenhuma pasta marcada. Tudo será importado.";
  };
  rows.forEach(r => {
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
    if (obBusy || button.classList.contains("busy")) return;
    const idle = button.querySelector("span").textContent;
    button.classList.add("busy");
    button.querySelector("span").textContent = busyText || "Aguardando…";
    let r = null;
    try { r = await fn(); } catch (e) { logErr("onboarding:" + step.key, e); }
    if (!obRoot) return;
    button.classList.remove("busy");
    button.querySelector("span").textContent = idle;
    if (r) { obResults[step.key] = r; obRender(); }
  };

  const links = el("div", "ob-links");
  if (step.run && done && step.again) {
    const again = el("button", "ob-link");
    again.innerHTML = obIcon("add") + "<span>" + step.again + "</span>";
    again.onclick = () => exec(step.run, main2, step.busy);
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
  main2.appendChild(el("span", "", done ? (last ? "Concluir" : "Continuar") : step.primary));
  main2.insertAdjacentHTML("beforeend", '<i class="ob-spin" aria-hidden="true"></i>' + obIcon("arrow"));
  main2.onclick = () => {
    if (!step.run || done) advance();
    else exec(step.run, main2, step.busy);
  };
  if (step.secondary && !done) {
    // dois botões conectados: pasta | arquivos soltos
    const group = el("div", "ob-group");
    const sec = el("button", "ob-sec", step.secondary);
    sec.onclick = () => exec(step.runSecondary, main2, step.busy);
    group.append(main2, sec);
    row.appendChild(group);
  } else row.appendChild(main2);
  foot.appendChild(row);
}

function startOnboarding(instant) {
  if (obRoot) return;
  obAll = obSteps();
  obIndex = 0;
  obDir = 1;
  obBusy = false;
  obResults = {};
  obShapeR = null;
  obChosen = [];
  obScan.clear();
  obIgnoreSel.clear();
  obIgnoreSeen.clear();
  obRefreshList();

  const root = el("div", "ob");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Configuração inicial do Nyx");

  const top = el("div", "ob-top");
  const dots = el("div", "ob-dots");
  const count = el("span", "ob-count");
  const skipAll = el("button", "ob-skipall", "Pular tudo");
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
