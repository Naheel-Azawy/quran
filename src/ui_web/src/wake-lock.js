import { getAndroidBridge } from "./native-bridge.js";

const bridge = getAndroidBridge();

// Keeps the screen on while the app is in the foreground, using the Screen
// Wake Lock API. The browser releases the lock by itself whenever the page
// is hidden (tab switch, app backgrounded, screen locked by the user), so
// it has to be requested again when the page becomes visible. Requests can
// also be refused (insecure context, battery saver); those failures are
// logged and retried on the next visibility change or tap rather than
// treated as fatal.
let sentinel = null; // the active WakeLockSentinel, if any
let pending  = false;
let started  = false;

async function acquire() {
    if (document.visibilityState !== "visible") return;
    if (sentinel && !sentinel.released) return;
    if (pending) return;
    pending = true;
    try {
        const lock = await navigator.wakeLock.request("screen");
        sentinel = lock;
        lock.addEventListener("release", () => {
            if (sentinel === lock) sentinel = null;
        });
    } catch (e) {
        console.warn("Wake lock unavailable:", e);
    } finally {
        pending = false;
    }
}

export function keepScreenOn() {
    if (started) return;
    started = true;

    // Optional hook for the Android shell: a WebView may not implement the
    // Wake Lock API, so if MainActivity exposes setKeepScreenOn(boolean) on
    // the "Android" interface, use it too. Ignored when absent.
    if (bridge && typeof bridge.setKeepScreenOn === "function") {
        try { bridge.setKeepScreenOn(true); } catch (e) { console.warn(e); }
    }

    if (!("wakeLock" in navigator)) return;

    document.addEventListener("visibilitychange", acquire);
    // retry path if the first request was refused
    window.addEventListener("pointerdown", acquire, { passive: true });
    acquire();
}
