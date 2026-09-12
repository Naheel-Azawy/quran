package xyz.naheel.quran;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import java.util.Locale;

/**
 * Owns the two crossfade "slots" audio.js expects (see audio-slot.js),
 * each backed by a real android.media.MediaPlayer -- so the actual
 * network fetch, buffering and decoding happens in Android's own media
 * stack, not the WebView. audio.js remains the single source of truth
 * for *what* should be playing (crossfade timing, auto-advance, "playing"
 * highlight, etc); this class only ever plays exactly what it's told and
 * reports raw playback events back.
 */
class PlaybackManager {

    private final Context appContext;
    private final WebView webView;
    private final MediaPlayer[] players = new MediaPlayer[2];
    private final boolean[] prepared = new boolean[2];
    private final boolean[] pendingPlay = new boolean[2];
    private final float[] volume = { 1f, 1f };
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable timeupdateTask;

    private final AudioManager audioManager;
    private AudioFocusRequest focusRequest; // API 26+ only, otherwise null
    private boolean hasFocus = false;

    private String nowPlayingTitle = "";
    private boolean nowPlaying = false;

    PlaybackManager(Context context, WebView webView) {
        this.appContext = context.getApplicationContext();
        this.webView = webView;
        this.audioManager = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
        for (int i = 0; i < 2; i++) players[i] = makePlayer(i);

        timeupdateTask = new Runnable() {
            @Override public void run() {
                for (int i = 0; i < 2; i++) {
                    MediaPlayer mp = players[i];
                    if (prepared[i] && isPlayingSafe(mp)) {
                        String detail = String.format(Locale.US,
                            "{\"currentTime\":%.3f,\"duration\":%.3f}",
                            mp.getCurrentPosition() / 1000.0, mp.getDuration() / 1000.0);
                        emit(i, "timeupdate", detail);
                    }
                }
                mainHandler.postDelayed(this, 250);
            }
        };
        mainHandler.postDelayed(timeupdateTask, 250);
    }

    private MediaPlayer makePlayer(final int index) {
        MediaPlayer mp = new MediaPlayer();
        if (Build.VERSION.SDK_INT >= 21) {
            mp.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        } else {
            mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
        }
        mp.setOnPreparedListener(m -> {
            prepared[index] = true;
            m.setVolume(volume[index], volume[index]);
            if (pendingPlay[index]) {
                pendingPlay[index] = false;
                m.start();
                emit(index, "play", null);
            }
        });
        mp.setOnCompletionListener(m -> emit(index, "ended", null));
        mp.setOnErrorListener((m, what, extra) -> {
            prepared[index] = false;
            emit(index, "error", String.format(Locale.US, "{\"what\":%d,\"extra\":%d}", what, extra));
            return true; // handled -- don't also trigger onCompletion
        });
        return mp;
    }

    private boolean isPlayingSafe(MediaPlayer mp) {
        try { return mp.isPlaying(); } catch (IllegalStateException e) { return false; }
    }

    private void emit(int index, String type, String detailJson) {
        String detail = detailJson == null ? "{}" : detailJson;
        String js = String.format(Locale.US,
            "window.__nativeAudioEvent && window.__nativeAudioEvent(%d,'%s',%s)",
            index, type, detail);
        mainHandler.post(() -> webView.evaluateJavascript(js, null));
    }

    // ---------- called from AndroidBridge (JS -> native) ----------

    void setSrc(int index, String url) {
        MediaPlayer mp = players[index];
        prepared[index] = false;
        pendingPlay[index] = false;
        try {
            mp.reset();
            if (url == null || url.isEmpty()) return;
            mp.setDataSource(url);
            mp.prepareAsync();
        } catch (Exception e) {
            emit(index, "error", "{\"message\":" + jsonEscapeOrNull(e.getMessage()) + "}");
        }
    }

    void play(int index) {
        requestFocus();
        if (prepared[index]) {
            try {
                players[index].start();
                emit(index, "play", null);
            } catch (IllegalStateException ignored) {}
        } else {
            // onPreparedListener starts it (and emits "play") once ready
            pendingPlay[index] = true;
        }
    }

    void pause(int index) {
        pendingPlay[index] = false;
        try {
            if (players[index].isPlaying()) {
                players[index].pause();
                emit(index, "pause", null);
            }
        } catch (IllegalStateException ignored) {}
    }

    void seek(int index, double seconds) {
        try { players[index].seekTo((int) (seconds * 1000)); } catch (IllegalStateException ignored) {}
    }

    void setVolume(int index, double v) {
        float f = (float) Math.max(0, Math.min(1, v));
        volume[index] = f;
        try { players[index].setVolume(f, f); } catch (IllegalStateException ignored) {}
    }

    void setNowPlaying(String title, boolean playing) {
        nowPlayingTitle = title == null ? "" : title;
        nowPlaying = playing;

        if (nowPlayingTitle.isEmpty()) {
            appContext.stopService(new Intent(appContext, PlaybackService.class));
            abandonFocus();
            return;
        }

        Intent i = new Intent(appContext, PlaybackService.class);
        i.putExtra(PlaybackService.EXTRA_TITLE, nowPlayingTitle);
        i.putExtra(PlaybackService.EXTRA_PLAYING, playing);
        if (Build.VERSION.SDK_INT >= 26) {
            appContext.startForegroundService(i);
        } else {
            appContext.startService(i);
        }
    }

    // ---------- audio focus ----------

    private void requestFocus() {
        if (hasFocus || audioManager == null) return;
        hasFocus = true;
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(this::onFocusChange)
                .build();
            audioManager.requestAudioFocus(focusRequest);
        } else {
            audioManager.requestAudioFocus(this::onFocusChange, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void abandonFocus() {
        if (!hasFocus || audioManager == null) return;
        hasFocus = false;
        if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
        } else {
            audioManager.abandonAudioFocus(this::onFocusChange);
        }
    }

    private void onFocusChange(int change) {
        if (!nowPlaying) return;
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            // Ask audio.js to pause -- it's the one that knows which slot
            // is actually active and will update the UI/notification too.
            mainHandler.post(() -> webView.evaluateJavascript(
                "window.__nativeAudioControl && window.__nativeAudioControl('playpause')", null));
        }
    }

    private static String jsonEscapeOrNull(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    void release() {
        mainHandler.removeCallbacks(timeupdateTask);
        for (MediaPlayer mp : players) {
            try { mp.release(); } catch (Exception ignored) {}
        }
        abandonFocus();
        appContext.stopService(new Intent(appContext, PlaybackService.class));
    }
}
