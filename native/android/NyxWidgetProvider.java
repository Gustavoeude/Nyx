package br.com.gustavoeude.reprodutormusical;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/** Base dos três widgets: redesenha quando pedido e trata os botões. */
public abstract class NyxWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        NyxWidgets.refresh(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
        NyxWidgets.refresh(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (a != null && a.startsWith("br.com.gustavoeude.reprodutormusical.WIDGET_")) {
            NyxWidgets.handleAction(context, a);
            return;
        }
        super.onReceive(context, intent);
    }
}
