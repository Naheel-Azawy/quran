// Everything the web UI needs from an optional Android host lives behind
// this one module. When running inside the Android WebView shell
// (src/ui_android), MainActivity injects a JavascriptInterface object
// named "Android" before any page script runs; every other module talks
// to the small surface below instead of poking window.Android (or
// localStorage/fetch) directly. In a plain browser window.Android simply
// doesn't exist, so everything below falls back to normal web APIs and
// the exact same JS runs unmodified either way.

const android = typeof window !== "undefined" && window.Android ? window.Android : null;

export const isNative = !!android;

export function getAndroidBridge() {
    return android;
}

// ---------- key/value storage (replaces localStorage) ----------
//
// Mirrors localStorage's `[key]` semantics closely enough for this app's
// existing call sites (`storage.getItem(k) !== undefined`, `|| default`),
// backed by SharedPreferences on Android instead of the WebView's own
// (per-origin, occasionally cleared) DOM storage.

export const storage = {
    getItem(key) {
        if (android) {
            const v = android.storageGet(key);
            return (v === null || v === undefined) ? undefined : v;
        }
        return (key in localStorage) ? localStorage[key] : undefined;
    },
    setItem(key, value) {
        if (android) {
            android.storageSet(key, String(value));
            return;
        }
        localStorage[key] = value;
    },
};

// ---------- network (replaces fetch() for external tafsir mirrors) ----------
//
// Android performs the actual HTTP request (so it's a real Android
// network request, subject to the OS's own connectivity/battery
// policies, not a WebView one) on a background thread, then calls back
// into __nativeFetchResolve() via WebView.evaluateJavascript().

let fetchSeq = 0;
const pendingFetches = new Map();

window.__nativeFetchResolve = (id, ok, status, body) => {
    const resolve = pendingFetches.get(id);
    if (!resolve) return;
    pendingFetches.delete(id);
    resolve({ ok: !!ok, status, body });
};

// Resolves to a small subset of the Response shape: { ok, status, body }
// (body already decoded as text). Returns null -- not a promise -- when
// there's no native bridge, so callers know to fall back to window.fetch
// themselves rather than getting a promise that never settles.
export function nativeFetchText(url) {
    if (!android) return null;
    const id = String(++fetchSeq);
    return new Promise(resolve => {
        pendingFetches.set(id, resolve);
        android.fetchText(url, id);
    });
}
