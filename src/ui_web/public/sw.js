// __CACHE_NAME__ is replaced at build time (see webpack.config.js) with a
// value derived from the Makefile's VERSION and the build timestamp, so
// every deploy gets its own unique cache name automatically -- no manual
// version bump required.
let   cacheName   = "__CACHE_NAME__";
const title       = "Quran";
const cacheAssets = [
    "index.html",
    "bundle.js",
    "style.css",
    "quran.wasm", // built directly into build/web/ by the top-level Makefile
    "res/fonts/me_quran.ttf",
    "res/header.svg",
    "res/aya.svg",
    "res/icon.png",
    "res/editions.json",
    "manifest.webmanifest",
];

// index.html references bundle.js and style.css as "bundle.js?v=<version>"
// (cache-busting for the browser's HTTP cache, see VersionAssetUrlsPlugin
// in webpack.config.js), while cacheAssets above stores them under their
// bare URLs. Cache Storage matches on the full URL, query included, so a
// plain caches.match(request) would miss them -- including offline, where
// that is fatal. This maps such a request back to its bare cached URL.
// Only URLs of listed assets are touched, so other requests that carry a
// query string (anything cross-origin, for instance) keep exact matching.
// The version inside the query is redundant here anyway: the cache itself
// is already versioned through cacheName.
const assetUrls = new Set(cacheAssets.map(f => new URL(f, self.location.href).href));

function cacheKeyFor(request) {
    const url = new URL(request.url);
    if (url.search) {
        const bare = url.origin + url.pathname;
        if (assetUrls.has(bare)) return bare;
    }
    return request;
}

const checkPeriod = 1000 * 60 * 10;
let lastChecked = millis() - checkPeriod;

const uncachable = [
    "version"
];

const log = console.log;

function millis() {
    return new Date().getTime();
}

// Always asks the network directly for the version marker -- {cache:
// "no-store"} bypasses the browser's own HTTP cache, not just this
// service worker's Cache Storage, so a change in the deployed build is
// never masked by a stale HTTP-cached copy of "version" itself.
async function buildDiffer() {
    if ((millis() - lastChecked) < checkPeriod) {
        return false;
    }
    let there;
    try {
        there = await (await fetch("version", { cache: "no-store" })).text();
        lastChecked = millis();
    } catch (e) {
        log("BUILD: failed checking", e);
        return false;
    }
    const differ = there != cacheName;
    cacheName = there; // so cacheAll would load new files
    return differ;
}

async function cacheAll() {
    log(`[Service Worker] Caching all...`);
    const cache = await caches.open(cacheName);
    for (let f of cacheAssets) {
        // {cache: "reload"} forces a fresh network fetch instead of a
        // browser-HTTP-cache hit, so a re-cache after a version bump
        // actually picks up the new files rather than re-storing the old
        // ones the browser still happens to have cached.
        const request = new Request(f, { cache: "reload" });
        const response = await fetch(request);
        cache.put(new Request(f), response.clone());
    }
}

self.addEventListener("install", (e) => {
    log(`[Service Worker] Install ${cacheName}`);
    e.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        log("[Service Worker] Caching all: app shell and content");
        await cacheAll();
    })());
});

self.addEventListener("activate", (e) => {
    log("Service Worker: Activate");
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(
                keyList.map((key) => {
                    if (key === cacheName) {
                        return undefined;
                    }
                    log(`Service Worker: Clearing old cache ${key}`);
                    return caches.delete(key);
                })
            );
        }),
    );
});

self.addEventListener("fetch", (e) => {
    // Cache http and https only, skip unsupported chrome-extension:// and file://...
    if (!(e.request.url.startsWith("http:") || e.request.url.startsWith("https:"))) {
        return;
    }

    e.respondWith((async () => {
        log(`[Service Worker] Fetching resource: ${e.request.url}`);
        const differ = await buildDiffer();
        if (differ) {
            log(`[Service Worker] Updating build...`);
            await self.registration.update();
            await self.registration.unregister();
            await cacheAll();
        }
        const path = e.request.url.split("/").pop();
        if (e.request && e.request.method && e.request.method == "POST") {
            log(`[Service Worker] will not cache POST ${path}`);
            return await fetch(e.request);
        } else if (uncachable.includes(path)) {
            log(`[Service Worker] will not cache ${path}`);
            return await fetch(e.request, { cache: "no-store" });
        } else {
            const key = cacheKeyFor(e.request);
            const r = await caches.match(key);
            if (r) {
                log(`[Service Worker] Loading cached`);
                return r;
            }
            const response = await fetch(e.request);
            const cache = await caches.open(cacheName);
            log(`[Service Worker] Caching new resource: ${e.request.url}`);
            cache.put(key, response.clone());
            return response;
        }
    })());
});
