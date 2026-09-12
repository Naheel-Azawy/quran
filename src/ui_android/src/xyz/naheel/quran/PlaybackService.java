package xyz.naheel.quran;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * Hosts only the lock-screen/status-bar transport surface for whatever
 * audio.js is currently playing. It holds no MediaPlayer of its own --
 * that's PlaybackManager, owned by AndroidBridge in MainActivity's
 * process -- and simply forwards button taps back into the WebView as
 * window.__nativeAudioControl() calls, via a broadcast MainActivity
 * listens for.
 */
public class PlaybackService extends Service {

    private static final String CHANNEL_ID      = "quran_playback";
    private static final int    NOTIFICATION_ID = 1;

    static final String EXTRA_TITLE    = "title";
    static final String EXTRA_PLAYING  = "playing";
    static final String ACTION_CONTROL = "xyz.naheel.quran.AUDIO_CONTROL";
    static final String EXTRA_COMMAND  = "command";

    private static final String ACTION_PLAYPAUSE = "xyz.naheel.quran.action.PLAYPAUSE";
    private static final String ACTION_STOP      = "xyz.naheel.quran.action.STOP";
    private static final String ACTION_NEXT      = "xyz.naheel.quran.action.NEXT";
    private static final String ACTION_PREV      = "xyz.naheel.quran.action.PREV";

    private MediaSession mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        mediaSession = new MediaSession(this, "quran");
        // Without this, the system has no reason to treat this session as
        // something actively receiving media button presses/transport
        // commands, which is part of what makes a session lock-screen
        // eligible in the first place.
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
            | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay()           { sendControl("playpause"); }
            @Override public void onPause()          { sendControl("playpause"); }
            @Override public void onSkipToNext()     { sendControl("next");      }
            @Override public void onSkipToPrevious() { sendControl("prev");      }
            @Override public void onStop()           { sendControl("stop");      }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            switch (intent.getAction()) {
                case ACTION_PLAYPAUSE: sendControl("playpause"); return START_NOT_STICKY;
                case ACTION_STOP:      sendControl("stop");      return START_NOT_STICKY;
                case ACTION_NEXT:      sendControl("next");      return START_NOT_STICKY;
                case ACTION_PREV:      sendControl("prev");      return START_NOT_STICKY;
                default: break;
            }
        }

        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        boolean playing = intent != null && intent.getBooleanExtra(EXTRA_PLAYING, false);
        updateMediaSessionState(title, playing);
        startForeground(NOTIFICATION_ID, buildNotification(title, playing));
        return START_NOT_STICKY;
    }

    // The notification's own MediaStyle + setMediaSession(token) is what
    // *links* it to this session, but the lock screen (and the system's
    // media controls generally) actually decide what to show -- title,
    // play/pause state, which transport buttons make sense right now --
    // from the session's PlaybackState/MediaMetadata, not from the
    // notification's own views. Skipping this left the session "active"
    // but empty, which is why nothing showed up on the lock screen.
    private void updateMediaSessionState(String title, boolean playing) {
        mediaSession.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE,
                title == null || title.isEmpty() ? getString(R.string.app_name) : title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, getString(R.string.app_name))
            .build());

        long actions = PlaybackState.ACTION_PLAY
            | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT
            | PlaybackState.ACTION_SKIP_TO_PREVIOUS
            | PlaybackState.ACTION_STOP;
        int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        mediaSession.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());
    }

    private void sendControl(String cmd) {
        Intent i = new Intent(ACTION_CONTROL);
        i.setPackage(getPackageName());
        i.putExtra(EXTRA_COMMAND, cmd);
        sendBroadcast(i);
        if ("stop".equals(cmd)) {
            stopForeground(true);
            stopSelf();
        }
    }

    private PendingIntent actionIntent(String action) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getService(this, action.hashCode(), i, flags);
    }

    private Notification buildNotification(String title, boolean playing) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        b.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? getString(R.string.app_name) : title)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            // Without this, a secure lock screen (PIN/pattern/password)
            // may redact the notification's content instead of showing
            // the title and transport controls -- PUBLIC is the normal
            // choice for media playback, which has nothing sensitive in
            // it (unlike, say, a messaging notification).
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(R.drawable.ic_prev, getString(R.string.action_prev), actionIntent(ACTION_PREV))
            .addAction(
                playing ? R.drawable.ic_pause : R.drawable.ic_play,
                getString(playing ? R.string.action_pause : R.string.action_play),
                actionIntent(ACTION_PLAYPAUSE))
            .addAction(R.drawable.ic_next, getString(R.string.action_next), actionIntent(ACTION_NEXT))
            .addAction(R.drawable.ic_stop, getString(R.string.action_stop), actionIntent(ACTION_STOP));

        Notification.MediaStyle style = new Notification.MediaStyle();
        style.setMediaSession(mediaSession.getSessionToken());
        style.setShowActionsInCompactView(0, 1, 2);
        b.setStyle(style);

        return b.build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW);
            nm.createNotificationChannel(ch);
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        mediaSession.setActive(false);
        mediaSession.release();
        super.onDestroy();
    }
}
