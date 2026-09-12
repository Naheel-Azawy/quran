# ui_android

A minimal WebView wrapper around the web UI (`src/ui_web`) -- no Gradle,
no Kotlin, no AndroidX/support libraries. Just:

* `MainActivity` -- a full-screen `WebView` loading
  `file:///android_asset/index.html` (the same `build/web/*` the browser
  version ships), with one `JavascriptInterface` object added as
  `Android`.
* `AndroidBridge` -- everything that object exposes: SharedPreferences
  storage, real Android HTTP requests (for the tafsir mirrors), and
  control of a native audio player. See
  `src/ui_web/src/native-bridge.js` for the JS side of this contract.
* `PlaybackManager` -- two `android.media.MediaPlayer`s, mirroring the
  two crossfading "slots" `audio.js` already used as `<audio>` elements
  (see `src/ui_web/src/audio-slot.js`). All playback *decisions*
  (what to play, when to crossfade, auto-advance...) still live in
  `audio.js`; this class only carries them out.
* `PlaybackService` -- a foreground service that owns *only* the
  notification / lock-screen transport surface (via
  `Notification.MediaStyle` + a plain `android.media.session.MediaSession`,
  both framework APIs, no support-lib `MediaSessionCompat` needed since
  minSdk is 21). Button taps are broadcast back to `MainActivity`, which
  relays them into `audio.js` as if the in-page buttons were pressed.

## Building

This is built straight from the top-level `Makefile` (`make android`),
using only the command-line Android SDK tools -- `aapt2`, `d8`,
`zipalign`, `apksigner` -- and a plain `javac`/`keytool`. No Gradle
wrapper, no Android Studio project files. See the `# ANDROID` section of
the Makefile for the exact steps and the environment variables it reads
(`ANDROID_SDK_ROOT`, `KEYSTORE`, etc).

You'll need the SDK's command-line tools and at least one platform +
build-tools version installed, e.g. via `sdkmanager`:

```
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

## Signing

`make android` signs the APK so it installs on a device without any
extra setup: if you don't set `KEYSTORE`/`KEYSTORE_PASS`/`KEY_ALIAS`/
`KEY_PASS`, the Makefile generates and reuses a throwaway
`build/android/debug.keystore` (password `android`) the first time it's
needed. Pass your own to sign for release, e.g.:

```
make android KEYSTORE=/path/to/release.keystore KEYSTORE_PASS=... \
             KEY_ALIAS=... KEY_PASS=...
```

## What's intentionally left out

* Adaptive/round icons, multiple launcher-icon densities -- the build
  just reuses the web app's single `res/icon.png` at every density.
* Any offline/download-ahead story for audio or tafsir -- both still
  stream on demand, exactly like the browser version.
* Handling the case where the Activity is destroyed (app swiped away)
  while a foreground playback notification is still up: notification
  buttons rely on a receiver registered by `MainActivity`, so once that's
  gone, taps stop reaching `audio.js` until the app is reopened. Fine for
  a "lite" wrapper; worth revisiting (e.g. move the receiver into a
  long-lived `Application` subclass) if that turns out to matter in
  practice.
