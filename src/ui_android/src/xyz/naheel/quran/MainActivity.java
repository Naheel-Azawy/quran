package xyz.naheel.quran;

import android.app.ActionBar;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Html;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

/**
 * The entire "app" is this one Activity: a full-screen WebView loading
 * the same web UI that ships to the browser (build/web/*, copied into
 * assets/ at build time -- see the top-level Makefile's android section)
 * plus one JavascriptInterface object ("Android", see AndroidBridge)
 * that gives the page access to SharedPreferences-backed storage, real
 * Android HTTP requests, a native MediaPlayer-backed audio player with a
 * proper notification, and system-bar/action-bar theming that follows
 * whatever theme the web UI itself picked (see applyTheme() below). No
 * other framework, no Kotlin, no AndroidX/support libraries -- just
 * android.webkit/android.app/etc.
 *
 * The page is loaded from a fake-but-intercepted https:// origin rather
 * than file:///android_asset/ directly: Chromium's fetch() implementation
 * flatly refuses file:// URLs (unlike XHR, no WebSettings flag changes
 * this), and the app's own JS uses fetch() throughout (wasm-loader.js,
 * tafsir.js's editions.json, render.js's SVG assets, ...). Intercepting
 * requests to a placeholder https hostname and serving them straight out
 * of AssetManager -- see shouldInterceptRequest() below -- is the same
 * trick androidx.webkit.WebViewAssetLoader performs; this just hand-rolls
 * the ~20 lines it takes with framework APIs, since that's a support
 * library.
 */
public class MainActivity extends Activity {

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ASSET_PATH_PREFIX = "/assets/";

    private WebView webView;
    private AndroidBridge bridge;
    private BroadcastReceiver controlReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Required at runtime (not just in the manifest) on API 33+ for
        // the playback notification to actually be shown; harmless to
        // ask up front since the whole point of the app is audio playback.
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, 1);
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        bridge = new AndroidBridge(this, webView);
        webView.addJavascriptInterface(bridge, "Android");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!ASSET_HOST.equals(url.getHost())) return null;
                String path = url.getPath(); // e.g. "/assets/index.html"
                if (path == null || !path.startsWith(ASSET_PATH_PREFIX)) return null;

                String assetPath = path.substring(ASSET_PATH_PREFIX.length());
                try {
                    InputStream is = getAssets().open(assetPath);
                    return new WebResourceResponse(mimeTypeFor(assetPath), null, is);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        null, new ByteArrayInputStream(new byte[0]));
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // The web UI never needs camera/mic/etc.; deny by default
                // rather than silently granting.
                request.deny();
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d("quran-js", cm.message() + " -- " + cm.sourceId() + ":" + cm.lineNumber());
                return true;
            }
        });

        // Relays PlaybackService's notification/lock-screen button taps
        // back into audio.js's window.__nativeAudioControl(). Registered
        // here (rather than in the manifest) since it only matters while
        // this Activity -- and therefore the WebView it controls -- exists.
        controlReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String cmd = intent.getStringExtra(PlaybackService.EXTRA_COMMAND);
                if (cmd != null) bridge.dispatchAudioControl(cmd);
            }
        };
        registerReceiver(controlReceiver, new IntentFilter(PlaybackService.ACTION_CONTROL));

        webView.loadUrl("https://" + ASSET_HOST + ASSET_PATH_PREFIX + "index.html");
    }

    // AssetManager knows nothing about MIME types, and
    // URLConnection.guessContentTypeFromName() doesn't recognize several
    // extensions this app actually ships (.wasm, .webmanifest); an
    // explicit small table is more reliable than guessing. If the
    // console (see onConsoleMessage above) ever shows a wrong-content-type
    // or blocked-MIME warning for some other extension, add it here.
    private static String mimeTypeFor(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.US) : "";
        switch (ext) {
            case "html": return "text/html";
            case "js":   return "application/javascript";
            case "css":  return "text/css";
            case "json": return "application/json";
            case "wasm": return "application/wasm";
            case "svg":  return "image/svg+xml";
            case "png":  return "image/png";
            case "ttf":  return "font/ttf";
            case "webmanifest": return "application/manifest+json";
            default: return "application/octet-stream";
        }
    }

    /**
     * Paints the system status/navigation bars and (if the activity's
     * theme happens to have one) the action bar to match whatever theme
     * the web UI just switched to -- see AndroidBridge.setTheme(), which
     * hops onto the UI thread and calls this; panels.js's theme_set() is
     * what actually decides bg/fg, by reading the real computed CSS
     * colors rather than duplicating them here.
     *
     * @param light whether this is a light theme (controls whether the
     *              system bar icons/text are drawn dark-on-light or
     *              light-on-dark)
     * @param bg    background color as "#rrggbb"
     * @param fg    foreground/text color as "#rrggbb"
     */
    void applyTheme(boolean light, String bg, String fg) {
        int background = Color.parseColor(bg);
        int foreground = Color.parseColor(fg);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(background);
            getWindow().setNavigationBarColor(background);
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
                if (controller == null) throw new Exception();
                controller.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                controller.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                if (light) {
                    controller.setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                    controller.setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                }
            } else {
                throw new Exception();
            }
        } catch (NoSuchMethodError | Exception ignored) {
            if (light) {
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR |
                        View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            } else {
                getWindow().getDecorView().setSystemUiVisibility(0);
            }
        }

        // action bar colors -- a no-op on this Activity's current
        // (action-bar-less, full-screen WebView) theme, but harmless and
        // correct if that ever changes
        ActionBar actionBar = getActionBar();
        if (actionBar == null) return;
        CharSequence title = getString(R.string.app_name);
        actionBar.setBackgroundDrawable(new ColorDrawable(background));
        // NOTE: uses the original "#rrggbb" string here, not the parsed
        // `foreground` int -- Html.fromHtml() needs a CSS-style color
        // token, and formatting an int in decimal isn't one.
        actionBar.setTitle(Html.fromHtml("<font color='" + fg + "'>" + title + "</font>"));
        getWindow().getDecorView().setBackgroundColor(background);
    }

    /**
     * Keeps the display on while this Activity is in the foreground (the
     * flag has no effect once the Activity is stopped, so the screen can
     * still time out normally when the app is backgrounded -- audio keeps
     * playing through PlaybackService regardless). Must run on the UI
     * thread; AndroidBridge.setKeepScreenOn() takes care of that hop.
     * Needs no manifest permission, unlike a PowerManager wake lock. This
     * is what the web side's wake-lock.js calls, since a WebView does not
     * necessarily implement the JS Screen Wake Lock API itself.
     */
    void applyKeepScreenOn(boolean keepOn) {
        if (keepOn) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(controlReceiver);
        bridge.release();
        super.onDestroy();
    }
}
