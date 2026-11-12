package br.com.gustavoeude.reprodutormusical;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.CornerPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.os.SystemClock;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widgets da tela inicial (A: 4x1, B: 4x2, C: 2x2).
 * O estado fica em SharedPreferences; quem toca (player nativo ou serviço antigo) chama publish().
 */
final class NyxWidgets {
    static final String PREFS = "nyx_widget";
    static final String ACT_PREV = "br.com.gustavoeude.reprodutormusical.WIDGET_PREV";
    static final String ACT_TOGGLE = "br.com.gustavoeude.reprodutormusical.WIDGET_TOGGLE";
    static final String ACT_NEXT = "br.com.gustavoeude.reprodutormusical.WIDGET_NEXT";
    static final String ACT_FAV = "br.com.gustavoeude.reprodutormusical.WIDGET_FAV";

    private static long lastRefreshAt = 0;
    private static String lastKey = "";
    private static String cachedCoverPath = null;
    private static Bitmap cachedCookie = null;
    private static Bitmap cachedSquare = null;

    private NyxWidgets() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static Class<?>[] providers() {
        return new Class<?>[] { NyxWidgetA.class, NyxWidgetB.class, NyxWidgetC.class };
    }

    /** Há algum widget do Nyx na tela? Se não, não gasta nada. */
    static boolean hasWidgets(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            for (Class<?> p : providers()) {
                if (m.getAppWidgetIds(new ComponentName(c, p)).length > 0) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    /** Guarda o que está tocando e redesenha os widgets (limita a frequência quando só a posição muda). */
    static void publish(Context c, String id, String title, String artist, String coverPath,
                        boolean playing, long positionMs, long durationMs) {
        try {
            String key = (id == null ? "" : id) + "|" + title + "|" + playing + "|" + coverPath;
            long now = SystemClock.elapsedRealtime();
            if (key.equals(lastKey) && now - lastRefreshAt < 5000) return; // só a posição mudou
            Context app = c.getApplicationContext();
            if (!hasWidgets(app)) { lastKey = key; lastRefreshAt = now; return; }
            SharedPreferences p = prefs(app);
            String oldId = p.getString("id", "");
            SharedPreferences.Editor e = p.edit();
            if (id != null && !id.isEmpty() && !id.equals(oldId)) {
                e.putString("id", id);
                e.putBoolean("favorite", false); // o app diz o valor certo logo em seguida
            }
            if (title != null) e.putString("title", title);
            if (artist != null) e.putString("artist", artist);
            if (coverPath != null) e.putString("cover", coverPath);
            e.putBoolean("playing", playing).putLong("pos", Math.max(0L, positionMs)).putLong("dur", Math.max(0L, durationMs));
            e.apply();
            lastKey = key;
            refresh(app);
        } catch (Exception ignored) {}
    }

    /** O player foi encerrado: o botão do widget volta a mostrar "tocar". */
    static void markStopped(Context c) {
        try {
            Context app = c.getApplicationContext();
            prefs(app).edit().putBoolean("playing", false).apply();
            lastKey = "";
            if (hasWidgets(app)) refresh(app);
        } catch (Exception ignored) {}
    }

    /** O app informou a música atual e se ela é favorita (para o coração do widget). */
    static void setInfo(Context c, String id, boolean favorite) {
        try {
            Context app = c.getApplicationContext();
            prefs(app).edit().putString("id", id == null ? "" : id).putBoolean("favorite", favorite).apply();
            if (hasWidgets(app)) refresh(app);
        } catch (Exception ignored) {}
    }

    /** Favoritos pedidos pelo widget que o app ainda não aplicou (id -> favorito). */
    static JSONArray takePendingFavorites(Context c) {
        SharedPreferences p = prefs(c);
        JSONArray out = new JSONArray();
        try {
            JSONObject o = new JSONObject(p.getString("favPending", "{}"));
            java.util.Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                JSONObject row = new JSONObject();
                row.put("id", k);
                row.put("favorite", o.optBoolean(k));
                out.put(row);
            }
            p.edit().remove("favPending").apply();
        } catch (Exception ignored) {}
        return out;
    }

    static void toggleFavorite(Context c) {
        try {
            SharedPreferences p = prefs(c);
            String id = p.getString("id", "");
            if (id.isEmpty()) { openApp(c); return; }
            boolean next = !p.getBoolean("favorite", false);
            JSONObject o = new JSONObject(p.getString("favPending", "{}"));
            o.put(id, next);
            p.edit().putBoolean("favorite", next).putString("favPending", o.toString()).apply();
            refresh(c);
            // se o app estiver vivo, ele aplica na hora; senão aplica quando abrir
            MusicaPlaybackService.EventSink k = MusicaPlaybackService.sink;
            if (k != null) {
                com.getcapacitor.JSObject ev = new com.getcapacitor.JSObject();
                ev.put("ts", System.currentTimeMillis());
                k.emit("widgetfav", ev);
            }
        } catch (Exception ignored) {}
    }

    static void openApp(Context c) {
        try {
            Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
            if (i == null) return;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            c.startActivity(i);
        } catch (Exception ignored) {}
    }

    /** Botões: com o player vivo controla direto; senão abre o app. */
    static void handleAction(Context c, String action) {
        if (ACT_FAV.equals(action)) { toggleFavorite(c); return; }
        String what = ACT_PREV.equals(action) ? "prev" : ACT_NEXT.equals(action) ? "next" : "toggle";
        MusicaPlaybackService svc = MusicaPlaybackService.instance;
        if (svc != null) {
            MusicaPlaybackService.MAIN.post(() -> svc.widgetControl(what));
            return;
        }
        MusicaService legacy = MusicaService.instance;
        if (legacy != null) {
            String act = "prev".equals(what) ? MusicaService.ACT_PREV
                    : "next".equals(what) ? MusicaService.ACT_NEXT
                    : (prefs(c).getBoolean("playing", false) ? MusicaService.ACT_PAUSE : MusicaService.ACT_PLAY);
            try { c.startService(new Intent(c, MusicaService.class).setAction(act)); } catch (Exception ignored) { openApp(c); }
            return;
        }
        openApp(c);
    }

    // ---------- desenho ----------
    static void refresh(Context c) {
        try {
            Context app = c.getApplicationContext();
            AppWidgetManager m = AppWidgetManager.getInstance(app);
            lastRefreshAt = SystemClock.elapsedRealtime();
            SharedPreferences p = prefs(app);
            update(app, m, NyxWidgetA.class, R.layout.widget_a, p, false);
            update(app, m, NyxWidgetB.class, R.layout.widget_b, p, true);
            update(app, m, NyxWidgetC.class, R.layout.widget_c, p, false);
        } catch (Exception ignored) {}
    }

    private static void update(Context c, AppWidgetManager m, Class<?> cls, int layout, SharedPreferences p, boolean full) {
        int[] ids = m.getAppWidgetIds(new ComponentName(c, cls));
        if (ids.length == 0) return;
        boolean isC = layout == R.layout.widget_c;

        String title = p.getString("title", "");
        String artist = p.getString("artist", "");
        boolean has = !title.isEmpty();
        boolean playing = p.getBoolean("playing", false);

        RemoteViews v = new RemoteViews(c.getPackageName(), layout);
        v.setTextViewText(R.id.w_title, has ? title : "Nyx");
        v.setTextViewText(R.id.w_artist, has ? artist : "Toque para abrir");
        v.setImageViewResource(R.id.w_play, playing ? R.drawable.ic_w_pause : R.drawable.ic_w_play);

        Bitmap cover = loadCover(p.getString("cover", ""), isC);
        if (cover != null) v.setImageViewBitmap(R.id.w_cover, cover);
        else v.setImageViewResource(R.id.w_cover, R.mipmap.ic_launcher);

        if (full) {
            long dur = p.getLong("dur", 0), pos = p.getLong("pos", 0);
            v.setProgressBar(R.id.w_progress, 1000, dur > 0 ? (int) Math.min(1000, pos * 1000 / dur) : 0, false);
            v.setImageViewResource(R.id.w_fav, p.getBoolean("favorite", false) ? R.drawable.ic_w_heart : R.drawable.ic_w_heart_border);
            v.setOnClickPendingIntent(R.id.w_fav, action(c, cls, ACT_FAV, 4));
        }
        v.setOnClickPendingIntent(R.id.w_prev, action(c, cls, ACT_PREV, 1));
        v.setOnClickPendingIntent(R.id.w_play, action(c, cls, ACT_TOGGLE, 2));
        v.setOnClickPendingIntent(R.id.w_next, action(c, cls, ACT_NEXT, 3));

        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open != null) {
            PendingIntent pi = PendingIntent.getActivity(c, 10, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            v.setOnClickPendingIntent(R.id.w_cover, pi);
            v.setOnClickPendingIntent(R.id.w_info, pi);
        }
        m.updateAppWidget(ids, v);
    }

    private static PendingIntent action(Context c, Class<?> cls, String action, int code) {
        Intent i = new Intent(c, cls).setAction(action);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ---------- capa ----------
    private static Bitmap loadCover(String path, boolean square) {
        if (path == null || path.isEmpty()) return null;
        try {
            if (!path.equals(cachedCoverPath)) {
                cachedCoverPath = path;
                cachedCookie = null;
                cachedSquare = null;
            }
            Bitmap hit = square ? cachedSquare : cachedCookie;
            if (hit != null) return hit;

            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, o);
            int target = square ? 400 : 300;
            int sample = 1;
            while (o.outWidth / (sample * 2) >= target && o.outHeight / (sample * 2) >= target) sample *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            Bitmap src = BitmapFactory.decodeFile(path, o);
            if (src == null) return null;

            Bitmap out = square ? roundedSquare(src, target) : cookie(src, target);
            if (out != src) src.recycle();
            if (square) cachedSquare = out; else cachedCookie = out;
            return out;
        } catch (Throwable t) {
            return null;
        }
    }

    private static Bitmap centerCrop(Bitmap src, int size) {
        Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        float s = Math.max(size / (float) src.getWidth(), size / (float) src.getHeight());
        float w = src.getWidth() * s, h = src.getHeight() * s;
        cv.drawBitmap(src, null, new RectF((size - w) / 2f, (size - h) / 2f, (size + w) / 2f, (size + h) / 2f),
                new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG));
        return b;
    }

    private static Bitmap mask(Bitmap src, int size, Path shape) {
        Bitmap base = centerCrop(src, size);
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        cv.drawPath(shape, p);
        p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        cv.drawBitmap(base, 0, 0, p);
        base.recycle();
        return out;
    }

    /** Capa em "biscoito" (a mesma ideia das formas do app). */
    private static Bitmap cookie(Bitmap src, int size) {
        Path path = new Path();
        int n = 12;
        float cx = size / 2f, r1 = size / 2f, r2 = size / 2f * 0.9f;
        for (int i = 0; i < n * 2; i++) {
            double a = Math.PI * i / n - Math.PI / 2;
            float r = i % 2 == 0 ? r1 : r2;
            float x = cx + (float) Math.cos(a) * r, y = cx + (float) Math.sin(a) * r;
            if (i == 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        path.close();
        Paint dummy = new Paint();
        dummy.setPathEffect(new CornerPathEffect(size * 0.06f));
        Path smooth = new Path();
        dummy.getFillPath(path, smooth);
        return mask(src, size, smooth);
    }

    /** Capa quadrada de cantos arredondados (widget C, a capa cobre o widget inteiro). */
    private static Bitmap roundedSquare(Bitmap src, int size) {
        Path path = new Path();
        path.addRoundRect(new RectF(0, 0, size, size), size * 0.14f, size * 0.14f, Path.Direction.CW);
        return mask(src, size, path);
    }
}
