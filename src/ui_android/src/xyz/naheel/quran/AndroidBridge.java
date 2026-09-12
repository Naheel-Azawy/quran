package xyz.naheel.quran;

import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Everything the web UI (see src/ui_web/src/native-bridge.js) can call
 * into, exposed to JS as a single object named "Android". Kept as one
 * class -- rather than one JavascriptInterface per concern -- because the
 * web side already namespaces calls by method name (storageGet/audioPlay/
 * fetchText/...), and one addJavascriptInterface() call is simpler than
 * several.
 *
 * Every @JavascriptInterface method here runs on a background thread (not
 * the UI thread) as of API 17+, but calls still block the calling JS
 * statement until they return -- so anything slow (network) is handed off
 * to its own thread here and reported back asynchronously via
 * WebView.evaluateJavascript(), never done inline in one of these methods.
 * Anything that touches Window/View APIs (setTheme()) is likewise hopped
 * back onto the UI thread rather than called directly.
 */
public class AndroidBridge {

    private static final String PREFS_NAME = "quran_prefs";

    private final MainActivity activity;
    private final WebView webView;
    private final SharedPreferences prefs;
    private final PlaybackManager playback;
    private final ExecutorService network = Executors.newFixedThreadPool(2);

    AndroidBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.prefs = activity.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
        this.playback = new PlaybackManager(activity, webView);
    }

    // ---------- storage (replaces localStorage; see native-bridge.js's `storage`) ----------

    @JavascriptInterface
    public String storageGet(String key) {
        return prefs.getString(key, null);
    }

    @JavascriptInterface
    public void storageSet(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    // ---------- network (real Android HTTP requests for external tafsir mirrors) ----------

    @JavascriptInterface
    public void fetchText(final String url, final String callbackId) {
        network.execute(() -> {
            int status;
            String body;
            boolean ok;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                status = conn.getResponseCode();
                ok = status >= 200 && status < 300;
                body = readAll(ok ? conn.getInputStream() : conn.getErrorStream());
            } catch (IOException e) {
                status = 0;
                ok = false;
                body = "";
            } finally {
                if (conn != null) conn.disconnect();
            }
            deliverFetchResult(callbackId, ok, status, body);
        });
    }

    private static String readAll(InputStream is) throws IOException {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) != -1) sb.append(buf, 0, n);
        }
        return sb.toString();
    }

    private void deliverFetchResult(String callbackId, boolean ok, int status, String body) {
        String js = String.format(Locale.US,
            "window.__nativeFetchResolve && window.__nativeFetchResolve('%s', %b, %d, %s)",
            callbackId.replace("'", ""), ok, status, jsonString(body));
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    // Minimal JSON string-literal encoder -- body text is arbitrary
    // remote JSON/HTML, so this has to escape more than just quotes.
    private static String jsonString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"':  sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format(Locale.US, "\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    // ---------- audio (replaces the two <audio> "slots"; see audio-slot.js) ----------

    @JavascriptInterface
    public void audioSetSrc(int index, String url) { playback.setSrc(index, url); }

    @JavascriptInterface
    public void audioPlay(int index) { playback.play(index); }

    @JavascriptInterface
    public void audioPause(int index) { playback.pause(index); }

    @JavascriptInterface
    public void audioSeek(int index, double seconds) { playback.seek(index, seconds); }

    @JavascriptInterface
    public void audioSetVolume(int index, double volume) { playback.setVolume(index, volume); }

    @JavascriptInterface
    public void audioSetNowPlaying(String title, boolean playing) {
        playback.setNowPlaying(title, playing);
    }

    // ---------- theme (system bars follow whatever theme the web UI picked) ----------

    /**
     * @param light whether this is a light theme
     * @param bg    background color as "#rrggbb", read from the page's
     *              own computed CSS (see panels.js's theme_set())
     * @param fg    foreground/text color as "#rrggbb", same source
     */
    @JavascriptInterface
    public void setTheme(final boolean light, final String bg, final String fg) {
        activity.runOnUiThread(() -> {
            try {
                activity.applyTheme(light, bg, fg);
            } catch (IllegalArgumentException e) {
                // bg/fg didn't parse as a color -- ignore rather than
                // crash the UI thread over a cosmetic failure
            }
        });
    }

    // ---------- native -> JS ----------

    /** Called by MainActivity when a notification/lock-screen control is tapped. */
    void dispatchAudioControl(String cmd) {
        String js = String.format(Locale.US,
            "window.__nativeAudioControl && window.__nativeAudioControl('%s')", cmd);
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    void release() {
        playback.release();
        network.shutdown();
    }
}
