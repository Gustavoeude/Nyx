package br.com.gustavoeude.reprodutormusical;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.util.LruCache;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

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

    private ExoPlayer player;
    private MediaSession session;
    private PrefetchingBitmapLoader artworkBitmapLoader;

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            emitState(null);
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

        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean isPlaying) {
                emitState(null);
                MAIN.removeCallbacks(ticker);
                if (isPlaying) MAIN.post(ticker);
            }
            @Override public void onPlaybackStateChanged(int state) { emitState(null); }
            @Override public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) { emitState(null); }
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
            if (super.hasNextMediaItem()) super.seekToNextMediaItem();
            else action("next");
        }

        private void goPrevious() {
            if (getCurrentPosition() > 3000) seekTo(0);
            else if (super.hasPreviousMediaItem()) super.seekToPreviousMediaItem();
            else action("previous");
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
        player.setRepeatMode(repeatOne ? Player.REPEAT_MODE_ONE
                : loop ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF);
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
        MAIN.removeCallbacks(ticker);
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
