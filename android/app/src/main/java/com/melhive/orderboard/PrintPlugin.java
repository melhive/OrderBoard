package com.melhive.orderboard;

import android.content.Context;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens Android's print dialog for the app's own web view, which also offers
 * "Save as PDF". The web side fills #print-report first, and the @media print
 * rules in styles.css show only that report (same as window.print() in Chrome,
 * which the Android WebView doesn't support).
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Order Board report");
        getActivity()
            .runOnUiThread(() -> {
                try {
                    WebView webView = getBridge().getWebView();
                    PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
                    printManager.print(name, adapter, null);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Printing isn't available on this phone.", e);
                }
            });
    }
}
