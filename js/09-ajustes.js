"use strict";

/* ==========================================================
   Ajustes (cor do app, preto total, capa em disco, nome)
   ========================================================== */
const ACCENTS = [
  { id: "auto", name: "Da capa da música" },
  { id: 215, name: "Azul" },
  { id: 265, name: "Roxo" },
  { id: 330, name: "Rosa" },
  { id: 0, name: "Vermelho" },
  { id: 28, name: "Laranja" },
  { id: 140, name: "Verde" },
  { id: 175, name: "Turquesa" }
];

function applyWallpaper() {
  const image = typeof settings.wallpaper === "string" ? settings.wallpaper : "";
  let layer = document.getElementById("wallpaperLayer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "wallpaperLayer";
    layer.className = "wallpaper-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.insertBefore(layer, document.body.firstChild);
  }
  layer.style.backgroundImage = image ? 'url("' + image + '")' : "none";
  document.body.classList.toggle("has-wallpaper", !!image);
  const opacity = Math.min(0.55, Math.max(0.08, Number(settings.wallpaperOpacity ?? 0.28)));
  const blur = Math.min(18, Math.max(0, Number(settings.wallpaperBlur ?? 0)));
  document.body.style.setProperty("--wallpaper-opacity", String(opacity));
  document.body.style.setProperty("--wallpaper-blur", blur + "px");
}

function chooseWallpaperFile() {
  let input = $("wallpaperInput");
  if (!input) {
    input = el("input");
    input.type = "file";
    input.id = "wallpaperInput";
    input.accept = "image/*";
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!file.type || !file.type.startsWith("image/")) {
        showToast("Escolha um arquivo de imagem.");
        input.value = "";
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        showToast("Escolha uma imagem de até 20 MB.");
        input.value = "";
        return;
      }

      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const maxSide = 1440;
          const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Não foi possível processar a imagem.");
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          let data = canvas.toDataURL("image/jpeg", 0.72);
          if (data.length > 1800000) data = canvas.toDataURL("image/jpeg", 0.58);
          if (data.length > 2200000) throw new Error("A imagem ficou muito grande. Escolha outra.");
          settings.wallpaper = data;
          saveSettings();
          applyWallpaper();
          refreshSettingsPage();
          showToast("Papel de parede aplicado.");
        } catch (error) {
          showToast(error && error.message ? error.message : "Não foi possível aplicar a imagem.");
        } finally {
          URL.revokeObjectURL(url);
          input.value = "";
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        input.value = "";
        showToast("Não foi possível abrir essa imagem.");
      };
      image.src = url;
    });
  }
  input.click();
}

function applySettings() {
  document.body.classList.toggle("amoled", !!settings.amoled);
  applyWallpaper();
  document.body.classList.toggle("disc", !!settings.disc);
  applyShapes();
  applyFont();
  renderGreeting();
  updateColor();
}

function switchRow(title, desc, key) {
  const row = el("button", "set-row");
  const text = el("div", "set-row-text");
  text.append(el("strong", "", title), el("span", "", desc));

  const sw = el("span", "m3-switch" + (settings[key] ? " on" : ""));
  row.append(text, sw);

  row.onclick = () => {
    settings[key] = !settings[key];
    sw.classList.toggle("on", !!settings[key]);
    saveSettings();
    applySettings();
  };

  return row;
}

let settingsPage = null; // null = menu principal

function catRow(icon, hue, title, desc, onClick) {
  const row = el("button", "cat-row");
  const ic = el("span", "cat-ic material-symbols-rounded", icon);
  ic.style.background = "hsl(" + hue + " 38% 30%)";
  const txt = el("div", "set-row-text");
  txt.append(el("strong", "", title), el("span", "", desc));
  row.append(ic, txt);
  row.onclick = onClick;
  return row;
}

/* ----- páginas dos Ajustes ----- */
function pageAparencia(go) {
  const wallpaperSec = el("div", "set-sec");
  wallpaperSec.appendChild(el("div", "set-label", "Papel de parede"));

  const chooseRow = el("button", "set-row");
  const chooseText = el("div", "set-row-text");
  chooseText.append(
    el("strong", "", "Escolher da galeria"),
    el("span", "", "Defina qualquer imagem do celular como fundo")
  );
  chooseRow.append(chooseText, el("span", "material-symbols-rounded", "image"));
  chooseRow.onclick = chooseWallpaperFile;
  wallpaperSec.appendChild(chooseRow);

  if (settings.wallpaper) {
    const preview = el("div", "wallpaper-preview");
    preview.style.backgroundImage = 'url("' + settings.wallpaper + '")';
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", "Prévia do papel de parede atual");
    wallpaperSec.appendChild(preview);

    const removeRow = el("button", "set-row");
    const removeText = el("div", "set-row-text");
    removeText.append(
      el("strong", "", "Remover papel de parede"),
      el("span", "", "Restaurar o fundo original do aplicativo")
    );
    removeRow.append(removeText, el("span", "material-symbols-rounded", "delete"));
    removeRow.onclick = () => {
      settings.wallpaper = null;
      saveSettings();
      applyWallpaper();
      refreshSettingsPage();
      showToast("Papel de parede removido.");
    };
    wallpaperSec.appendChild(removeRow);
  }

  const makeWallpaperSlider = (title, description, key, min, max, step, initial, format) => {
    const row = el("div", "set-row wallpaper-range-row");
    const text = el("div", "set-row-text");
    const valueLabel = el("span", "wallpaper-value");
    text.append(el("strong", "", title), el("span", "", description), valueLabel);
    const slider = el("input", "wallpaper-range");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initial);
    slider.setAttribute("aria-label", title);
    const update = persist => {
      const value = Number(slider.value);
      settings[key] = key === "wallpaperOpacity" ? value / 100 : value;
      valueLabel.textContent = format(value);
      applyWallpaper();
      if (persist) saveSettings();
    };
    slider.oninput = () => update(false);
    slider.onchange = () => update(true);
    update(false);
    row.append(text, slider);
    return row;
  };

  wallpaperSec.appendChild(makeWallpaperSlider(
    "Intensidade", "Ajuste quanto da imagem aparece", "wallpaperOpacity",
    8, 55, 1, Math.round(Number(settings.wallpaperOpacity ?? 0.28) * 100),
    value => value + "%"
  ));
  wallpaperSec.appendChild(makeWallpaperSlider(
    "Desfoque", "Deixe o fundo mais suave", "wallpaperBlur",
    0, 18, 1, Number(settings.wallpaperBlur ?? 0),
    value => value + " px"
  ));

  const sec = el("div", "set-sec");
  sec.appendChild(el("div", "set-label", "Cor do app"));

  const swatches = el("div", "swatches");
  const hint = el("div", "set-hint", "");
  const buttons = [];

  const refresh = () => {
    buttons.forEach(({ b, a }) => {
      const on = settings.accent === a.id;
      b.classList.toggle("on", on);
      b.replaceChildren();
      if (on) b.appendChild(el("span", "material-symbols-rounded", "check"));
    });

    const cur = ACCENTS.find(a => a.id === settings.accent);
    hint.textContent = "Cor atual: " + (cur ? cur.name : "Da capa da música");
  };

  ACCENTS.forEach(a => {
    const b = el("button", "swatch" + (a.id === "auto" ? " auto" : ""));
    b.setAttribute("aria-label", a.name);
    if (a.id !== "auto") b.style.background = "hsl(" + a.id + " 70% 62%)";

    b.onclick = () => {
      settings.accent = a.id;
      saveSettings();
      refresh();
      updateColor();
    };

    buttons.push({ b, a });
    swatches.appendChild(b);
  });

  refresh();
  wallpaperSec.classList.add("wallpaper-settings");
  sec.append(swatches, hint);
  sec.appendChild(
    switchRow("Preto total", "Fundo preto puro (economiza bateria em tela AMOLED)", "amoled")
  );
  sec.appendChild(
    switchRow("Capa em disco", "A capa vira um disco que gira enquanto toca", "disc")
  );

  const fontSec = el("div", "set-sec");
  fontSec.appendChild(el("div", "set-label", "Fonte das letras"));

  const fontRows = [];
  const paintFonts = () => {
    fontRows.forEach(({ id, check }) => {
      check.replaceChildren();
      if (settings.font === id) check.appendChild(el("span", "material-symbols-rounded", "check"));
    });
  };

  const fontRow = (id, name, note, family, deletable) => {
    const row = el("div", "set-row font-row");
    const main = el("button", "font-main");
    const text = el("div", "set-row-text");
    const title = el("strong", "", name);
    title.style.fontFamily = family;
    text.append(title, el("span", "", note));
    const check = el("span", "font-check");
    main.append(text, check);
    main.onclick = () => {
      settings.font = id;
      saveSettings();
      applyFont();
      paintFonts();
    };
    row.appendChild(main);

    if (deletable) {
      const del = el("button", "font-del");
      del.setAttribute("aria-label", "Apagar fonte");
      del.appendChild(el("span", "material-symbols-rounded", "delete"));
      del.onclick = async () => {
        const ok = await showDialog({
          title: "Apagar essa fonte?",
          text: "“" + name + "” será removida do app.",
          confirmLabel: "Apagar",
          danger: true
        });
        if (!ok) return;
        customFonts = customFonts.filter(f => f.id !== id);
        fontDbDelete(id);
        if (settings.font === id) {
          settings.font = "roboto";
          saveSettings();
          applyFont();
        }
        go("aparencia");
      };
      row.appendChild(del);
    }

    fontRows.push({ id, check });
    fontSec.appendChild(row);
  };

  GOOGLE_FONTS.forEach(f => {
    ensureGoogleFont(f);
    fontRow(f.id, f.name, f.note, f.id === "system" ? "system-ui" : '"' + f.family + '", system-ui, sans-serif', false);
  });
  customFonts.forEach(f => fontRow(f.id, f.name, "Importada por você", '"' + f.family + '", system-ui, sans-serif', true));

  const importRow = el("button", "set-row");
  const importText = el("div", "set-row-text");
  importText.append(
    el("strong", "", "Importar fonte"),
    el("span", "", "Escolha um arquivo .ttf, .otf ou .woff2 do seu celular")
  );
  importRow.append(importText, el("span", "material-symbols-rounded", "upload_file"));
  importRow.onclick = () => $("fontInput").click();
  fontSec.appendChild(importRow);
  paintFonts();

  const shapeSec = el("div", "set-sec");
  shapeSec.appendChild(el("div", "set-label", "Formas das bolinhas"));

  Object.keys(BUBBLES).forEach(id => {
    const row = el("button", "set-row");
    const cur = settings.shapes[id] || "default";
    const curName = (SHAPES.find(s => s.id === cur) || SHAPES[0]).name;
    const txt = el("div", "set-row-text");
    txt.append(el("strong", "", BUBBLES[id]), el("span", "", curName));
    const prev = el("span", "shape-prev mini shape-" + (cur !== "default" ? cur : DEFAULT_PREV[id]));
    row.append(txt, prev);
    row.onclick = () => openShapePicker(id, true);
    shapeSec.appendChild(row);
  });

  const resetRow = el("button", "set-row");
  const resetText = el("div", "set-row-text");
  resetText.append(
    el("strong", "", "Restaurar formas"),
    el("span", "", "Volta todas as bolinhas ao formato padrão")
  );
  resetRow.append(resetText, el("span", "material-symbols-rounded", "restart_alt"));
  resetRow.onclick = () => {
    settings.shapes = {};
    saveSettings();
    applyShapes();
    go("aparencia");
  };
  shapeSec.appendChild(resetRow);

  return [wallpaperSec, sec, fontSec, shapeSec];
}

let settingsMediaFoldersLoading = false;
let settingsMediaFoldersAttempted = false;
let settingsMediaFoldersPromise = null;

function settingsMediaAudioFolderKey(folder) {
  const location = mediaAudioCanonicalLocation(folder && folder.volumeName, folder && folder.relativePath);
  return location.volume + "::" + location.path;
}

function settingsWatchedAudioFolderKey(folder) {
  const canonical = mediaAudioCanonicalFromSaf(folder && folder.uri, "");
  const prefix = "android-audio-path::";
  if (!canonical.startsWith(prefix)) return "";
  const rest = canonical.slice(prefix.length);
  const split = rest.indexOf("::");
  if (split <= 0) return "";
  return settingsMediaAudioFolderKey({
    volumeName: rest.slice(0, split),
    relativePath: rest.slice(split + 2)
  });
}

function settingsMediaAudioFoldersForDisplay() {
  if (!lsGet("mediaAudioEnabled", false)) return [];
  const excluded = getMediaAudioImportExclusions();
  const manualKeys = new Set(getWatchedFolders().map(settingsWatchedAudioFolderKey).filter(Boolean));
  const folders = getMediaAudioFoldersCache().map(folder => {
    const relativePath = normalizeMediaAudioPath(folder.relativePath);
    const location = mediaAudioCanonicalLocation(folder.volumeName, relativePath);
    return {
      ...folder,
      relativePath,
      key: location.volume + "::" + location.path,
      volumeKey: location.volume,
      pathKey: location.path,
      depth: relativePath && relativePath !== "/" ? relativePath.split("/").filter(Boolean).length - 1 : 0,
      displayPath: relativePath || folder.name
    };
  }).filter(folder => !mediaAudioFolderIsExcluded(folder, excluded) && !manualKeys.has(folder.key));

  return folders.map(folder => {
    const total = folders.reduce((sum, child) => {
      const inside = child.volumeKey === folder.volumeKey
        && (!folder.pathKey || folder.pathKey === "/" || child.pathKey === folder.pathKey || child.pathKey.startsWith(folder.pathKey + "/"));
      return sum + (inside ? Number(child.count) || 0 : 0);
    }, 0);
    return { ...folder, total, automatic: true };
  }).sort((a, b) => a.volumeKey.localeCompare(b.volumeKey, "pt-BR")
    || a.relativePath.localeCompare(b.relativePath, "pt-BR", { numeric: true }));
}

function loadSettingsMediaAudioFolders() {
  if (settingsMediaFoldersPromise || settingsMediaFoldersAttempted || !MN || !lsGet("mediaAudioEnabled", false)
      || lsGet("mediaAudioFoldersCacheLoaded", false)
      || typeof MN.hasAudioLibraryAccess !== "function"
      || typeof MN.listMediaAudioFolders !== "function") return;
  settingsMediaFoldersAttempted = true;
  settingsMediaFoldersLoading = true;
  settingsMediaFoldersPromise = (async () => {
    try {
      const access = await MN.hasAudioLibraryAccess();
      if (!access || !access.granted) return;
      const result = await MN.listMediaAudioFolders();
      setMediaAudioFoldersCache(Array.isArray(result && result.folders) ? result.folders : []);
    } catch (error) {
      logErr("ajustes:media-folders", error);
    } finally {
      settingsMediaFoldersLoading = false;
      settingsMediaFoldersPromise = null;
      if (settingsOpen && settingsPage === "biblioteca") refreshSettingsPage();
    }
  })();
}

function directorySettingsGroup(title, description, folders, kind, options = {}) {
  const sec = el("div", "set-sec directory-settings");
  const head = el("div", "directory-group-head");
  const heading = el("div", "set-row-text");
  heading.append(el("strong", "", title), el("span", "", description));
  const addLabel = kind === "watched" ? "Adicionar manualmente" : "Adicionar";
  const add = el("button", "perm-btn directory-add-btn", addLabel);
  add.type = "button";
  add.setAttribute("aria-label", addLabel);
  add.onclick = async () => {
    if (await addDirectory(kind)) refreshSettingsPage();
  };
  head.append(heading, add);
  sec.appendChild(head);

  if (options.loading) {
    sec.appendChild(el("div", "directory-empty", "Buscando pastas do aparelho…"));
  } else if (!folders.length) {
    sec.appendChild(el("div", "directory-empty", kind === "ignored"
      ? "Nenhuma pasta ignorada"
      : (options.emptyMessage || "Nenhuma pasta adicionada manualmente")));
  }
  folders.forEach(folder => {
    const automatic = !!folder.automatic;
    const row = el("div", "set-row directory-row" + (automatic ? " directory-row-automatic" : ""));
    if (automatic && folder.depth) row.style.paddingInlineStart = (16 + Math.min(folder.depth, 5) * 12) + "px";
    row.appendChild(el("span", "material-symbols-rounded directory-icon", "folder"));
    const text = el("div", "set-row-text");
    const name = automatic ? (folder.displayPath || folder.name) : folder.name;
    const subtitle = automatic
      ? "Incluída automaticamente · " + folder.total + " " + (folder.total === 1 ? "áudio" : "áudios")
      : kind === "ignored" ? "Ignorado nas novas varreduras; músicas já adicionadas permanecem" : "Escolhida manualmente";
    text.append(el("strong", "", name), el("span", "", subtitle));
    if (automatic) {
      const included = el("span", "material-symbols-rounded directory-auto-mark", "check_circle");
      included.setAttribute("aria-label", "Incluída automaticamente");
      row.append(text, included);
      sec.appendChild(row);
      return;
    }
    const remove = el("button", "directory-remove", "");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remover " + folder.name);
    remove.appendChild(el("span", "material-symbols-rounded", "close"));
    remove.onclick = async () => {
      await removeDirectory(kind, folder.uri);
      refreshSettingsPage();
    };
    row.append(text, remove);
    sec.appendChild(row);
  });
  return sec;
}

function pageBiblioteca() {
  const out = [];
  if (MN && typeof addDirectory === "function") {
    loadSettingsMediaAudioFolders();
    const automaticFolders = settingsMediaAudioFoldersForDisplay();
    const manualFolders = getWatchedFolders().map(folder => ({ ...folder, automatic: false }));
    const emptyMessage = !lsGet("mediaAudioEnabled", false)
      ? "Permita o acesso aos áudios do aparelho abaixo para listar as pastas automaticamente."
      : lsGet("mediaAudioFoldersCacheLoaded", false)
        ? "Nenhuma pasta com áudio foi encontrada."
        : "Abra Pastas de áudio do aparelho para carregar a lista.";
    out.push(directorySettingsGroup(
      "Pastas monitoradas",
      "As pastas não ignoradas entram automaticamente.",
      automaticFolders.concat(manualFolders),
      "watched",
      { loading: settingsMediaFoldersLoading, emptyMessage }
    ));
    if (typeof openMediaAudioManager === "function") {
      const mediaSec = el("div", "set-sec");
      const mediaRow = el("button", "set-row");
      const mediaText = el("div", "set-row-text");
      mediaText.append(el("strong", "", "Pastas de áudio do aparelho"), el("span", "",
        "As pastas não marcadas entram automaticamente. Abra para ignorar uma pasta ou subpasta."));
      mediaRow.append(mediaText, el("span", "material-symbols-rounded", "folder"));
      mediaRow.onclick = openMediaAudioManager;
      mediaSec.appendChild(mediaRow);
      if (lsGet("mediaAudioEnabled", false)) {
        const refreshRow = el("button", "set-row");
        const refreshText = el("div", "set-row-text");
        refreshText.append(el("strong", "", "Atualizar biblioteca do aparelho"), el("span", "", "Procura músicas novas no aparelho; as já importadas permanecem."));
        refreshRow.append(refreshText, el("span", "material-symbols-rounded", "refresh"));
        refreshRow.onclick = async () => {
          await syncMediaAudioLibrary(true);
          if (settingsPage === "biblioteca") refreshSettingsPage();
        };
        mediaSec.appendChild(refreshRow);
      }
      out.push(mediaSec);
    }
    if (getWatchedFolders().length) {
      const syncSec = el("div", "set-sec");
      const syncRow = el("button", "set-row");
      const syncText = el("div", "set-row-text");
      syncText.append(el("strong", "", "Verificar pastas monitoradas"), el("span", "", "Procura músicas novas nas pastas monitoradas."));
      syncRow.append(syncText, el("span", "material-symbols-rounded", "refresh"));
      syncRow.onclick = () => syncWatchedFolder(true);
      syncSec.appendChild(syncRow);
      out.push(syncSec);
    }
  }
  const sec = el("div", "set-sec");
  const permRow = el("button", "set-row");
  const permText = el("div", "set-row-text");
  permText.append(
    el("strong", "", "Importação manual e controles"),
    el("span", "", "Importe arquivos ou uma pasta sem ativar o monitoramento automático.")
  );
  permRow.append(permText, el("span", "material-symbols-rounded", "folder"));
  permRow.onclick = () => openPermissions(false);
  sec.appendChild(permRow);
  out.push(sec);

  const genreSec = el("details", "set-sec set-disclosure");
  const summary = el("summary", "set-row set-disclosure-summary");
  const summaryText = el("div", "set-row-text");
  summaryText.appendChild(el("strong", "", "Manutenção"));
  summary.append(
    el("span", "material-symbols-rounded set-disclosure-leading-icon", "settings"),
    summaryText,
    el("span", "material-symbols-rounded set-disclosure-icon", "keyboard_arrow_down")
  );
  genreSec.appendChild(summary);

  const genreBody = el("div", "set-disclosure-body");
  const genreRow = el("button", "set-row");
  const genreText = el("div", "set-row-text");
  genreText.append(el("strong", "", "Ler gêneros das músicas"), el("span", "", "Procura o gênero nas etiquetas das músicas que já estão na biblioteca"));
  genreRow.append(genreText, el("span", "material-symbols-rounded", "category"));
  genreRow.onclick = () => scanGenres(true);
  genreBody.appendChild(genreRow);
  genreSec.appendChild(genreBody);
  out.push(genreSec);
  return out;
}

function pageReproducao() {
  const sec = el("div", "set-sec");
  if (MN) {
    sec.appendChild(
      switchRow("Player nativo (segundo plano mais estável)", "Toca pelo Android, mesmo com o app congelado. Feche e abra o app depois de mudar.", "nativePlayer")
    );
  }
  const out = [];
  if (sec.children.length) out.push(sec);
  return out.concat(audioExtrasSections());
}

function pageComportamento() {
  const sec = el("div", "set-sec");
  sec.appendChild(
    switchRow("Deslizar entre páginas", "Arraste para o lado para trocar de página", "swipe")
  );
  sec.appendChild(
    switchRow("Inverter o gesto", "Troca a direção do arrastar entre as páginas", "swipeInvert")
  );
  return [sec];
}

function pagePrivacidade() {
  const sec = el("div", "set-sec");
  sec.appendChild(el("div", "set-label", "Busca online"));
  sec.appendChild(
    switchRow("Buscar letras automaticamente", "Consulta o LRCLIB usando título, artista e álbum quando disponíveis; o áudio não é enviado", "autoLyrics")
  );
  sec.appendChild(
    switchRow("Buscar capas automaticamente", "Consulta a iTunes usando título, artista e álbum quando disponíveis; o áudio não é enviado", "autoCovers")
  );
  return [sec];
}

function pageDiagnostico() {
  const sec = el("div", "set-sec");
  const errRow = el("button", "set-row");
  const errText = el("div", "set-row-text");
  errText.append(
    el("strong", "", "Registro de erros"),
    el("span", "", readErrLog().length ? "Há problemas registrados; toque para ver e copiar" : "Nenhum problema registrado")
  );
  errRow.append(errText, el("span", "material-symbols-rounded", "bug_report"));
  errRow.onclick = async () => {
    const txt = errLogText();
    if (!txt) { showToast("Nenhum erro registrado."); return; }
    const ok = await showDialog({
      title: "Registro de erros",
      text: txt.length > 900 ? txt.slice(0, 900) + "…" : txt,
      confirmLabel: "Copiar tudo"
    });
    if (!ok) return;
    try {
      await navigator.clipboard.writeText(txt);
      showToast("Copiado.");
    } catch (e) {
      logErr("copiar-registro", e);
      showToast("Não consegui copiar.");
    }
  };
  sec.appendChild(errRow);
  return [sec];
}

async function editProfileName() {
  const n = await showDialog({
    title: "Seu nome",
    input: { value: settings.name, placeholder: "Como você quer ser chamado?" },
    confirmLabel: "Salvar"
  });
  if (n !== null) {
    settings.name = n;
    saveSettings();
    renderGreeting();
    refreshSettingsPage();
  }
}

const SETTINGS_PAGES = {
  aparencia: { title: "Aparência", build: pageAparencia },
  biblioteca: { title: "Biblioteca", build: pageBiblioteca },
  reproducao: { title: "Reprodução", build: pageReproducao },
  comportamento: { title: "Comportamento", build: pageComportamento },
  privacidade: { title: "Privacidade", build: pagePrivacidade },
  diagnostico: { title: "Diagnóstico", build: pageDiagnostico }
};

let settingsEl = null;
let settingsOpen = false;

function renderSettingsPage(box, go) {
  box.replaceChildren();
  const page = SETTINGS_PAGES[settingsPage];
  if (!page) settingsPage = null;

  const top = el("div", "sp-top");
  const back = el("button", "set-back");
  back.setAttribute("aria-label", "Voltar");
  back.appendChild(el("span", "material-symbols-rounded", "arrow_back"));
  back.onclick = () => (page ? go(null) : closeSettings());
  top.appendChild(back);
  box.append(top, el("h2", "sp-title", page ? page.title : "Ajustes"));

  if (!page) {
    const list = el("div", "cat-list");
    list.append(
      catRow("person", 215, "Perfil", settings.name ? settings.name : "Seu nome e saudação", editProfileName),
      catRow("library_music", 205, "Biblioteca", "Importar músicas e pastas", () => go("biblioteca")),
      catRow("light_mode", 335, "Aparência", "Cor do app, fonte, preto total, capa em disco", () => go("aparencia"))
    );
    list.appendChild(catRow("translate", 265, "Idioma", languageSummary(), () => go("idioma")));
    list.appendChild(catRow("music_note", 350, "Reprodução", MN ? "Temporizador, equalizador e player nativo" : "Temporizador de desligar", () => go("reproducao")));
    list.append(
      catRow("settings", 230, "Comportamento", "Deslizar entre páginas e gestos", () => go("comportamento")),
      catRow("lyrics", 175, "Privacidade", "Buscas online de letras e capas", () => go("privacidade")),
      catRow("bug_report", 120, "Diagnóstico", "Registro de erros", () => go("diagnostico"))
    );
    box.appendChild(list);
    return;
  }

  page.build(go).forEach(n => box.appendChild(n));
}

// navegar dentro dos Ajustes; fromPop = veio do botão voltar do Android
function settingsGo(p, fromPop) {
  if (!settingsEl) return;
  if (!fromPop) {
    try {
      if (p && settingsPage === null) history.pushState({ settings: 2 }, "");
      else if (!p && settingsPage !== null) {
        if (history.state && history.state.settings === 2) { history.back(); return; }
      }
    } catch (e) { logErr("ajustes:nav", e); }
  }
  if (p === "biblioteca") settingsMediaFoldersAttempted = false;
  settingsPage = p;
  renderSettingsPage(settingsEl, settingsGo);
  settingsEl.scrollTop = 0;
}

function refreshSettingsPage() {
  if (settingsOpen && settingsEl) renderSettingsPage(settingsEl, settingsGo);
}

function openSettings(page) {
  closeSheet();
  if (!settingsEl) {
    settingsEl = el("div", "settings-page");
    settingsEl.id = "settingsPage";
    settingsEl.setAttribute("role", "dialog");
    settingsEl.setAttribute("aria-modal", "true");
    settingsEl.setAttribute("aria-label", "Ajustes");
    settingsEl.setAttribute("tabindex", "-1");
    document.body.appendChild(settingsEl);
  }
  settingsPage = typeof page === "string" ? page : null;
  if (settingsPage === "biblioteca") settingsMediaFoldersAttempted = false;
  renderSettingsPage(settingsEl, settingsGo);
  settingsEl.scrollTop = 0;

  if (!settingsOpen) {
    try {
      history.pushState({ settings: 1 }, "");
      if (settingsPage) history.pushState({ settings: 2 }, "");
    } catch (e) { logErr("ajustes:abrir", e); }
  }
  settingsOpen = true;
  document.body.classList.add("settings-open", "no-scroll");
  settingsEl.classList.add("open");
  settingsEl.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => settingsEl.focus());
}

function closeSettings(fromPop) {
  if (!settingsOpen) return;
  settingsOpen = false;
  settingsPage = null;
  settingsEl.classList.remove("open");
  settingsEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("settings-open");
  if (!fpOpen) document.body.classList.remove("no-scroll");
  if (!fromPop) {
    try {
      const n = history.state && history.state.settings;
      if (n) history.go(-n);
    } catch (e) { logErr("ajustes:fechar", e); }
  }
  const g = $("homeSettings");
  if (g) g.focus();
}

window.addEventListener("popstate", () => {
  if (!settingsOpen || fpOpen) return;
  const st = history.state && history.state.settings;
  if (!st) closeSettings(true);
  else if (st === 1 && settingsPage !== null) settingsGo(null, true);
});

/* ==========================================================
   Formas das bolinhas (segure para personalizar)
   ========================================================== */
const BUBBLES = {
  artMain: "Capa do Continuar ouvindo",
  favCovers: "Capas dos favoritos",
  songCovers: "Capas das músicas (listas)",
  nowCover: "Capa do mini player",
  fpCover: "Capa do player completo",
  heroPlay: "Botão de tocar"
};

const BUBBLE_SEL = {
  artMain: "#artMain",
  favCovers: ".fav-cov",
  songCovers: ".song-cover, .h-cover",
  nowCover: "#nowCover",
  fpCover: "#fpCover",
  heroPlay: "#heroPlay"
};

const SHAPES = [
  { id: "default", name: "Padrão" },
  { id: "scal8", name: "Biscoito 8" },
  { id: "scal6", name: "Biscoito 6" },
  { id: "scal5", name: "Biscoito 5" },
  { id: "circle", name: "Círculo" },
  { id: "squircle", name: "Quadrado" },
  { id: "pill", name: "Pílula" },
  { id: "blob", name: "Blob" },
  { id: "diamond", name: "Losango" },
  { id: "hexagon", name: "Hexágono" },
  { id: "star", name: "Estrela" },
  { id: "flower", name: "Flor" },
  { id: "cookie", name: "Biscoito" },
  { id: "heart", name: "Coração" }
];

// Formas com recorte (clip-path) são desenhadas em SVG, em coordenadas 0..1
function buildClipDefs() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";

  const add = (id, d) => {
    const cp = document.createElementNS(NS, "clipPath");
    cp.setAttribute("id", "clip-" + id);
    cp.setAttribute("clipPathUnits", "objectBoundingBox");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    cp.appendChild(p);
    svg.appendChild(cp);
  };

  const radial = (n, base, amp) => {
    let d = "";
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const r = base + amp * Math.cos(n * a);
      d += (i ? "L" : "M") + (0.5 + r * Math.cos(a)).toFixed(4) + "," + (0.5 + r * Math.sin(a)).toFixed(4);
    }
    return d + "Z";
  };

  const star = () => {
    let d = "";
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 0.22 : 0.5;
      d += (i ? "L" : "M") + (0.5 + r * Math.cos(a)).toFixed(4) + "," + (0.5 + r * Math.sin(a)).toFixed(4);
    }
    return d + "Z";
  };

  add("star", star());
  add("flower", radial(6, 0.39, 0.11));
  add("cookie", radial(12, 0.46, 0.04));
  // formas do visual M3 Expressive (capas das listas, mini player e Início)
  add("scal8", radial(8, 0.45, 0.04));
  add("scal6", radial(6, 0.44, 0.05));
  add("scal5", radial(5, 0.43, 0.055));
  add(
    "heart",
    "M0.5,0.97 C0.12,0.68 0,0.5 0,0.29 C0,0.11 0.13,0.02 0.27,0.02 C0.37,0.02 0.45,0.07 0.5,0.16 C0.55,0.07 0.63,0.02 0.73,0.02 C0.87,0.02 1,0.11 1,0.29 C1,0.5 0.88,0.68 0.5,0.97 Z"
  );

  document.body.appendChild(svg);
}
buildClipDefs();

function applyShapes() {
  Object.keys(BUBBLES).forEach(id => {
    const s = settings.shapes[id];
    document.querySelectorAll(BUBBLE_SEL[id]).forEach(node => {
      [...node.classList].forEach(c => {
        if (c.indexOf("shape-") === 0) node.classList.remove(c);
      });
      if (s && s !== "default") node.classList.add("shape-" + s);
    });
  });
}

const DEFAULT_PREV = { artMain: "scal8", favCovers: "scal8", songCovers: "scal8", nowCover: "scal6", fpCover: "scal8", heroPlay: "squircle" };

function openShapePicker(id, backToSettings) {
  const returnFocus = activeSheet ? activeSheet.returnFocus : document.activeElement;
  closeSheet();

  const scrim = el("div", "scrim");
  const sheet = el("div", "sheet");
  sheet.appendChild(el("div", "sheet-handle"));
  sheet.appendChild(el("h3", "", BUBBLES[id]));
  sheet.appendChild(el("div", "set-hint shape-hint", "Escolha o formato"));

  const grid = el("div", "shape-grid");
  const current = settings.shapes[id] || "default";

  SHAPES.forEach(s => {
    const b = el("button", "shape-opt" + (s.id === current ? " on" : ""));
    b.setAttribute("aria-label", s.name);
    const prev = el("span", "shape-prev shape-" + (s.id !== "default" ? s.id : DEFAULT_PREV[id]));
    b.append(prev, el("small", "", s.name));

    b.onclick = () => {
      if (s.id === "default") delete settings.shapes[id];
      else settings.shapes[id] = s.id;
      saveSettings();
      applyShapes();
      closeSheet();
      if (backToSettings) setTimeout(refreshSettingsPage, 300);
    };

    grid.appendChild(b);
  });

  sheet.appendChild(grid);

  scrim.onclick = closeSheet;
  presentSheet(scrim, sheet, returnFocus);
}


/* ==========================================================
   Importação e suporte do navegador
   ========================================================== */
async function openPermissions(firstRun) {
  const returnFocus = firstRun
    ? $("homeSettings")
    : activeSheet ? activeSheet.returnFocus : document.activeElement;
  closeSheet();
  if (firstRun) lsSet("permsAsked", true);

  const scrim = el("div", "scrim");
  const sheet = el("div", "sheet");
  sheet.appendChild(el("div", "sheet-handle"));
  sheet.appendChild(el("h3", "", firstRun ? "Bem-vindo à Música!" : "Importar músicas"));
  sheet.appendChild(
    el("div", "set-hint perm-intro", "Escolha arquivos ou uma pasta para adicionar músicas. O app só recebe os itens que você selecionar.")
  );

  const sec = el("div", "set-sec");
  const addOption = (icon, title, desc, label, action) => {
    const row = el("div", "set-row perm-row");
    row.appendChild(el("span", "material-symbols-rounded perm-ico", icon));
    const text = el("div", "set-row-text");
    text.append(el("strong", "", title), el("span", "", desc));
    const btn = el("button", "perm-btn", label);
    btn.onclick = () => {
      closeSheet();
      action();
    };
    row.append(text, btn);
    sec.appendChild(row);
  };

  addOption("folder", "Pasta de músicas", "Importa arquivos de áudio encontrados na pasta escolhida.", "Escolher", importFolder);
  addOption("upload_file", "Arquivos de áudio", "Selecione uma ou mais músicas individualmente.", "Escolher", openFilePicker);

  const note = el(
    "div",
    "set-hint",
    "Os controles na tela bloqueada dependem do suporte do navegador. Eles não precisam da permissão de notificações."
  );
  const done = el("button", "perm-done", firstRun ? "Continuar" : "Fechar");
  done.onclick = closeSheet;

  sheet.append(sec, note, done);
  scrim.onclick = closeSheet;
  presentSheet(scrim, sheet, returnFocus);
}

// Primeira abertura: mostra opções de importação uma vez.
async function maybeAskPermissionsFirstRun() {
  if (lsGet("permsAsked", false)) return;
  setTimeout(() => openPermissions(true), 1500);
}
