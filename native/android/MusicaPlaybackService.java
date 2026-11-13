package br.com.gustavoeude.reprodutormusical;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.net.Uri;
import android.util.LruCache;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.BitmapLoader;
import androidx.media3.datasource.DataSourceBitmapLoader;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaNotification;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Player de áudio nativo (Media3/ExoPlayer) que toca sem depender do WebView.
 *
 * Regras de segurança:
 *  - TODO acesso ao ExoPlayer acontece na thread principal (run() reposta tudo);
 *  - existe um único serviço de mídia;
 *  - qualquer exceção é capturada e vira um evento "state" com erro, nunca derruba o app.
 */
public class MusicaPlaybackService extends MediaSessionService {
    public interface EventSink {
        void emit(String name, JSObject data);
    }

    static final Handler MAIN = new Handler(Looper.getMainLooper());
    static volatile MusicaPlaybackService instance;
    static volatile EventSink sink;
    private static final List<PendingCommand> PENDING = new ArrayList<>();

    private static final class PendingCommand {
        final Consumer<MusicaPlaybackService> command;
        final Consumer<Exception> onError;

        PendingCommand(Consumer<MusicaPlaybackService> command, Consumer<Exception> onError) {
            this.command = command;
            this.onError = onError;
        }

        void reject(Exception error) {
            if (onError != null) onError.accept(error);
        }
    }

    /** Tempo que o player espera o JavaScript responder a um "próxima/anterior" ou ao fim da faixa. */
    private static final long STUCK_FALLBACK_MS = 4000;

    private static final String AUDIO_PREFS = "nyx_audio";
    /** Pontos de controle do equalizador do app (Hz); o Android tem bandas diferentes por aparelho. */
    static final int[] EQ_POINTS_HZ = {60, 230, 910, 3600, 14000};
    static final int EQ_LIMIT_MB = 1200; // ±12 dB

    private ExoPlayer player;

    // equalizador e transição suave (valores guardados no aparelho: valem mesmo com o app fechado)
    private Equalizer eq;
    private BassBoost bass;
    private int effectsSession = -1;
    private boolean eqOn = false;
    private int[] eqLevels = new int[EQ_POINTS_HZ.length]; // milibels nos 5 pontos de EQ_POINTS_HZ
    private int bassStrength = 0;          // 0..1000
    private int fadeMs = 0;                // 0 = desligado

    // temporizador de desligar
    private Runnable sleepRunnable;
    private long sleepEndAt = 0;           // elapsedRealtime em que pausa (0 = sem temporizador por tempo)
    private boolean sleepEndOfTrack = false;

    /** true só quando o app avisou que a lista realmente termina na fila nativa (sem repetir). */
    private boolean listEnds = false;
    private MediaSession session;
    private PrefetchingBitmapLoader artworkBitmapLoader;

    private final Runnable fader = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            updateFade();
            if (fadeMs > 0 && player.isPlaying()) MAIN.postDelayed(this, 120);
        }
    };

    private long lastSavedAt = 0;

    /** Guarda a música e a posição atuais: o app lê isso ao abrir, mesmo se o Android o fechou. */
    private void saveLast() {
        try {
            if (player == null) return;
            MediaItem it = player.getCurrentMediaItem();
            if (it == null) return;
            prefs().edit()
                    .putString("lastId", it.mediaId)
                    .putLong("lastPos", Math.max(0L, player.getCurrentPosition()))
                    .apply();
            lastSavedAt = SystemClock.elapsedRealtime();
        } catch (Exception ignored) {}
    }

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            emitState(null);
            if (SystemClock.elapsedRealtime() - lastSavedAt > 10000) saveLast();
            if (player != null && player.isPlaying()) MAIN.postDelayed(this, 500);
        }
    };

    /** Executa um comando no player, sempre na thread principal. Inicia o serviço se preciso. */
    static void run(Context ctx, Consumer<MusicaPlaybackService> cmd, Consumer<Exception> onError) {
        PendingCommand pending = new PendingCommand(cmd, onError);
        MusicaPlaybackService s = instance;
        if (s != null) {
            MusicaPlaybackService ready = s;
            MAIN.post(() -> safe(ready, pending));
            return;
        }
        synchronized (PENDING) {
            s = instance;
            if (s == null) PENDING.add(pending);
        }
        if (s != null) {
            MusicaPlaybackService ready = s;
            MAIN.post(() -> safe(ready, pending));
            return;
        }
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, MusicaPlaybackService.class));
        } catch (Exception e) {
            List<PendingCommand> failed;
            synchronized (PENDING) {
                failed = new ArrayList<>(PENDING);
                PENDING.clear();
            }
            for (PendingCommand command : failed) command.reject(e);
            EventSink k = sink;
            if (k != null) {
                JSObject o = new JSObject();
                o.put("error", "Não consegui iniciar o serviço de áudio: " + e.getMessage());
                k.emit("state", o);
            }
        }
    }

    private static void safe(MusicaPlaybackService s, PendingCommand pending) {
        try {
            pending.command.accept(s);
        } catch (Exception e) {
            s.emitState("Erro no player: " + e.getMessage());
            pending.reject(e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        installNotificationProvider();
        artworkBitmapLoader = new PrefetchingBitmapLoader(
                new DataSourceBitmapLoader.Builder(this).build());
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_LOCAL)
                .build();
        loadAudioPrefs();
        attachEffects();

        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean isPlaying) {
                emitState(null);
                if (!isPlaying) saveLast();
                MAIN.removeCallbacks(ticker);
                if (isPlaying) MAIN.post(ticker);
                MAIN.removeCallbacks(fader);
                if (isPlaying && fadeMs > 0) MAIN.post(fader);
            }
            @Override public void onAudioSessionIdChanged(int audioSessionId) { attachEffects(); }
            @Override public void onPlaybackStateChanged(int state) {
                emitState(null);
                if (state == Player.STATE_ENDED && !listEnds) armEndedFallback();
            }
            @Override public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                emitState(null);
                // "parar no fim da faixa": o player pausa sozinho ao terminar a música atual
                if (sleepEndOfTrack && !playWhenReady
                        && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    cancelSleep();
                    emitSleep(true);
                }
            }
            @Override public void onPlayerError(PlaybackException error) {
                emitState("Não foi possível tocar esta música (" + error.getErrorCodeName() + ")");
            }
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                EventSink k = sink;
                if (k != null && item != null) {
                    JSObject o = new JSObject();
                    o.put("id", item.mediaId);
                    o.put("reason", reason);
                    o.put("ts", System.currentTimeMillis()); // o app descarta eventos velhos (app congelado)
                    k.emit("transition", o);
                }
                saveLast();
                emitState(null);
            }
        });

        final SessionCommand closeCmd = new SessionCommand("musica.fechar", Bundle.EMPTY);
        MediaSession.Builder b = new MediaSession.Builder(this, new Wrapper(player))
                .setId("musica")
                .setBitmapLoader(artworkBitmapLoader);
        b.setCallback(new MediaSession.Callback() {
            @Override
            public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo controller) {
                SessionCommands cmds = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                        .buildUpon().add(closeCmd).build();
                return new MediaSession.ConnectionResult.AcceptedResultBuilder(s)
                        .setAvailableSessionCommands(cmds)
                        .build();
            }

            @Override
            public ListenableFuture<SessionResult> onCustomCommand(MediaSession s, MediaSession.ControllerInfo controller,
                                                                   SessionCommand cmd, Bundle args) {
                if ("musica.fechar".equals(cmd.customAction)) {
                    closeFromNotification();
                    return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                }
                return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED));
            }
        });
        int closeIcon = getResources().getIdentifier("ic_fechar", "drawable", getPackageName());
        if (closeIcon != 0) {
            b.setMediaButtonPreferences(ImmutableList.of(
                    new CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                            .setCustomIconResId(closeIcon)
                            .setDisplayName("Fechar")
                            .setSessionCommand(closeCmd)
                            .build()));
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
            b.setSessionActivity(PendingIntent.getActivity(this, 0, open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        session = b.build();
        // registra a sessão no serviço: sem isso o Media3 não vira serviço em primeiro plano
        // nem mostra a notificação enquanto nenhum controlador estiver conectado
        addSession(session);

        instance = this;
        List<PendingCommand> todo;
        synchronized (PENDING) {
            todo = new ArrayList<>(PENDING);
            PENDING.clear();
        }
        for (PendingCommand c : todo) safe(this, c);
    }

    private void installNotificationProvider() {
        DefaultMediaNotificationProvider defaultProvider =
                new DefaultMediaNotificationProvider.Builder(this).build();
        setMediaNotificationProvider(new MediaNotification.Provider() {
            @Override
            public MediaNotification createNotification(
                    MediaSession mediaSession,
                    ImmutableList<CommandButton> mediaButtonPreferences,
                    MediaNotification.ActionFactory actionFactory,
                    MediaNotification.Provider.Callback callback) {
                MediaNotification original = defaultProvider.createNotification(
                        mediaSession, mediaButtonPreferences, actionFactory, callback);
                if (Build.VERSION.SDK_INT < 24) return original;
                Notification customized = Notification.Builder.recoverBuilder(
                                MusicaPlaybackService.this, original.notification)
                        .setSmallIcon(R.drawable.ic_notification_music)
                        .build();
                return new MediaNotification(original.notificationId, customized);
            }

            @Override
            public MediaNotification.Provider.NotificationChannelInfo getNotificationChannelInfo() {
                return defaultProvider.getNotificationChannelInfo();
            }

            @Override
            public boolean handleCustomCommand(MediaSession mediaSession, String action, Bundle extras) {
                return defaultProvider.handleCustomCommand(mediaSession, action, extras);
            }
        });
    }

    /** Faz os botões "anterior/próxima" da notificação funcionarem com a fila gerida pelo app. */
    private class Wrapper extends ForwardingPlayer {
        Wrapper(Player p) { super(p); }

        @Override public Commands getAvailableCommands() {
            return super.getAvailableCommands().buildUpon()
                    .addAll(COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_PREVIOUS,
                            COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build();
        }

        @Override public boolean isCommandAvailable(int command) {
            if (command == COMMAND_SEEK_TO_NEXT || command == COMMAND_SEEK_TO_PREVIOUS
                    || command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM || command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                return true;
            }
            return super.isCommandAvailable(command);
        }

        private void goNext() {
            if (super.hasNextMediaItem()) {
                super.seekToNextMediaItem();
            } else {
                action("next");
                armStuckFallback(true);
            }
        }

        private void goPrevious() {
            if (getCurrentPosition() > 3000) {
                seekTo(0);
            } else if (super.hasPreviousMediaItem()) {
                super.seekToPreviousMediaItem();
            } else {
                action("previous");
                armStuckFallback(false);
            }
        }

        @Override public void seekToNext() { goNext(); }
        @Override public void seekToNextMediaItem() { goNext(); }
        @Override public void seekToPrevious() { goPrevious(); }
        @Override public void seekToPreviousMediaItem() { goPrevious(); }
    }

    private void action(String name) {
        EventSink k = sink;
        if (k != null) {
            JSObject o = new JSObject();
            o.put("action", name);
            o.put("ts", System.currentTimeMillis()); // evita que toques antigos sejam repetidos ao reabrir o app
            k.emit("action", o);
        }
    }

    /**
     * Se o JavaScript estiver congelado (app em segundo plano), o "próxima/anterior" enviado a ele
     * se perderia e o botão pareceria travado. Se nada mudou depois de um tempo, o próprio player
     * dá a volta na fila nativa.
     */
    private void armStuckFallback(boolean forward) {
        if (player == null) return;
        MediaItem before = player.getCurrentMediaItem();
        final String id = before == null ? "" : before.mediaId;
        MAIN.postDelayed(() -> {
            if (player == null) return;
            MediaItem cur = player.getCurrentMediaItem();
            if (cur == null || !cur.mediaId.equals(id)) return; // o app respondeu
            int n = player.getMediaItemCount();
            if (n == 0) return;
            player.seekTo(forward ? 0 : n - 1, 0L);
            resumeAfterWrap();
        }, STUCK_FALLBACK_MS);
    }

    /** Fim da fila nativa sem o app responder: recomeça a fila em vez de ficar parado. */
    private void armEndedFallback() {
        if (player == null) return;
        MediaItem before = player.getCurrentMediaItem();
        final String id = before == null ? "" : before.mediaId;
        MAIN.postDelayed(() -> {
            if (player == null || listEnds) return;
            if (player.getPlaybackState() != Player.STATE_ENDED) return;
            MediaItem cur = player.getCurrentMediaItem();
            if (cur == null || !cur.mediaId.equals(id)) return; // o app respondeu
            player.seekTo(0, 0L);
            resumeAfterWrap();
        }, STUCK_FALLBACK_MS);
    }

    private void resumeAfterWrap() {
        if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
        player.setPlayWhenReady(true);
    }

    // ---------- comandos (sempre chamados na thread principal via run) ----------
    private static MediaItem buildItem(org.json.JSONObject o) {
        String path = o.optString("path", "");
        File f = new File(path);
        if (!f.isFile() || !f.canRead()) return null;
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .setTitle(o.optString("title", "Música"))
                .setArtist(o.optString("artist", ""));
        String cover = o.optString("cover", "");
        if (!cover.isEmpty() && new File(cover).isFile()) md.setArtworkUri(Uri.fromFile(new File(cover)));
        return new MediaItem.Builder()
                .setMediaId(o.optString("id", path))
                .setUri(Uri.fromFile(f))
                .setMediaMetadata(md.build())
                .build();
    }

    static List<MediaItem> buildItems(org.json.JSONArray arr) {
        List<MediaItem> list = new ArrayList<>();
        if (arr == null) return list;
        for (int i = 0; i < arr.length(); i++) {
            MediaItem it = buildItem(arr.optJSONObject(i));
            if (it != null) list.add(it);
        }
        return list;
    }

    private void preloadArtwork(List<MediaItem> items) {
        if (artworkBitmapLoader == null || items == null) return;
        // só as primeiras: o cache guarda poucas capas e uma fila grande expulsaria as mais próximas
        int n = Math.min(items.size(), 5);
        for (int i = 0; i < n; i++) {
            Uri artworkUri = items.get(i).mediaMetadata.artworkUri;
            if (artworkUri != null) artworkBitmapLoader.preload(artworkUri);
        }
    }

    /** Cacheia a arte dos itens enfileirados para a sessão já ter o bitmap ao trocar de faixa. */
    private static final class PrefetchingBitmapLoader implements BitmapLoader {
        private static final int CACHE_ENTRIES = 8;
        private final BitmapLoader delegate;
        private final LruCache<Uri, ListenableFuture<Bitmap>> cache = new LruCache<>(CACHE_ENTRIES);

        PrefetchingBitmapLoader(BitmapLoader delegate) {
            this.delegate = delegate;
        }

        @Override
        public boolean supportsMimeType(String mimeType) {
            return delegate.supportsMimeType(mimeType);
        }

        @Override
        public ListenableFuture<Bitmap> decodeBitmap(byte[] data) {
            return delegate.decodeBitmap(data);
        }

        @Override
        public ListenableFuture<Bitmap> loadBitmap(Uri uri) {
            final ListenableFuture<Bitmap> request;
            synchronized (cache) {
                ListenableFuture<Bitmap> cached = cache.get(uri);
                if (cached != null) return cached;
                request = delegate.loadBitmap(uri);
                cache.put(uri, request);
            }
            Futures.addCallback(request, new FutureCallback<Bitmap>() {
                @Override public void onSuccess(Bitmap bitmap) {}
                @Override public void onFailure(Throwable error) {
                    synchronized (cache) {
                        if (cache.get(uri) == request) cache.remove(uri);
                    }
                }
            }, MoreExecutors.directExecutor());
            return request;
        }

        @Nullable
        @Override
        public ListenableFuture<Bitmap> loadBitmapFromMetadata(MediaMetadata metadata) {
            return BitmapLoader.super.loadBitmapFromMetadata(metadata);
        }

        void preload(Uri uri) {
            loadBitmap(uri);
        }
    }

    void setQueue(List<MediaItem> items, boolean autoplay, long positionMs, boolean repeatOne) {
        if (items.isEmpty()) {
            throw new IllegalArgumentException("Arquivo de música não encontrado no armazenamento do app.");
        }
        player.setRepeatMode(repeatOne ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
        listEnds = false;
        preloadArtwork(items);
        player.setMediaItems(items, 0, Math.max(0L, positionMs));
        player.prepare();
        player.setPlayWhenReady(autoplay);
        emitState(null);
    }

    /**
     * @param loop true quando a lista do app continua além da fila nativa: a fila gira em círculo,
     *             então nunca fica sem próxima música enquanto o app está congelado em segundo plano.
     *             false só quando a lista realmente termina (o player para no fim, como esperado).
     */
    void setUpcoming(String afterId, List<MediaItem> items, boolean repeatOne, boolean loop) {
        applyLoop(repeatOne, loop);
        MediaItem cur = player.getCurrentMediaItem();
        if (cur == null || !cur.mediaId.equals(afterId)) return; // o app se atualiza pelo evento "transition"
        int idx = player.getCurrentMediaItemIndex();
        int n = player.getMediaItemCount();
        if (n > idx + 1) player.removeMediaItems(idx + 1, n);
        // mantém as últimas 20 já tocadas: "anterior" funciona sem depender do JavaScript
        if (idx > 20) player.removeMediaItems(0, idx - 20);
        if (!items.isEmpty()) {
            preloadArtwork(items);
            player.addMediaItems(items);
        }
    }

    private void applyLoop(boolean repeatOne, boolean loop) {
        player.setRepeatMode(repeatOne ? Player.REPEAT_MODE_ONE
                : loop ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF);
        listEnds = !repeatOne && !loop;
    }

    /** Ids das músicas que já estão na fila nativa depois da atual (o app só envia as que faltam). */
    JSObject queueObject() {
        JSObject o = new JSObject();
        JSArray ids = new JSArray();
        MediaItem cur = player.getCurrentMediaItem();
        o.put("id", cur == null ? "" : cur.mediaId);
        int idx = player.getCurrentMediaItemIndex();
        int n = player.getMediaItemCount();
        for (int i = idx + 1; i < n; i++) ids.put(player.getMediaItemAt(i).mediaId);
        o.put("ids", ids);
        return o;
    }

    /** Mantém só as primeiras "keep" músicas depois da atual; o resto é reenviado em seguida. */
    void cutUpcoming(String afterId, int keep, boolean repeatOne, boolean loop) {
        applyLoop(repeatOne, loop);
        MediaItem cur = player.getCurrentMediaItem();
        if (cur == null || !cur.mediaId.equals(afterId)) return;
        int idx = player.getCurrentMediaItemIndex();
        int n = player.getMediaItemCount();
        int from = idx + 1 + Math.max(0, keep);
        if (n > from) player.removeMediaItems(from, n);
        if (idx > 20) player.removeMediaItems(0, idx - 20);
    }

    /** Acrescenta uma música ao fim da fila, só se o fim da fila ainda for a música esperada. */
    void appendUpcoming(String prevId, List<MediaItem> items, boolean loop) {
        if (items.isEmpty()) return;
        int n = player.getMediaItemCount();
        if (n == 0) return;
        if (!player.getMediaItemAt(n - 1).mediaId.equals(prevId)) return;
        if (n - player.getCurrentMediaItemIndex() <= 6) preloadArtwork(items);
        player.addMediaItems(items);
        if (loop && player.getRepeatMode() == Player.REPEAT_MODE_OFF) player.setRepeatMode(Player.REPEAT_MODE_ALL);
    }

    // ---------- preferências de áudio (equalizador, transição suave) ----------
    private SharedPreferences prefs() {
        return getSharedPreferences(AUDIO_PREFS, MODE_PRIVATE);
    }

    private void loadAudioPrefs() {
        SharedPreferences p = prefs();
        eqOn = p.getBoolean("eqOn", false);
        bassStrength = Math.max(0, Math.min(1000, p.getInt("bass", 0)));
        fadeMs = Math.max(0, Math.min(12000, p.getInt("fadeMs", 0)));
        eqLevels = parseLevels(p.getString("eqLevels", ""));
    }

    static int[] parseLevels(String csv) {
        int[] out = new int[EQ_POINTS_HZ.length];
        if (csv == null || csv.trim().isEmpty()) return out;
        String[] parts = csv.split(",");
        for (int i = 0; i < out.length && i < parts.length; i++) {
            try { out[i] = Integer.parseInt(parts[i].trim()); } catch (NumberFormatException e) { out[i] = 0; }
            out[i] = Math.max(-EQ_LIMIT_MB, Math.min(EQ_LIMIT_MB, out[i]));
        }
        return out;
    }

    static String joinLevels(int[] levels) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < EQ_POINTS_HZ.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(levels != null && i < levels.length ? levels[i] : 0);
        }
        return sb.toString();
    }

    /** Grava as preferências sem precisar do serviço (vale na próxima vez que o player abrir). */
    static void storeEffects(Context c, boolean enabled, int[] levels, int bassValue) {
        c.getSharedPreferences(AUDIO_PREFS, MODE_PRIVATE).edit()
                .putBoolean("eqOn", enabled)
                .putString("eqLevels", joinLevels(levels))
                .putInt("bass", Math.max(0, Math.min(1000, bassValue)))
                .apply();
    }

    static void storeFade(Context c, int ms) {
        c.getSharedPreferences(AUDIO_PREFS, MODE_PRIVATE).edit()
                .putInt("fadeMs", Math.max(0, Math.min(12000, ms)))
                .apply();
    }

    /** Lê o estado dos efeitos direto das preferências (para a tela de Ajustes). */
    static JSObject readEffects(Context c, boolean supported) {
        SharedPreferences p = c.getSharedPreferences(AUDIO_PREFS, MODE_PRIVATE);
        JSObject o = new JSObject();
        o.put("supported", supported);
        o.put("enabled", p.getBoolean("eqOn", false));
        o.put("bass", p.getInt("bass", 0));
        o.put("fadeMs", p.getInt("fadeMs", 0));
        o.put("min", -EQ_LIMIT_MB);
        o.put("max", EQ_LIMIT_MB);
        JSArray freqs = new JSArray();
        JSArray levels = new JSArray();
        int[] lv = parseLevels(p.getString("eqLevels", ""));
        for (int i = 0; i < EQ_POINTS_HZ.length; i++) {
            freqs.put(EQ_POINTS_HZ[i]);
            levels.put(lv[i]);
        }
        o.put("bands", freqs);
        o.put("levels", levels);
        return o;
    }

    /** Nível (milibels) numa frequência qualquer, interpolando os 5 pontos em escala logarítmica. */
    private int levelAtHz(double hz) {
        if (hz <= EQ_POINTS_HZ[0]) return eqLevels[0];
        int last = EQ_POINTS_HZ.length - 1;
        if (hz >= EQ_POINTS_HZ[last]) return eqLevels[last];
        for (int i = 0; i < last; i++) {
            if (hz <= EQ_POINTS_HZ[i + 1]) {
                double a = Math.log(EQ_POINTS_HZ[i]);
                double b = Math.log(EQ_POINTS_HZ[i + 1]);
                double t = (Math.log(hz) - a) / (b - a);
                return (int) Math.round(eqLevels[i] + t * (eqLevels[i + 1] - eqLevels[i]));
            }
        }
        return 0;
    }

    /** Relê as preferências e aplica (chamado quando o app muda algo com o player já aberto). */
    void reloadAudioPrefs() {
        loadAudioPrefs();
        attachEffects();
        applyEffects();
        MAIN.removeCallbacks(fader);
        if (fadeMs > 0 && player.isPlaying()) MAIN.post(fader);
        else player.setVolume(1f);
    }

    /** Liga o equalizador e o reforço de graves à sessão de áudio do player. */
    private void attachEffects() {
        if (player == null) return;
        int session = player.getAudioSessionId();
        if (session == C.AUDIO_SESSION_ID_UNSET || session == 0) return;
        if (session == effectsSession && eq != null) { applyEffects(); return; }
        releaseEffects();
        effectsSession = session;
        try { eq = new Equalizer(0, session); } catch (Exception e) { eq = null; }
        try { bass = new BassBoost(0, session); } catch (Exception e) { bass = null; }
        applyEffects();
    }

    private void applyEffects() {
        try {
            if (eq != null) {
                short bands = eq.getNumberOfBands();
                short[] range = eq.getBandLevelRange();
                for (short i = 0; i < bands; i++) {
                    int lvl = levelAtHz(eq.getCenterFreq(i) / 1000.0); // milihertz -> hertz
                    lvl = Math.max(range[0], Math.min(range[1], lvl));
                    eq.setBandLevel(i, (short) lvl);
                }
                eq.setEnabled(eqOn);
            }
        } catch (Exception ignored) {}
        try {
            if (bass != null) {
                boolean on = eqOn && bassStrength > 0 && bass.getStrengthSupported();
                if (on) bass.setStrength((short) bassStrength);
                bass.setEnabled(on);
            }
        } catch (Exception ignored) {}
    }

    private void releaseEffects() {
        try { if (eq != null) eq.release(); } catch (Exception ignored) {}
        try { if (bass != null) bass.release(); } catch (Exception ignored) {}
        eq = null;
        bass = null;
        effectsSession = -1;
    }

    boolean effectsSupported() {
        attachEffects();
        return eq != null;
    }

    private void updateFade() {
        if (fadeMs <= 0) { player.setVolume(1f); return; }
        long dur = player.getDuration();
        if (dur == C.TIME_UNSET || dur <= 0) return;
        long f = Math.min((long) fadeMs, dur / 4);
        if (f <= 0) return;
        long pos = Math.max(0L, player.getCurrentPosition());
        long rem = Math.max(0L, dur - pos);
        float v = 1f;
        if (rem < f) v = rem / (float) f;
        if (pos < f) v = Math.min(v, Math.max(0.05f, pos / (float) f));
        player.setVolume(Math.max(0f, Math.min(1f, v)));
    }

    // ---------- temporizador de desligar ----------
    /** minutes > 0: pausa depois desse tempo; endOfTrack: pausa quando a música atual terminar. */
    void setSleep(long ms, boolean endOfTrack) {
        cancelSleep();
        if (endOfTrack) {
            sleepEndOfTrack = true;
            player.setPauseAtEndOfMediaItems(true);
        } else if (ms > 0) {
            sleepEndAt = SystemClock.elapsedRealtime() + ms;
            sleepRunnable = () -> {
                sleepRunnable = null;
                sleepEndAt = 0;
                try { player.pause(); } catch (Exception ignored) {}
                emitSleep(true);
            };
            MAIN.postDelayed(sleepRunnable, ms);
        }
        emitSleep(false);
    }

    void cancelSleep() {
        if (sleepRunnable != null) MAIN.removeCallbacks(sleepRunnable);
        sleepRunnable = null;
        sleepEndAt = 0;
        if (sleepEndOfTrack && player != null) {
            try { player.setPauseAtEndOfMediaItems(false); } catch (Exception ignored) {}
        }
        sleepEndOfTrack = false;
    }

    JSObject sleepObject(boolean fired) {
        JSObject o = new JSObject();
        boolean byTime = sleepEndAt > 0;
        o.put("active", byTime || sleepEndOfTrack);
        o.put("endOfTrack", sleepEndOfTrack);
        o.put("remainingMs", byTime ? Math.max(0L, sleepEndAt - SystemClock.elapsedRealtime()) : 0L);
        o.put("fired", fired);
        return o;
    }

    private void emitSleep(boolean fired) {
        EventSink k = sink;
        if (k != null) k.emit("sleep", sleepObject(fired));
    }

    void play() { player.play(); }
    void pause() { player.pause(); }
    void seek(long ms) { player.seekTo(Math.max(0L, ms)); }
    void rate(float r) { if (r > 0f && r <= 4f) player.setPlaybackSpeed(r); }
    void repeatOne(boolean one) {
        if (one) player.setRepeatMode(Player.REPEAT_MODE_ONE);
        else if (player.getRepeatMode() == Player.REPEAT_MODE_ONE) player.setRepeatMode(Player.REPEAT_MODE_ALL);
    }
    /** Botão X da notificação: para a música e tira o card. */
    void closeFromNotification() {
        try {
            EventSink k = sink;
            if (k != null) {
                JSObject o = stateObject(null);
                o.put("playing", false);
                o.put("state", 1);
                k.emit("state", o);
            }
        } catch (Exception ignored) {}
        cancelSleep();
        try {
            player.stop();
            player.clearMediaItems();
        } catch (Exception ignored) {}
        pauseAllPlayersAndStopSelf();
    }

    void stopAll() {
        player.stop();
        player.clearMediaItems();
        emitState(null);
    }

    JSObject stateObject(String error) {
        JSObject o = new JSObject();
        MediaItem it = player.getCurrentMediaItem();
        int st = player.getPlaybackState();
        long dur = player.getDuration();
        o.put("id", it == null ? "" : it.mediaId);
        o.put("playing", player.getPlayWhenReady() && st != Player.STATE_ENDED && st != Player.STATE_IDLE);
        o.put("position", Math.max(0L, player.getCurrentPosition()));
        o.put("duration", dur == C.TIME_UNSET || dur < 0 ? 0L : dur);
        o.put("state", st);
        o.put("ts", System.currentTimeMillis()); // para o app compensar o atraso da ponte
        o.put("rate", (double) player.getPlaybackParameters().speed);
        if (error != null) o.put("error", error);
        return o;
    }

    private void emitState(String error) {
        if (player == null) return;
        EventSink k = sink;
        if (k != null) k.emit("state", stateObject(error));
        publishWidgets();
    }

    /** Mantém os widgets da tela inicial em dia (limitado dentro do NyxWidgets). */
    private void publishWidgets() {
        try {
            MediaItem it = player.getCurrentMediaItem();
            if (it == null) return;
            int st = player.getPlaybackState();
            boolean playing = player.getPlayWhenReady() && st != Player.STATE_ENDED && st != Player.STATE_IDLE;
            long dur = player.getDuration();
            Uri art = it.mediaMetadata.artworkUri;
            NyxWidgets.publish(this, it.mediaId,
                    it.mediaMetadata.title == null ? "" : it.mediaMetadata.title.toString(),
                    it.mediaMetadata.artist == null ? "" : it.mediaMetadata.artist.toString(),
                    art == null || art.getPath() == null ? "" : art.getPath(),
                    playing, player.getCurrentPosition(), dur == C.TIME_UNSET || dur < 0 ? 0L : dur);
        } catch (Exception ignored) {}
    }

    /** Botões dos widgets: usa o mesmo caminho dos botões da notificação. */
    void widgetControl(String what) {
        if (session == null || player == null) return;
        Player p = session.getPlayer();
        if ("prev".equals(what)) {
            p.seekToPrevious();
        } else if ("next".equals(what)) {
            p.seekToNext();
        } else {
            int st = p.getPlaybackState();
            if (p.getPlayWhenReady() && st != Player.STATE_ENDED && st != Player.STATE_IDLE) p.pause();
            else p.play();
        }
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // app removido dos recentes: se estiver tocando, continua (fila nativa);
        // se estiver parado/pausado, encerra o serviço
        if (player == null || !player.getPlayWhenReady()
                || player.getPlaybackState() == Player.STATE_ENDED
                || player.getPlaybackState() == Player.STATE_IDLE) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        saveLast();
        NyxWidgets.markStopped(this);
        MAIN.removeCallbacks(ticker);
        MAIN.removeCallbacks(fader);
        cancelSleep();
        releaseEffects();
        instance = null;
        try {
            if (session != null) {
                session.getPlayer().release();
                session.release();
            }
        } catch (Exception ignored) {}
        session = null;
        player = null;
        super.onDestroy();
    }
}
