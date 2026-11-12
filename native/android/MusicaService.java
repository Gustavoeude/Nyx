package br.com.gustavoeude.reprodutormusical;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Base64;

/**
 * Serviço em primeiro plano: mantém o app vivo com a tela bloqueada, mostra a
 * notificação de mídia (anterior / tocar-pausar / próxima) e a tela de bloqueio.
 * O áudio em si continua sendo tocado pelo WebView; este serviço só o mantém
 * ativo e repassa os botões para o JavaScript.
 */
public class MusicaService extends Service {
    public interface Listener {
        void onAction(String action, long positionMs);
    }

    static final String CHANNEL = "musica_reproducao";
    static final int NOTIF_ID = 4711;
    static final String ACT_UPDATE = "br.com.gustavoeude.reprodutormusical.UPDATE";
    static final String ACT_PLAY = "br.com.gustavoeude.reprodutormusical.PLAY";
    static final String ACT_PAUSE = "br.com.gustavoeude.reprodutormusical.PAUSE";
    static final String ACT_NEXT = "br.com.gustavoeude.reprodutormusical.NEXT";
    static final String ACT_PREV = "br.com.gustavoeude.reprodutormusical.PREV";

    static volatile MusicaService instance;
    static volatile Listener listener;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private boolean startedForeground = false;

    private String title = "Música";
    private String artist = "";
    private Bitmap cover = null;
    private boolean playing = false;
    private long positionMs = 0;
    private long durationMs = 0;
    private float rate = 1f;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Reprodução de música", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        session = new MediaSession(this, "Musica");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { dispatch("play", -1); }
            @Override public void onPause() { dispatch("pause", -1); }
            @Override public void onSkipToNext() { dispatch("next", -1); }
            @Override public void onSkipToPrevious() { dispatch("previous", -1); }
            @Override public void onStop() { dispatch("pause", -1); }
            @Override public void onSeekTo(long pos) { dispatch("seek", pos); }
        });
        session.setActive(true);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Musica:reproducao");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACT_UPDATE.equals(action)) {
            apply(intent);
        } else if (ACT_PLAY.equals(action)) {
            dispatch("play", -1);
        } else if (ACT_PAUSE.equals(action)) {
            dispatch("pause", -1);
        } else if (ACT_NEXT.equals(action)) {
            dispatch("next", -1);
        } else if (ACT_PREV.equals(action)) {
            dispatch("previous", -1);
        }

        // Obrigatório: quem chamou startForegroundService precisa de startForeground rápido.
        if (!startedForeground) refresh();
        return START_NOT_STICKY;
    }

    /** Atualiza título, estado e posição (vem do JavaScript). */
    void apply(Intent i) {
        if (i.hasExtra("title")) title = nonEmpty(i.getStringExtra("title"), "Música");
        if (i.hasExtra("artist")) artist = nonEmpty(i.getStringExtra("artist"), "");
        if (i.hasExtra("playing")) playing = i.getBooleanExtra("playing", false);
        if (i.hasExtra("position")) positionMs = (long) (i.getDoubleExtra("position", 0) * 1000);
        if (i.hasExtra("duration")) durationMs = (long) (i.getDoubleExtra("duration", 0) * 1000);
        if (i.hasExtra("rate")) rate = (float) i.getDoubleExtra("rate", 1);
        if (i.hasExtra("cover")) {
            cover = decodeCover(i.getStringExtra("cover"));
            widgetCoverPath = saveWidgetCover(cover);
        }
        NyxWidgets.publish(this, null, title, artist, widgetCoverPath, playing, positionMs, durationMs);
        main.post(this::refresh);
    }

    private String widgetCoverPath = "";
    private int widgetCoverCount = 0;

    /** Guarda a capa em arquivo para os widgets da tela inicial. */
    private String saveWidgetCover(Bitmap b) {
        if (b == null) return "";
        try {
            widgetCoverCount++;
            java.io.File f = new java.io.File(getCacheDir(), "widget_cover_" + (widgetCoverCount % 2) + ".jpg"); // nome muda para o widget notar a troca
            try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) {
                b.compress(Bitmap.CompressFormat.JPEG, 88, o);
            }
            return f.getAbsolutePath();
        } catch (Exception e) {
            return "";
        }
    }

    private static String nonEmpty(String s, String fallback) {
        return s == null || s.trim().isEmpty() ? fallback : s;
    }

    private Bitmap decodeCover(String b64) {
        if (b64 == null || b64.isEmpty()) return null;
        try {
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(raw, 0, raw.length);
        } catch (Exception e) {
            return null;
        }
    }

    private void dispatch(String action, long pos) {
        Listener l = listener;
        if (l != null) {
            try { l.onAction(action, pos); } catch (Exception ignored) {}
        }
    }

    private PendingIntent button(String action, int code) {
        Intent i = new Intent(this, MusicaService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Action action(int icon, String label, String act, int code) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, button(act, code)).build();
    }

    private void refresh() {
        // sessão de mídia (tela de bloqueio / fones / Bluetooth)
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (cover != null) {
            md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover);
            md.putBitmap(MediaMetadata.METADATA_KEY_ART, cover);
            md.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, cover);
        }
        session.setMetadata(md.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        positionMs, playing ? rate : 0f, SystemClock.elapsedRealtime())
                .build());

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notification_music)
                .setContentTitle(title)
                .setContentText(artist)
                .setLargeIcon(cover)
                .setOngoing(playing)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(action(android.R.drawable.ic_media_previous, "Anterior", ACT_PREV, 1))
                .addAction(playing
                        ? action(android.R.drawable.ic_media_pause, "Pausar", ACT_PAUSE, 2)
                        : action(android.R.drawable.ic_media_play, "Tocar", ACT_PLAY, 3))
                .addAction(action(android.R.drawable.ic_media_next, "Próxima", ACT_NEXT, 4))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
            b.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        Notification n = b.build();

        if (playing || !startedForeground) {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIF_ID, n);
            }
            startedForeground = true;
        } else {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, n);
        }

        if (!playing && Build.VERSION.SDK_INT >= 24) {
            // pausado: a notificação pode ser dispensada com um deslize
            stopForeground(Service.STOP_FOREGROUND_DETACH);
            startedForeground = false;
        }

        if (wakeLock != null) {
            if (playing && !wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
            if (!playing && wakeLock.isHeld()) wakeLock.release();
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // app removido dos recentes: pausa o áudio e encerra o serviço
        dispatch("pause", -1);
        main.postDelayed(this::stopSelf, 300);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        try { session.setActive(false); session.release(); } catch (Exception ignored) {}
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
