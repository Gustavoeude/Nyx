package br.com.gustavoeude.reprodutormusical;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable keepAlive = this::keepWebViewAlive;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MusicaPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            WebView web = getBridge().getWebView();
            web.getSettings().setMediaPlaybackRequiresUserGesture(false);
            // Com o app em segundo plano o Android rebaixa o processo do WebView e o JavaScript
            // para de rodar (a fila do player nativo deixa de ser reabastecida). Pedimos para
            // manter o WebView com prioridade alta mesmo fora da tela.
            if (Build.VERSION.SDK_INT >= 26) {
                web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        scheduleKeepAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        scheduleKeepAlive();
    }

    @Override
    public void onResume() {
        super.onResume();
        handler.removeCallbacks(keepAlive);
    }

    private void scheduleKeepAlive() {
        handler.removeCallbacks(keepAlive);
        handler.post(keepAlive);
        handler.postDelayed(keepAlive, 500);
        handler.postDelayed(keepAlive, 2500);
    }

    /** Diz ao WebView que ele continua "visível" e com os temporizadores ligados. */
    private void keepWebViewAlive() {
        try {
            WebView web = getBridge().getWebView();
            if (web == null) return;
            web.resumeTimers();
            web.dispatchWindowVisibilityChanged(View.VISIBLE);
        } catch (Exception ignored) {}
    }
}
