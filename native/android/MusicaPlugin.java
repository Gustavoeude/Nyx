package br.com.gustavoeude.reprodutormusical;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;

import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Ponte entre o JavaScript do app e o serviço de reprodução em segundo plano. */
@CapacitorPlugin(name = "MusicaNative", permissions = {
        @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
public class MusicaPlugin extends Plugin {

    // ================= seleção nativa de pastas =================
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPickerResult");
    }

    @ActivityCallback
    private void folderPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null
                || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri treeUri = result.getData().getData();
        try {
            int flags = result.getData().getFlags()
                    & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);
        } catch (Exception ignored) {}

        JSObject response = new JSObject();
        response.put("cancelled", false);
        response.put("uri", treeUri.toString());
        response.put("name", queryDisplayName(treeUri));
        call.resolve(response);
    }

    private String queryDisplayName(Uri treeUri) {
        try {
            String documentId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
            try (Cursor cursor = getContext().getContentResolver().query(
                    documentUri, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
            }
        } catch (Exception ignored) {}
        return "pasta";
    }

    @PluginMethod
    public void listFolderAudio(PluginCall call) {
        try {
            String value = call.getString("uri");
            if (value == null || value.isEmpty()) throw new IllegalArgumentException("Pasta inválida");
            Uri treeUri = Uri.parse(value);
            List<String> ignoredDocumentIds = new ArrayList<>();
            JSArray ignoredUris = call.getArray("ignoredUris");
            if (ignoredUris != null) {
                for (int i = 0; i < ignoredUris.length(); i++) {
                    String ignoredValue = ignoredUris.optString(i, "");
                    if (ignoredValue.isEmpty()) continue;
                    Uri ignoredUri = Uri.parse(ignoredValue);
                    if (treeUri.getAuthority() != null && treeUri.getAuthority().equals(ignoredUri.getAuthority())) {
                        ignoredDocumentIds.add(DocumentsContract.getTreeDocumentId(ignoredUri));
                    }
                }
            }
            JSArray files = new JSArray();
            JSArray folders = new JSArray();
            String rootId = DocumentsContract.getTreeDocumentId(treeUri);
            collectFolderAudio(treeUri, rootId, "", files, folders, ignoredDocumentIds);

            JSObject response = new JSObject();
            response.put("files", files);
            // Subpastas que têm músicas direto nelas; "uri" serve como diretório ignorado.
            response.put("folders", folders);
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Não foi possível listar a pasta: " + e.getMessage());
        }
    }

    private void collectFolderAudio(Uri treeUri, String parentId, String prefix, JSArray files,
                                    JSArray folders, List<String> ignoredDocumentIds) throws Exception {
        if (isIgnoredDocument(parentId, ignoredDocumentIds)) return;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] columns = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        try (Cursor cursor = getContext().getContentResolver().query(
                childrenUri, columns, null, null, null)) {
            if (cursor == null) return;
            int idColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE);
            int modColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            int directAudio = 0;
            while (cursor.moveToNext()) {
                String id = cursor.getString(idColumn);
                String name = cursor.getString(nameColumn);
                String mime = cursor.getString(mimeColumn);
                String relativePath = prefix.isEmpty() ? name : prefix + "/" + name;

                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (!isIgnoredDocument(id, ignoredDocumentIds)) {
                        collectFolderAudio(treeUri, id, relativePath, files, folders, ignoredDocumentIds);
                    }
                } else if (isAudioDocument(name, mime)) {
                    Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                    JSObject item = new JSObject();
                    item.put("uri", fileUri.toString());
                    item.put("name", name);
                    item.put("relativePath", relativePath);
                    item.put("mimeType", mime == null ? "application/octet-stream" : mime);
                    item.put("size", cursor.isNull(sizeColumn) ? 0L : cursor.getLong(sizeColumn));
                    item.put("lastModified", cursor.isNull(modColumn) ? 0L : cursor.getLong(modColumn));
                    files.put(item);
                    if (name == null || !name.toLowerCase(java.util.Locale.ROOT).endsWith(".lrc")) directAudio++;
                }
            }
            if (directAudio > 0 && !prefix.isEmpty()) {
                JSObject folder = new JSObject();
                folder.put("uri", DocumentsContract.buildTreeDocumentUri(treeUri.getAuthority(), parentId).toString());
                folder.put("name", prefix.substring(prefix.lastIndexOf('/') + 1));
                folder.put("relativePath", prefix);
                folder.put("count", directAudio);
                folders.put(folder);
            }
        }
    }

    private boolean isIgnoredDocument(String documentId, List<String> ignoredDocumentIds) {
        if (documentId == null) return false;
        for (String ignoredId : ignoredDocumentIds) {
            if (documentId.equals(ignoredId) || documentId.startsWith(ignoredId + "/")) return true;
        }
        return false;
    }

    private boolean isAudioDocument(String name, String mime) {
        if (mime != null && mime.toLowerCase(java.util.Locale.ROOT).startsWith("audio/")) return true;
        String lower = name == null ? "" : name.toLowerCase(java.util.Locale.ROOT);
        return lower.endsWith(".mp3") || lower.endsWith(".m4a") || lower.endsWith(".m4b")
                || lower.endsWith(".aac") || lower.endsWith(".flac") || lower.endsWith(".ogg")
                || lower.endsWith(".oga") || lower.endsWith(".opus") || lower.endsWith(".wav")
                || lower.endsWith(".weba") || lower.endsWith(".webm") || lower.endsWith(".aiff")
                || lower.endsWith(".aif") || lower.endsWith(".alac") || lower.endsWith(".amr")
                || lower.endsWith(".3gp") || lower.endsWith(".lrc");
    }

    /** Lê um arquivo SAF em blocos para evitar uma única string Base64 gigante na ponte JS. */
    @PluginMethod
    public void readFolderFileChunk(PluginCall call) {
        try {
            String value = call.getString("uri");
            if (value == null || value.isEmpty()) throw new IllegalArgumentException("Arquivo inválido");
            Uri uri = Uri.parse(value);
            long offset = Math.max(0L, (long) (double) call.getDouble("offset", 0.0));
            int chunkSize = call.getInt("chunkSize", 512 * 1024);
            chunkSize = Math.max(64 * 1024, Math.min(chunkSize, 1024 * 1024));

            byte[] buffer = new byte[chunkSize + 1];
            int total = 0;
            try (java.io.InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new java.io.IOException("Arquivo indisponível");
                long skipped = 0;
                while (skipped < offset) {
                    long step = input.skip(offset - skipped);
                    if (step > 0) {
                        skipped += step;
                    } else {
                        if (input.read() == -1) throw new java.io.IOException("Fim inesperado do arquivo");
                        skipped++;
                    }
                }
                while (total < buffer.length) {
                    int count = input.read(buffer, total, buffer.length - total);
                    if (count == -1) break;
                    if (count > 0) total += count;
                }
            }

            int bytesToSend = Math.min(total, chunkSize);
            byte[] chunk = java.util.Arrays.copyOf(buffer, bytesToSend);
            JSObject response = new JSObject();
            response.put("base64", Base64.encodeToString(chunk, Base64.NO_WRAP));
            response.put("nextOffset", offset + bytesToSend);
            response.put("done", total <= chunkSize);
            response.put("bytesRead", bytesToSend);
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Não foi possível ler o bloco do arquivo: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readFolderFile(PluginCall call) {
        try {
            String value = call.getString("uri");
            if (value == null || value.isEmpty()) throw new IllegalArgumentException("Arquivo inválido");
            Uri uri = Uri.parse(value);
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            try (java.io.InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new java.io.IOException("Arquivo indisponível");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            JSObject response = new JSObject();
            response.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Não foi possível ler o arquivo: " + e.getMessage());
        }
    }

    @Override
    public void load() {
        // Sem a barra de rolagem lateral do WebView nas listas.
        try {
            getBridge().executeOnMainThread(() -> {
                getBridge().getWebView().setVerticalScrollBarEnabled(false);
                getBridge().getWebView().setHorizontalScrollBarEnabled(false);
            });
        } catch (Exception ignored) { }
        MusicaPlaybackService.sink = (name, data) -> notifyListeners(name, data);
        MusicaService.listener = (action, positionMs) -> {
            JSObject o = new JSObject();
            o.put("action", action);
            o.put("position", positionMs < 0 ? 0 : positionMs / 1000.0);
            o.put("ts", System.currentTimeMillis());
            notifyListeners("action", o);
        };
    }

    /** Pinta a faixa do sistema embaixo da tela com a cor do app (em vez do cinza padrão). */
    @PluginMethod
    public void setSystemBars(PluginCall call) {
        final String hex = call.getString("navColor");
        final boolean lightBackground = call.getBoolean("light", false);
        final Activity activity = getActivity();
        if (activity == null || hex == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                android.view.Window window = activity.getWindow();
                window.setNavigationBarColor(android.graphics.Color.parseColor(hex));
                androidx.core.view.WindowCompat.getInsetsController(window, window.getDecorView())
                        .setAppearanceLightNavigationBars(lightBackground);
            } catch (Exception ignored) { }
            call.resolve();
        });
    }

    @PluginMethod
    public void update(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = new Intent(ctx, MusicaService.class).setAction(MusicaService.ACT_UPDATE);
            if (call.hasOption("title")) i.putExtra("title", call.getString("title"));
            if (call.hasOption("artist")) i.putExtra("artist", call.getString("artist"));
            if (call.hasOption("playing")) i.putExtra("playing", call.getBoolean("playing", false));
            if (call.hasOption("position")) i.putExtra("position", call.getDouble("position", 0.0));
            if (call.hasOption("duration")) i.putExtra("duration", call.getDouble("duration", 0.0));
            if (call.hasOption("rate")) i.putExtra("rate", call.getDouble("rate", 1.0));
            if (call.hasOption("cover")) i.putExtra("cover", call.getString("cover"));

            MusicaService running = MusicaService.instance;
            if (running != null) running.apply(i);
            else ContextCompat.startForegroundService(ctx, i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível atualizar o serviço: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), MusicaService.class));
        } catch (Exception ignored) {}
        call.resolve();
    }

    /** Android 13+: sem essa permissão a notificação de mídia fica escondida. */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveNotificationPermission(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        resolveNotificationPermission(call);
    }

    private void resolveNotificationPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", Build.VERSION.SDK_INT < 33
                || getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(result);
    }

    /** Pede para o Android não otimizar a bateria do app (evita a música ser encerrada em segundo plano). */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Context ctx = getContext();
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            boolean already = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            result.put("granted", already);
            if (!already) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            }
        } catch (Exception e) {
            result.put("granted", false);
        }
        call.resolve(result);
    }

    // ================= player nativo (Media3) =================
    private File audioDir() {
        File d = new File(getContext().getFilesDir(), "musica-audio");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String safe(String id) {
        return id == null ? "x" : id.replaceAll("[^0-9A-Za-z._-]", "_");
    }

    private static String cleanExt(String ext) {
        String e = ext == null ? "" : ext.replaceAll("[^0-9A-Za-z]", "");
        return e.isEmpty() || e.length() > 5 ? "audio" : e.toLowerCase();
    }

    /** Diz se o arquivo da música já está copiado (e com o tamanho certo). */
    @PluginMethod
    public void hasFile(PluginCall call) {
        try {
            File f = new File(audioDir(), safe(call.getString("id")) + "." + cleanExt(call.getString("ext")));
            long size = (long) (double) call.getDouble("size", 0.0);
            JSObject r = new JSObject();
            boolean ok = f.isFile() && (size <= 0 || f.length() == size);
            r.put("exists", ok);
            r.put("path", f.getAbsolutePath());
            if (ok) f.setLastModified(System.currentTimeMillis());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("hasFile: " + e.getMessage());
        }
    }

    /** Recebe a música em pedaços (base64) e grava na pasta privada do app. */
    @PluginMethod
    public void writeChunk(PluginCall call) {
        try {
            String id = safe(call.getString("id"));
            File part = new File(audioDir(), id + ".part");
            boolean first = Boolean.TRUE.equals(call.getBoolean("first", false));
            boolean done = Boolean.TRUE.equals(call.getBoolean("done", false));
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(part, !first)) {
                out.write(bytes);
            }
            JSObject r = new JSObject();
            if (done) {
                File dest = new File(audioDir(), id + "." + cleanExt(call.getString("ext")));
                if (dest.exists()) dest.delete();
                if (!part.renameTo(dest)) throw new java.io.IOException("não consegui finalizar o arquivo");
                r.put("path", dest.getAbsolutePath());
                r.put("size", dest.length());
            }
            call.resolve(r);
        } catch (Exception e) {
            call.reject("writeChunk: " + e.getMessage());
        }
    }

    /** Guarda a capa (JPEG em base64) para a notificação. */
    @PluginMethod
    public void putCover(PluginCall call) {
        try {
            File dir = new File(audioDir(), "covers");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, safe(call.getString("id")) + ".jpg");
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(f, false)) {
                out.write(bytes);
            }
            JSObject r = new JSObject();
            r.put("path", f.getAbsolutePath());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("putCover: " + e.getMessage());
        }
    }

    /** Mantém a pasta abaixo de maxBytes apagando as músicas copiadas há mais tempo. */
    @PluginMethod
    public void trim(PluginCall call) {
        try {
            long max = (long) (double) call.getDouble("maxBytes", 2.0e9);
            Set<String> keep = new HashSet<>();
            JSArray k = call.getArray("keep");
            if (k != null) for (int i = 0; i < k.length(); i++) keep.add(safe(k.optString(i)));
            File[] files = audioDir().listFiles(File::isFile);
            long total = 0;
            List<File> list = new ArrayList<>();
            if (files != null) {
                for (File f : files) {
                    total += f.length();
                    list.add(f);
                }
            }
            list.sort((a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            int removed = 0;
            for (File f : list) {
                if (total <= max) break;
                String base = f.getName().replaceAll("\\.[^.]*$", "");
                if (keep.contains(base) || f.getName().endsWith(".part")) continue;
                total -= f.length();
                if (f.delete()) removed++;
            }
            JSObject r = new JSObject();
            r.put("removed", removed);
            r.put("bytes", total);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("trim: " + e.getMessage());
        }
    }

    private List<MediaItem> items(PluginCall call) {
        try {
            JSArray arr = call.getArray("items");
            return MusicaPlaybackService.buildItems(arr == null ? new JSONArray() : arr);
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        final List<MediaItem> list = items(call);
        final boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", true));
        final long pos = (long) (double) call.getDouble("position", 0.0);
        final boolean one = Boolean.TRUE.equals(call.getBoolean("repeatOne", false));
        MusicaPlaybackService.run(getContext(), s -> {
            s.setQueue(list, autoplay, pos, one);
            call.resolve();
        }, e -> call.reject("Não foi possível iniciar a fila do player: " + e.getMessage()));
    }

    @PluginMethod
    public void setUpcoming(PluginCall call) {
        final List<MediaItem> list = items(call);
        final String after = call.getString("afterId", "");
        final boolean one = Boolean.TRUE.equals(call.getBoolean("repeatOne", false));
        final boolean loop = Boolean.TRUE.equals(call.getBoolean("loop", false));
        MusicaPlaybackService.run(getContext(), s -> {
            s.setUpcoming(after, list, one, loop);
            call.resolve();
        }, e -> call.reject("Não foi possível atualizar a fila: " + e.getMessage()));
    }

    @PluginMethod
    public void getLastPlayed(PluginCall call) {
        JSObject o = new JSObject();
        try {
            android.content.SharedPreferences p = getContext().getSharedPreferences("nyx_audio", Context.MODE_PRIVATE);
            o.put("id", p.getString("lastId", ""));
            o.put("position", p.getLong("lastPos", 0L));
        } catch (Exception e) {
            o.put("id", "");
            o.put("position", 0);
        }
        call.resolve(o);
    }

    @PluginMethod
    public void getAudioFx(PluginCall call) {
        MusicaPlaybackService s = MusicaPlaybackService.instance;
        if (s == null) {
            // sem player aberto: mostra o que está salvo (o aparelho é testado ao tocar)
            call.resolve(MusicaPlaybackService.readEffects(getContext(), true));
            return;
        }
        MusicaPlaybackService.run(getContext(),
                svc -> call.resolve(MusicaPlaybackService.readEffects(getContext(), svc.effectsSupported())),
                e -> call.reject("Não foi possível ler o equalizador: " + e.getMessage()));
    }

    @PluginMethod
    public void setEqualizer(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final int bassValue = call.getInt("bass", 0);
        JSArray arr = call.getArray("levels");
        final int[] levels = new int[MusicaPlaybackService.EQ_POINTS_HZ.length];
        if (arr != null) for (int i = 0; i < levels.length; i++) levels[i] = arr.optInt(i, 0);
        MusicaPlaybackService.storeEffects(getContext(), enabled, levels, bassValue);
        if (MusicaPlaybackService.instance != null) {
            MusicaPlaybackService.run(getContext(), s -> s.reloadAudioPrefs(), null);
        }
        call.resolve();
    }

    @PluginMethod
    public void setFade(PluginCall call) {
        MusicaPlaybackService.storeFade(getContext(), call.getInt("ms", 0));
        if (MusicaPlaybackService.instance != null) {
            MusicaPlaybackService.run(getContext(), s -> s.reloadAudioPrefs(), null);
        }
        call.resolve();
    }

    @PluginMethod
    public void setSleep(PluginCall call) {
        final long ms = call.getInt("ms", 0); // até 12 h cabe em int
        final boolean endOfTrack = Boolean.TRUE.equals(call.getBoolean("endOfTrack", false));
        MusicaPlaybackService svc = MusicaPlaybackService.instance;
        if (svc == null) {
            // não há player tocando: o app guarda o pedido e reenvia quando a música começar
            JSObject o = new JSObject();
            o.put("active", false);
            o.put("endOfTrack", false);
            o.put("remainingMs", 0);
            o.put("fired", false);
            o.put("idle", true);
            call.resolve(o);
            return;
        }
        MusicaPlaybackService.run(getContext(), s -> {
            if (ms <= 0 && !endOfTrack) s.cancelSleep(); else s.setSleep(ms, endOfTrack);
            call.resolve(s.sleepObject(false));
        }, e -> call.reject("Não foi possível ajustar o temporizador: " + e.getMessage()));
    }

    @PluginMethod
    public void getSleep(PluginCall call) {
        MusicaPlaybackService s = MusicaPlaybackService.instance;
        if (s == null) {
            JSObject o = new JSObject();
            o.put("active", false);
            o.put("endOfTrack", false);
            o.put("remainingMs", 0);
            o.put("fired", false);
            o.put("idle", true);
            call.resolve(o);
            return;
        }
        MusicaPlaybackService.run(getContext(), svc -> call.resolve(svc.sleepObject(false)),
                e -> call.reject("Não foi possível ler o temporizador: " + e.getMessage()));
    }

    @PluginMethod
    public void getQueue(PluginCall call) {
        MusicaPlaybackService s = MusicaPlaybackService.instance;
        if (s == null) {
            JSObject o = new JSObject();
            o.put("id", "");
            o.put("ids", new JSArray());
            call.resolve(o);
            return;
        }
        MusicaPlaybackService.run(getContext(), svc -> call.resolve(svc.queueObject()),
                e -> call.reject("Não foi possível consultar a fila: " + e.getMessage()));
    }

    @PluginMethod
    public void cutUpcoming(PluginCall call) {
        final String after = call.getString("afterId", "");
        final int keep = call.getInt("keep", 0);
        final boolean one = Boolean.TRUE.equals(call.getBoolean("repeatOne", false));
        final boolean loop = Boolean.TRUE.equals(call.getBoolean("loop", false));
        MusicaPlaybackService.run(getContext(), s -> {
            s.cutUpcoming(after, keep, one, loop);
            call.resolve();
        }, e -> call.reject("Não foi possível ajustar a fila: " + e.getMessage()));
    }

    @PluginMethod
    public void appendUpcoming(PluginCall call) {
        final List<MediaItem> list = items(call);
        final String prev = call.getString("prevId", "");
        final boolean loop = Boolean.TRUE.equals(call.getBoolean("loop", false));
        MusicaPlaybackService.run(getContext(), s -> {
            s.appendUpcoming(prev, list, loop);
            call.resolve();
        }, e -> call.reject("Não foi possível acrescentar à fila: " + e.getMessage()));
    }

    @PluginMethod
    public void play(PluginCall call) {
        MusicaPlaybackService.run(getContext(), s -> {
            s.play();
            call.resolve();
        }, e -> call.reject("Não foi possível iniciar a reprodução: " + e.getMessage()));
    }

    @PluginMethod
    public void pause(PluginCall call) {
        MusicaPlaybackService.run(getContext(), s -> {
            s.pause();
            call.resolve();
        }, e -> call.reject("Não foi possível pausar a reprodução: " + e.getMessage()));
    }

    @PluginMethod
    public void seek(PluginCall call) {
        final long ms = (long) (double) call.getDouble("position", 0.0);
        MusicaPlaybackService.run(getContext(), s -> {
            s.seek(ms);
            call.resolve();
        }, e -> call.reject("Não foi possível buscar a posição: " + e.getMessage()));
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        final float r = (float) (double) call.getDouble("rate", 1.0);
        MusicaPlaybackService.run(getContext(), s -> {
            s.rate(r);
            call.resolve();
        }, e -> call.reject("Não foi possível alterar a velocidade: " + e.getMessage()));
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        final boolean one = Boolean.TRUE.equals(call.getBoolean("repeatOne", false));
        MusicaPlaybackService.run(getContext(), s -> {
            s.repeatOne(one);
            call.resolve();
        }, e -> call.reject("Não foi possível alterar a repetição: " + e.getMessage()));
    }

    @PluginMethod
    public void stopPlayer(PluginCall call) {
        MusicaPlaybackService s = MusicaPlaybackService.instance;
        if (s == null) {
            call.resolve();
            return;
        }
        MusicaPlaybackService.run(getContext(), svc -> {
            svc.stopAll();
            call.resolve();
        }, e -> call.reject("Não foi possível parar o player: " + e.getMessage()));
    }

    @PluginMethod
    public void getState(PluginCall call) {
        MusicaPlaybackService s = MusicaPlaybackService.instance;
        if (s == null) {
            JSObject o = new JSObject();
            o.put("id", "");
            o.put("playing", false);
            o.put("position", 0);
            o.put("duration", 0);
            o.put("state", 1);
            call.resolve(o);
            return;
        }
        MusicaPlaybackService.run(getContext(), svc -> call.resolve(svc.stateObject(null)),
                e -> call.reject("Não foi possível consultar o player: " + e.getMessage()));
    }

    @PluginMethod
    public void nativePlayerInfo(PluginCall call) {
        JSObject o = new JSObject();
        o.put("player", true);
        call.resolve(o);
    }
}
