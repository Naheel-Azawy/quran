let   cacheName   = VERSION;
const title       = "Quran";
const cacheAssets = [
    "fonts/me_quran.ttf",
    "header.svg",
    "icon.png",
    "index.html",
    "main.js",
    "style.css",
    "manifest.webmanifest",
    "viewpager.js",
    "wasm_loader.js",
    "quran.wasm",
];

const checkPeriod = 1000 * 60 * 10;
let lastChecked = millis() - checkPeriod;

const uncachable = [
    "version"
];

const log = console.log;

function millis() {
    return new Date().getTime();
}

async function buildDiffer() {
    if ((millis() - lastChecked) < checkPeriod) {
        return false;
    }
    let there;
    try {
        there = await (await fetch("version")).text();
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
        const request = new Request(f);
        const response = await fetch(request);
        cache.put(request, response.clone());
    }
}

self.addEventListener("install", (e) => {
    log(`[Service Worker] Install ${cacheName}`);
    e.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        log("[Service Worker] Caching all: app shell and content");
        await cache.addAll(cacheAssets);
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
            return await fetch(e.request);
        } else {
            const r = await caches.match(e.request);
            if (r) {
                log(`[Service Worker] Loading cached`);
                return r;
            }
            const response = await fetch(e.request);
            const cache = await caches.open(cacheName);
            log(`[Service Worker] Caching new resource: ${e.request.url}`);
            cache.put(e.request, response.clone());
            return response;
        }
    })());
});
