"use strict";

/* ==========================================================
   Navegação
   ========================================================== */
const pageIds = {
  home: "homePage",
  search: "searchPage",
  library: "libraryPage"
};

const pageOrder = ["home", "search", "library"];
let pageTimer = null;

function cleanupLeaving() {
  document.querySelectorAll(".page.leaving").forEach(p => {
    p.classList.remove("leaving", "leave-left", "leave-right");
    p.style.transform = "";
    p.style.opacity = "";
    p.style.transition = "";
  });
}

function openPage(name, opts) {
  opts = opts || {};
  const prev = document.body.dataset.page;
  const same = prev === name;
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  clearTimeout(pageTimer);
  cleanupLeaving();
  // "no-enter" ficava preso quando o timer era cancelado por outra troca rápida e
  // bloqueava a animação de saída da página (ela ficava parada por cima da nova)
  document.querySelectorAll(".page.no-enter").forEach(p => p.classList.remove("no-enter"));

  const dir = pageOrder.indexOf(name) > pageOrder.indexOf(prev) ? 1 : -1; // 1 = vai para a direita (próxima)
  const outEl = $(pageIds[prev]);
  const inEl = $(pageIds[name]);

  document.body.dataset.page = name;

  document.querySelectorAll(".page").forEach(p => {
    p.classList.remove("active", "enter-from-right", "enter-from-left", "stagger");
  });
  inEl.classList.add("active");

  if (!same && !reduced) {
    outEl.classList.add("leaving", dir > 0 ? "leave-left" : "leave-right");
    if (opts.fromDrag) inEl.classList.add("no-enter");
    else inEl.classList.add(dir > 0 ? "enter-from-right" : "enter-from-left", "stagger");
    pageTimer = setTimeout(() => {
      cleanupLeaving();
      inEl.classList.remove("enter-from-right", "enter-from-left", "stagger", "no-enter");
    }, 650);
  }

  document.querySelectorAll(".nav-item").forEach(b => {
    const active = b.dataset.target === name;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });

  window.scrollTo({ top: 0, behavior: same ? "smooth" : "auto" });

  if (name === "search") renderSearch();
  if (name === "library") renderLibrary();
}

document.querySelectorAll(".nav-item").forEach(b => {
  b.addEventListener("click", () => openPage(b.dataset.target));
});

/* ==========================================================
   Deslizar entre as páginas (Your Mix ⇄ Search ⇄ Library)
   ========================================================== */
(function initPageSwipe() {
  let sx = 0, sy = 0, st = 0, dx = 0;
  let active = false, engaged = false, page = null;
  let peekName = null, peekEl = null;

  const BLOCK = ".hscroll, .filters, input, textarea, .seek-wrap, .sheet, .dialog, .scrim, .full-player, .now-playing, .bottom-nav, .playlist-bar, .settings-page";
  const EASE = "cubic-bezier(.22, 1, .36, 1)";

  function neighborFor(delta) {
    const i = pageOrder.indexOf(document.body.dataset.page);
    const step = (delta < 0 ? 1 : -1) * (settings.swipeInvert ? -1 : 1);
    return pageOrder[i + step] || null;
  }

  function width() {
    return (page && page.getBoundingClientRect().width) || window.innerWidth;
  }

  // mostra a página do lado junto com a atual (assim nunca fica tela vazia)
  function setPeek(name) {
    if (name === peekName) return;
    clearPeek();
    if (!name) return;
    peekName = name;
    peekEl = $(pageIds[name]);
    if (name === "search") renderSearch();
    if (name === "library") renderLibrary();
    peekEl.style.transition = "none";
    peekEl.classList.add("peek");
  }

  function clearPeek() {
    if (peekEl) {
      peekEl.classList.remove("peek");
      peekEl.style.transform = "";
      peekEl.style.transition = "";
    }
    peekName = null;
    peekEl = null;
  }

  document.addEventListener("touchstart", e => {
    active = false;
    if (!settings.swipe || e.touches.length !== 1 || fpOpen) return;
    if (document.querySelector(".scrim, .dialog")) return;
    if (e.target.closest && e.target.closest(BLOCK)) return;

    const t = e.touches[0];
    sx = t.clientX;
    sy = t.clientY;
    st = performance.now();
    dx = 0;
    engaged = false;
    active = true;
    page = $(pageIds[document.body.dataset.page]);
    clearPeek();
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!active) return;
    const t = e.touches[0];
    const mx = t.clientX - sx;
    const my = t.clientY - sy;

    if (!engaged) {
      if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { active = false; return; } // rolagem vertical
      if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4) {
        engaged = true;
        page.style.transition = "none";
        page.classList.add("dragging");
      } else return;
    }

    e.preventDefault();
    dx = mx;
    const target = neighborFor(dx);
    setPeek(target);

    const W = width();
    if (target) {
      page.style.transform = "translateX(" + dx.toFixed(1) + "px)";
      peekEl.style.transform = "translateX(" + (dx + (dx < 0 ? W : -W)).toFixed(1) + "px)";
    } else {
      page.style.transform = "translateX(" + (dx * 0.16).toFixed(1) + "px)"; // sem página do outro lado: elástico
    }
  }, { passive: false });

  function finish() {
    if (!active) return;
    active = false;
    if (!engaged) return;
    engaged = false;

    const v = Math.abs(dx) / Math.max(1, performance.now() - st);
    const target = neighborFor(dx);
    const W = width();
    page.classList.remove("dragging");

    if (target && peekEl && (Math.abs(dx) > 70 || v > 0.5)) {
      // conclui: a página do lado termina de entrar, a atual termina de sair
      const inEl = peekEl;
      peekName = null;
      peekEl = null;
      page.style.transition = "";
      openPage(target, { fromDrag: true });
      inEl.classList.remove("peek");
      void inEl.offsetWidth;
      inEl.style.transition = "transform .42s " + EASE;
      inEl.style.transform = "";
      setTimeout(() => { inEl.style.transition = ""; }, 460);
    } else {
      // volta com efeito de mola
      const cur = page;
      const other = peekEl;
      cur.style.transition = "transform .5s var(--spring)";
      cur.style.transform = "";
      if (other) {
        other.style.transition = "transform .5s var(--spring)";
        other.style.transform = "translateX(" + (dx < 0 ? W : -W) + "px)";
      }
      setTimeout(() => {
        cur.style.transition = "";
        clearPeek();
      }, 520);
    }
  }

  function cancel() {
    if (!active && !engaged && !peekEl) return;

    const cur = page;
    const other = peekEl;
    const canceledDx = dx;
    const W = width();
    const wasEngaged = engaged;

    active = false;
    engaged = false;
    sx = 0;
    sy = 0;
    st = 0;
    dx = 0;
    page = null;

    if (!cur) {
      clearPeek();
      return;
    }
    cur.classList.remove("dragging");
    if (!wasEngaged) {
      cur.style.transform = "";
      cur.style.transition = "";
      clearPeek();
      return;
    }

    // Um gesto cancelado sempre volta ao estado inicial; nunca conclui a navegação.
    cur.style.transition = "transform .5s var(--spring)";
    cur.style.transform = "";
    if (other) {
      other.style.transition = "transform .5s var(--spring)";
      other.style.transform = "translateX(" + (canceledDx < 0 ? W : -W) + "px)";
    }
    setTimeout(() => {
      if (page !== null || peekEl !== other) return;
      cur.style.transition = "";
      clearPeek();
    }, 520);
  }

  document.addEventListener("touchend", finish, { passive: true });
  document.addEventListener("touchcancel", cancel, { passive: true });
})();

/* ==========================================================
   Snackbar, bottom sheet e diálogos (Material 3)
   ========================================================== */
let toastTimer = null;

function showToast(message) {
  let bar = $("snackbar");

  if (!bar) {
    bar = el("div", "snackbar");
    bar.id = "snackbar";
    document.body.appendChild(bar);
  }

  bar.textContent = message;
  void bar.offsetWidth;
  bar.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => bar.classList.remove("show"), 2600);
}

let activeSheet = null;
let activeDialog = null;
let modalTitleSerial = 0;

function activeModalElement() {
  if (activeDialog) return activeDialog.dlg;
  if (activeSheet) return activeSheet.sheet;
  if (settingsOpen) return settingsEl;
  return fpOpen ? $("fullPlayer") : null;
}

document.addEventListener("keydown", e => {
  const modal = activeModalElement();
  if (!modal) return;

  if (e.key === "Escape") {
    e.preventDefault();
    if (activeDialog) activeDialog.done(null);
    else if (activeSheet) closeSheet();
    else if (settingsOpen) closeSettings();
    else if (fpOpen) closeFullPlayer();
    return;
  }

  if (e.key !== "Tab") return;
  const focusable = Array.from(modal.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  )).filter(node => node.getAttribute("aria-hidden") !== "true" && node.getClientRects().length);
  if (!focusable.length) {
    e.preventDefault();
    modal.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

function closeSheet() {
  if (!activeSheet) return;
  const { scrim, sheet, returnFocus } = activeSheet;
  activeSheet = null;

  scrim.classList.remove("show");
  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  setTimeout(() => {
    scrim.remove();
    sheet.remove();
  }, 260);
}

function presentSheet(scrim, sheet, returnFocus) {
  const title = sheet.querySelector("h3");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("tabindex", "-1");
  if (title) {
    title.id = "sheet-title-" + (++modalTitleSerial);
    sheet.setAttribute("aria-labelledby", title.id);
  } else {
    sheet.setAttribute("aria-label", "Opções");
  }
  scrim.setAttribute("aria-hidden", "true");
  document.body.append(scrim, sheet);
  activeSheet = { scrim, sheet, returnFocus };

  requestAnimationFrame(() => {
    scrim.classList.add("show");
    sheet.classList.add("show");
    const first = sheet.querySelector('button:not([disabled]), input:not([disabled])');
    (first || sheet).focus();
  });
}

function openSheet(title, actions) {
  const returnFocus = activeSheet ? activeSheet.returnFocus : document.activeElement;
  closeSheet();

  const scrim = el("div", "scrim");
  const sheet = el("div", "sheet");
  sheet.appendChild(el("div", "sheet-handle"));
  if (title) sheet.appendChild(el("h3", "", title));

  actions.forEach(a => {
    const btn = el("button", "sheet-item" + (a.danger ? " danger" : ""));
    btn.appendChild(el("span", "material-symbols-rounded", a.icon));
    btn.appendChild(el("span", "", a.label));
    btn.onclick = () => {
      closeSheet();
      a.run();
    };
    sheet.appendChild(btn);
  });

  scrim.onclick = closeSheet;
  presentSheet(scrim, sheet, returnFocus);
}

function showDialog({ title, text, input, confirmLabel = "OK", danger = false }) {
  return new Promise(resolve => {
    const returnFocus = document.activeElement;
    const scrim = el("div", "scrim");
    const dlg = el("div", "dialog");
    const heading = el("h3", "", title);
    heading.id = "dialog-title-" + (++modalTitleSerial);
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-labelledby", heading.id);
    dlg.setAttribute("tabindex", "-1");
    scrim.setAttribute("aria-hidden", "true");
    dlg.appendChild(heading);
    if (text) dlg.appendChild(el("p", "", text));

    let field = null;
    if (input) {
      field = el("input", "dialog-input");
      field.type = "text";
      field.value = input.value || "";
      field.placeholder = input.placeholder || "";
      field.maxLength = 40;
      dlg.appendChild(field);
    }

    const actions = el("div", "dialog-actions");
    const cancel = el("button", "text-btn", "Cancelar");
    const ok = el("button", "text-btn" + (danger ? " danger" : ""), confirmLabel);
    actions.append(cancel, ok);
    dlg.appendChild(actions);

    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      if (activeDialog && activeDialog.dlg === dlg) activeDialog = null;
      scrim.classList.remove("show");
      dlg.classList.remove("show");
      dlg.setAttribute("aria-hidden", "true");
      setTimeout(() => {
        scrim.remove();
        dlg.remove();
        if (returnFocus && returnFocus.isConnected) returnFocus.focus();
      }, 260);
      resolve(value);
    };

    cancel.onclick = () => done(null);
    scrim.onclick = () => done(null);
    ok.onclick = () => done(field ? field.value.trim() : true);

    if (field) {
      field.addEventListener("keydown", e => {
        if (e.key === "Enter") ok.click();
      });
    }

    document.body.append(scrim, dlg);
    activeDialog = { dlg, done, returnFocus };

    requestAnimationFrame(() => {
      scrim.classList.add("show");
      dlg.classList.add("show");
      if (field) field.focus();
      else ok.focus();
    });
  });
}
