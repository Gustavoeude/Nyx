"use strict";

/* ==========================================================
   Widgets da tela inicial (Android): o coração do widget e a
   música atual são sincronizados com o app por aqui.
   ========================================================== */
const widgetsOn = !!(MN && MN.widgetInfo && MN.takeWidgetFavorites);

// diz ao widget qual é a música atual e se ela é favorita
function widgetSyncInfo() {
  if (!widgetsOn) return;
  const s = typeof current === "function" ? current() : null;
  if (!s) return;
  try {
    const r = MN.widgetInfo({ id: String(s.id), favorite: !!s.favorite });
    if (r && r.catch) r.catch(() => {}); // APK antigo sem o método
  } catch (e) { logErr("widget:info", e); }
}

// aplica no app os favoritos que você tocou no widget (guarda o estado desejado, não "alternar")
let widgetFavBusy = false;
async function applyWidgetFavorites() {
  if (!widgetsOn || widgetFavBusy || !songs.length) return;
  widgetFavBusy = true;
  try {
    const r = await MN.takeWidgetFavorites();
    let changed = false;
    ((r && r.items) || []).forEach(it => {
      const song = songs.find(s => String(s.id) === String(it.id));
      if (song && !!song.favorite !== !!it.favorite) {
        song.favorite = !!it.favorite;
        dbPut(toRecord(song));
        changed = true;
      }
    });
    if (changed) {
      renderAll();
      updateHome();
      if (currentId !== null) updateFullPlayer();
    }
  } catch (e) {
    logErr("widget:favoritos", e);
  } finally {
    widgetFavBusy = false;
  }
}

if (widgetsOn) {
  MN.addListener("widgetfav", () => applyWidgetFavorites());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { applyWidgetFavorites(); widgetSyncInfo(); }
  });
}
