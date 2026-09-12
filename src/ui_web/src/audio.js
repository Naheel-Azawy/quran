import { suraNames, suraOfPage, globalAyahNumber, stepAya, pageOfSuraAya } from "./quran-index.js";
import { toArabicDigits } from "./text-utils.js";
import { ensureServerConsent } from "./consent.js";
import { storage, getAndroidBridge } from "./native-bridge.js";
import { createAudioSlot } from "./audio-slot.js";
import { t } from "./strings.js";

// Two audio sources, each with its own reader-id scheme and URL shape.
// Both lists are curated to the same set of reciters (by voice, not by
// id -- the ids differ per server) so switching servers is really just
// switching *where the same voices come from*. Names are looked up via
// t() (see strings.js's "reciter.*" keys) rather than hardcoded here, so
// they follow the UI language like everything else.
export const SERVERS = {
    cdn: {
        name: "alquran.cloud (cdn.islamic.network)",
        defaultReader: "ar.ajamy",
        // Any other "ar.*" edition id from https://alquran.cloud/cdn
        // works here too; this is just a curated subset.
        readers: [
            { id: "ar.ajamy",              name: t("reciter.ajamy") },
            { id: "ar.alafasy",            name: t("reciter.alafasy") },
            { id: "ar.abdulbasitmurattal", name: t("reciter.abdulbasitmurattal") },
            { id: "ar.abdurrahmaansudais", name: t("reciter.abdurrahmaansudais") },
            { id: "ar.husary",             name: t("reciter.husary") },
            { id: "ar.minshawi",           name: t("reciter.minshawi") },
            { id: "ar.hudhaify",           name: t("reciter.hudhaify") },
            { id: "ar.shaatree",           name: t("reciter.shaatree") },
            { id: "ar.mahermuaiqly",       name: t("reciter.mahermuaiqly") },
        ],
        buildUrl(readerId, sura, aya) {
            return `https://cdn.islamic.network/quran/audio/128/` +
                   `${readerId}/${globalAyahNumber(sura, aya)}.mp3`;
        },
    },
    everyayah: {
        name: "everyayah.com",
        defaultReader: "Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net",
        // subfolder names as listed in everyayah.com's own readers.js;
        // same reciters as the "cdn" list above, picking each one's
        // 128kbps folder where available.
        readers: [
            { id: "Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net", name: t("reciter.ajamy") },
            { id: "Alafasy_128kbps",                               name: t("reciter.alafasy") },
            { id: "Abdul_Basit_Murattal_64kbps",                   name: t("reciter.abdulbasitmurattal") },
            { id: "Abdurrahmaan_As-Sudais_64kbps",                 name: t("reciter.abdurrahmaansudais") },
            { id: "Husary_128kbps",                                name: t("reciter.husary") },
            { id: "Minshawy_Murattal_128kbps",                     name: t("reciter.minshawi") },
            { id: "Hudhaify_128kbps",                              name: t("reciter.hudhaify") },
            { id: "Abu_Bakr_Ash-Shaatree_128kbps",                 name: t("reciter.shaatree") },
            { id: "MaherAlMuaiqly128kbps",                         name: t("reciter.mahermuaiqly") },
        ],
        buildUrl(readerId, sura, aya) {
            const s = String(sura + 1).padStart(3, "0");
            const a = String(aya  + 1).padStart(3, "0");
            return `https://everyayah.com/data/${readerId}/${s}${a}.mp3`;
        },
    },
};

function readerStorageKey(server) {
    return `quran-reader-${server}`;
}

// Auto-advance no longer jumps straight from one ayah's 'ended' to the
// next .play() -- that has a hard, audible seam. Instead two audio slots
// are kept: one "active" (playing/paused, whatever the user hears) and
// one "standby" pre-loaded with the upcoming ayah. As the active one
// nears its end, both are played simultaneously for CROSSFADE_SEC while
// their volumes ramp in opposite directions, then the standby becomes
// active. Manual jumps (prev/next, tapping an aya, switching reader) are
// hard cuts on purpose -- they're the user explicitly asking for a
// different place, not a continuation.
//
// Each slot is created via createAudioSlot() (see audio-slot.js), which
// is either a plain <audio> element or, under Android, a proxy backed by
// a real native MediaPlayer -- everything below is unaware of which.
const CROSSFADE_SEC = .3;

const slots = [createAudioSlot(), createAudioSlot()];
let activeIdx      = 0;
let crossfading    = false;
let crossfadeTimer = null;
let queuedNext     = null; // {sura, aya} pre-loaded into the standby slot

const activeAudio = () => slots[activeIdx];
const otherAudio  = () => slots[1 - activeIdx];

const bridge = getAndroidBridge();

const savedServer = storage.getItem("quran-server");
const initServer = savedServer in SERVERS ? savedServer : "everyayah";

export const audioState = {
    server:      initServer,
    reader:      storage.getItem(readerStorageKey(initServer)) || SERVERS[initServer].defaultReader,
    autoAdvance: storage.getItem("quran-autoadvance") !== undefined
        ? storage.getItem("quran-autoadvance") === "true" : true,
    sura: null,
    aya:  null,
};

function audioUrl(sura, aya) {
    return SERVERS[audioState.server].buildUrl(audioState.reader, sura, aya);
}

// The ViewPager instance, wired in once app.js creates it.
let vp = null;
export function setViewPager(pager) { vp = pager; }

// Whether page-navigation should auto-follow the playing ayah. True right
// after any explicit jump (play button, prev/next-aya, "play from here")
// and whenever the user is already on (or returns to) the page containing
// it; false the moment the user navigates elsewhere on their own while
// audio keeps advancing in the background.
let followPlayback = true;
export function getFollowPlayback() { return followPlayback; }
export function setFollowPlayback(v) { followPlayback = v; }

// Set just before *our own* vp.goto() calls, so app.js's onChange handler
// (which also fires for user-driven navigation) can tell the two apart
// and only reconsider followPlayback for real user moves. consumeProgrammaticNav()
// reads and resets it in one step.
let programmaticNav = false;
export function consumeProgrammaticNav() {
    if (!programmaticNav) return false;
    programmaticNav = false;
    return true;
}

function output() {
    return document.getElementById("output");
}

// Reflects visits to the currently-playing aya's <span class="aya">, if
// it's part of the currently rendered page(s). Unlike .blink (a one-shot
// animation), this has to survive page re-renders, so it's reapplied any
// time the pager redraws rather than set once.
export function applyPlayingHighlight() {
    for (const el of output().querySelectorAll(".aya.playing")) {
        el.classList.remove("playing");
    }
    if (audioState.sura == null) return;
    const el = output().querySelector(
        `.aya[data-sura="${audioState.sura}"][data-aya="${audioState.aya}"]`);
    if (el) el.classList.add("playing");
}

export function updateAudioUI() {
    // .paused is the actual source of truth; a separately-tracked boolean
    // can drift out of sync if a play/pause event from a slot that's
    // since stopped being "active" arrives late
    const playing = audioState.sura != null && !activeAudio().paused;

    const label = document.getElementById("audio-now-playing");
    const nowPlayingLabel = audioState.sura != null
        ? `${suraNames[audioState.sura]} ﴿${toArabicDigits(audioState.aya + 1)}﴾`
        : t("audio.nowPlaying.idle");
    label.textContent = nowPlayingLabel;
    label.onclick = () => gotoPlayingAya({ force: true });

    const playBtn = document.getElementById("btn-audio-playpause");
    playBtn.classList.toggle("is-playing", playing);
    const playLabel = playing ? t("audio.action.pause") : t("audio.action.play");
    playBtn.setAttribute("aria-label", playLabel);
    playBtn.title = playLabel;

    const menuPlayBtn = document.getElementById("btn-menu-audio-playpause");
    menuPlayBtn.classList.toggle("is-playing", playing);
    menuPlayBtn.setAttribute("aria-label", playLabel);
    menuPlayBtn.title = playLabel;

    document.getElementById("btn-audio-stop").disabled = audioState.sura == null;
    document.getElementById("btn-menu-audio-stop").disabled = audioState.sura == null;
    document.getElementById("btn-menu").classList.toggle("audio-active", playing);
    document.getElementById("menu-audio-dot").classList.toggle("active", playing);

    // Keeps Android's notification/lock-screen surface (a real
    // media-style notification, not anything drawn in the WebView) in
    // sync with what's actually playing.
    if (bridge) {
        bridge.audioSetNowPlaying(audioState.sura != null ? nowPlayingLabel : "", playing);
    }
}

export function gotoPlayingAya(opts = {}) {
    const force = !!opts.force;
    const targetPage = pageOfSuraAya(audioState.sura, audioState.aya);

    if (vp.isVisible(targetPage)) {
        // already here -- (re)join auto-following
        followPlayback = true;
        applyPlayingHighlight();
        return;
    }
    if (!force && !followPlayback) {
        // the user wandered off to browse elsewhere; don't drag them back
        // just because playback moved to a different page
        return;
    }

    followPlayback = true;
    programmaticNav = true;
    vp.goto(targetPage);
    // the target page's markup may still be mid-transition; give it a
    // moment before looking for the .aya element, mirroring blinkAya's
    // own use of this delay
    setTimeout(applyPlayingHighlight, vp.transitionSpeed + 50);
}

// Pre-buffers the ayah after the current one into the standby slot so
// it's ready to play the instant a crossfade needs it. Harmless to call
// even when autoAdvance is off -- it also makes the manual next-aya
// button feel instant.
function preloadNext() {
    queuedNext = null;
    if (audioState.sura == null) return;
    const loc = stepAya(audioState.sura, audioState.aya, 1);
    if (!loc) return;
    queuedNext = loc;
    const standby = otherAudio();
    standby.pause();
    standby.currentTime = 0;
    standby.volume = 1;
    standby.src = audioUrl(loc.sura, loc.aya);
}

function cancelCrossfade() {
    clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
    crossfading = false;
    slots.forEach(a => { a.volume = 1; });
}

function beginCrossfade() {
    if (crossfading) return;
    if (!queuedNext) {
        // standby wasn't ready in time (e.g. slow network) -- try a
        // late, unbuffered load rather than dropping the crossfade
        // entirely; if there's no next ayah at all, let 'ended' handle it
        queuedNext = stepAya(audioState.sura, audioState.aya, 1);
        if (queuedNext) otherAudio().src = audioUrl(queuedNext.sura, queuedNext.aya);
    }
    if (!queuedNext) return;

    const from = activeAudio();
    const to   = otherAudio();
    const loc  = queuedNext;

    crossfading = true;
    to.currentTime = 0;
    to.volume = 0;
    to.play().catch(() => {});

    const remaining = from.duration - from.currentTime;
    const durationMs = Math.max(50, Math.min(CROSSFADE_SEC, isFinite(remaining) ? remaining : CROSSFADE_SEC) * 1000);
    const startVol   = from.volume;
    const startTime  = performance.now();

    const tick = () => {
        const now = performance.now();
        const t = Math.max(0, Math.min(1, (now - startTime) / durationMs));
        from.volume = startVol * (1 - t);
        to.volume   = t;
        if (t < 1) {
            crossfadeTimer = setTimeout(tick, 16);
        } else {
            crossfadeTimer = null;
            crossfading  = false;
            from.pause();
            from.currentTime = 0;
            from.volume = 1;

            activeIdx = 1 - activeIdx;
            audioState.sura = loc.sura;
            audioState.aya  = loc.aya;
            queuedNext = null;

            gotoPlayingAya();
            updateAudioUI();
            preloadNext();
        }
    };
    crossfadeTimer = setTimeout(tick, 16);
}

// Returns the origin of the currently-selected audio server, used only to
// show the user what they'd be connecting to.
function audioServerBaseUrl(serverKey) {
    const info = SERVERS[serverKey];
    try {
        return new URL(info.buildUrl(info.defaultReader, 0, 0)).origin;
    } catch (e) {
        return info.name;
    }
}

export function ensureAudioConsent() {
    const info = SERVERS[audioState.server];
    return ensureServerConsent("audio", audioState.server, info.name, audioServerBaseUrl(audioState.server));
}

export async function playAya(sura, aya) {
    const allowed = await ensureAudioConsent();
    if (!allowed) return;

    cancelCrossfade();
    const active  = activeAudio();
    const standby = otherAudio();
    standby.pause();
    standby.currentTime = 0;
    standby.volume = 1;

    audioState.sura = sura;
    audioState.aya  = aya;
    active.volume = 1;
    active.src = audioUrl(sura, aya);
    active.play().catch(e => console.warn("Audio playback blocked:", e));

    gotoPlayingAya({ force: true });
    updateAudioUI();
    preloadNext();
}

export function stopAudio() {
    cancelCrossfade();
    for (const a of slots) {
        a.pause();
        a.removeAttribute("src");
        a.load();
    }
    queuedNext = null;
    audioState.sura = null;
    audioState.aya  = null;
    applyPlayingHighlight();
    updateAudioUI();
}

export function togglePlayPause() {
    if (audioState.sura == null) {
        // nothing picked yet -- start from the beginning of the sura
        // shown on the current page
        playAya(suraOfPage[globalThis.page], 0);
        return;
    }
    const a = activeAudio();
    if (a.paused) {
        a.play().catch(() => {});
        if (crossfading) otherAudio().play().catch(() => {});
    } else {
        a.pause();
        if (crossfading) otherAudio().pause();
    }
}

export function shiftAya(delta) {
    if (audioState.sura == null) return;
    const loc = stepAya(audioState.sura, audioState.aya, delta);
    if (!loc) return;
    playAya(loc.sura, loc.aya);
}

slots.forEach((audio, i) => {
    audio.addEventListener("play", () => {
        applyPlayingHighlight();
        updateAudioUI();
    });
    audio.addEventListener("pause", () => {
        applyPlayingHighlight();
        updateAudioUI();
    });
    audio.addEventListener("error", () => {
        if (!audio.src) return; // fires once from stopAudio()'s removeAttribute too
        console.warn("Audio error:", audio.error);
    });
    audio.addEventListener("timeupdate", () => {
        if (i !== activeIdx || crossfading) return;
        if (!audioState.autoAdvance || audioState.sura == null) return;
        if (!isFinite(audio.duration)) return;
        if (audio.duration - audio.currentTime <= CROSSFADE_SEC) beginCrossfade();
    });
    audio.addEventListener("ended", () => {
        // if a crossfade is/was in flight, it already handled (or is
        // about to handle) the advance -- this is a stale straggler
        if (i !== activeIdx || crossfading) return;
        if (!audioState.autoAdvance || audioState.sura == null) { stopAudio(); return; }
        const loc = stepAya(audioState.sura, audioState.aya, 1);
        if (!loc) { stopAudio(); return; }
        // no crossfade happened (e.g. duration was unknown) -- fall back
        // to a hard cut rather than not advancing at all
        playAya(loc.sura, loc.aya);
    });
});

// Android's notification/lock-screen transport buttons (and audio-focus
// loss, e.g. a phone call coming in) are relayed here from native code
// rather than reimplementing play/pause/stop/next/prev logic twice --
// audio.js stays the single source of truth for what "play" etc. means.
if (bridge) {
    window.__nativeAudioControl = (cmd) => {
        switch (cmd) {
        case "playpause": togglePlayPause(); break;
        case "stop":      stopAudio();       break;
        case "next":      shiftAya(1);       break;
        case "prev":      shiftAya(-1);      break;
        }
    };
}

// ---------- settings UI ----------

export function populateServerSelect() {
    const sel = document.getElementById("server-select");
    sel.innerHTML = "";
    for (const key of Object.keys(SERVERS)) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = SERVERS[key].name;
        sel.appendChild(opt);
    }
    sel.value = audioState.server;
}

export function populateReaderSelect() {
    const sel = document.getElementById("reader-select");
    sel.innerHTML = "";
    for (const { id, name } of SERVERS[audioState.server].readers) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        sel.appendChild(opt);
    }
    sel.value = audioState.reader;
}

// restarts whatever's currently loaded/playing using the (now updated)
// audioState.server/reader -- used when either changes
async function reloadCurrentAudioSource() {
    if (audioState.sura == null) return;
    const allowed = await ensureAudioConsent();
    if (!allowed) return;
    cancelCrossfade();
    const a = activeAudio();
    const wasPlaying = !a.paused;
    a.src = audioUrl(audioState.sura, audioState.aya);
    if (wasPlaying) a.play().catch(() => {});
    preloadNext(); // the standby ayah was buffered from the old source
}

export function bindAudioUI() {
    document.getElementById("btn-audio-playpause").addEventListener("click", togglePlayPause);
    document.getElementById("btn-audio-stop").addEventListener("click", stopAudio);
    document.getElementById("btn-audio-prev").addEventListener("click", () => shiftAya(-1));
    document.getElementById("btn-audio-next").addEventListener("click", () => shiftAya(1));

    document.getElementById("btn-menu-audio-playpause").addEventListener("click", togglePlayPause);
    document.getElementById("btn-menu-audio-stop").addEventListener("click", stopAudio);

    document.getElementById("server-select").addEventListener("change", e => {
        audioState.server = e.target.value;
        storage.setItem("quran-server", audioState.server);
        audioState.reader = storage.getItem(readerStorageKey(audioState.server))
            || SERVERS[audioState.server].defaultReader;
        populateReaderSelect();
        reloadCurrentAudioSource();
    });

    document.getElementById("reader-select").addEventListener("change", e => {
        audioState.reader = e.target.value;
        storage.setItem(readerStorageKey(audioState.server), audioState.reader);
        reloadCurrentAudioSource();
    });

    document.getElementById("autoadvance-toggle").addEventListener("change", e => {
        audioState.autoAdvance = e.target.checked;
        storage.setItem("quran-autoadvance", audioState.autoAdvance);
    });
}
