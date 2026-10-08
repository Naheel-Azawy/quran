import { onOpenSurasPanel, resetMenuSearch } from "./navigation.js";
import { isConsentDialogOpen, dismissConsentDialog } from "./consent.js";
import { storage, getAndroidBridge } from "./native-bridge.js";
import { getLanguagePreference, setLanguage } from "./strings.js";

const PANEL_TRANSITION_MS = 180; // must match .overlay-panel's transition duration in style.css

const bridge = getAndroidBridge();

let panelCloseTimer = null;

// The one panel currently open (or opening), tracked explicitly instead
// of being sniffed back out of the DOM: during a close fade a panel is
// still un-[hidden] but no longer "current", and during an open its
// .open class is only added a frame later.
let currentPanelId = null;

function backdrop() {
    return document.getElementById("overlay-backdrop");
}

// Focus policy per panel. Panels flagged data-autofocus="fine-pointer"
// (the menu, whose first field is a search box) only focus that field
// when a mouse/trackpad is the primary input: on a phone, focusing it
// would raise the keyboard over the menu every single time it opens.
function focusPanel(panel) {
    if (panel.dataset.autofocus === "fine-pointer") {
        if (window.matchMedia("(pointer: fine)").matches) {
            panel.querySelector("input")?.focus();
        } else {
            panel.tabIndex = -1;
            panel.focus({ preventScroll: true });
        }
        return;
    }
    panel.querySelector("input, select, button")?.focus();
}

export function openPanel(id) {
    clearTimeout(panelCloseTimer);
    document.getElementById("btn-menu").classList.add("hidden");
    // Switching directly between two panels: snap-hide everything else
    // immediately rather than fading it, only the target panel animates
    // in. Leaving a "closing" panel's hidden attribute off while its fade
    // plays would leave it focusable and visible to screen readers even
    // though it's invisible.
    for (const p of document.querySelectorAll(".overlay-panel")) {
        if (p.id !== id) {
            p.classList.remove("open");
            p.hidden = true;
        }
    }

    const bd = backdrop();
    bd.hidden = false;
    const panel = document.getElementById(id);
    const changed = currentPanelId !== id;
    currentPanelId = id;
    panel.hidden = false;
    // Force layout so the browser has registered the "closed" state above
    // before the next line flips it open; otherwise both changes land in
    // the same frame and there's nothing to transition from.
    void panel.offsetWidth;
    requestAnimationFrame(() => {
        bd.classList.add("open");
        panel.classList.add("open");
    });
    focusPanel(panel);

    // Re-opening the panel that is already showing is not a navigation,
    // so it must not add a history entry (it would take an extra back
    // press to undo something that changed nothing).
    if (changed) pushOverlayState();
}

// Visual close only; history is handled by closeAllPanels() below.
function closeAllPanelsUI() {
    clearTimeout(panelCloseTimer);
    currentPanelId = null;
    const bd = backdrop();
    bd.classList.remove("open");
    document.getElementById("btn-menu").classList.remove("hidden");
    for (const p of document.querySelectorAll(".overlay-panel")) {
        p.classList.remove("open");
    }
    panelCloseTimer = setTimeout(() => {
        bd.hidden = true;
        for (const p of document.querySelectorAll(".overlay-panel")) {
            p.hidden = true;
        }
    }, PANEL_TRANSITION_MS);
}

// Closes everything (X button, backdrop tap, Escape, "navigated, done")
// and unwinds *all* history entries the overlays pushed, back to the
// base page. Returns a promise that settles once history has caught up,
// for callers that go on to do something history-sensitive (e.g. show
// the consent dialog) right after.
export function closeAllPanels() {
    closeAllPanelsUI();
    if (restoringFromHistory) return Promise.resolve();
    return enqueueHistory(() => {
        const d = overlayDepth();
        return d > 0 ? traverseHistory(-d, false) : undefined;
    });
}

// ---------- theme ----------

// Converts a getComputedStyle() color (always returned as "rgb(r, g, b)"
// or "rgba(r, g, b, a)", regardless of how the CSS itself specified it)
// into "#rrggbb" -- the format Android's Color.parseColor() understands.
// Returns null for anything that doesn't match (transparent, currentcolor
// that failed to resolve, etc.) so the caller can skip a bad update
// instead of handing Android a string it'll just throw on.
function cssColorToHex(cssColor) {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(cssColor || "");
    if (!m) return null;
    const hex = n => Number(n).toString(16).padStart(2, "0");
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

// Perceptual luminance (ITU-R BT.601 luma weights) of a "#rrggbb" color,
// 0 (black) to 1 (white) -- used to decide whether system-bar icons need
// to be drawn dark-on-light or light-on-dark. Deliberately independent of
// which *named* theme produced the color: "yellow" is a pale, light
// background and needs dark icons just as much as "white" does, so this
// looks at the actual rendered color rather than the theme name.
function relativeLuminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

let themeSyncTimer = null;

// Tells Android's system status/navigation bars (and, if the host
// activity ever grows one, its action bar) to match the theme just
// applied to <body> -- by reading the *actual rendered* colors back out
// of the page rather than hardcoding a copy of them here, so the native
// side never needs updating when style.css's theme colors change.
//
// This has to wait for body's background/color transition (if any) to
// actually finish before sampling: reading getComputedStyle() right after
// the class swap catches the *starting* color, not the target one, since
// the transition has barely begun -- which otherwise makes every switch
// report the *previous* theme, one step behind. transition-duration
// itself isn't animated, so it's safe to read immediately and use as the
// wait time. clearTimeout() guards against rapid successive switches
// leaving a stale read to fire after a newer one.
function syncNativeTheme() {
    if (!bridge) return;
    clearTimeout(themeSyncTimer);

    const body = document.body;
    const durations = getComputedStyle(body).transitionDuration
        .split(",")
        .map(s => parseFloat(s) * 1000 || 0);
    const waitMs = Math.max(0, ...durations) + 30; // small buffer past the end

    themeSyncTimer = setTimeout(() => {
        const style = getComputedStyle(body);
        const bg = cssColorToHex(style.backgroundColor);
        const fg = cssColorToHex(style.color);
        if (bg && fg) bridge.setTheme(relativeLuminance(bg) > 0.6, bg, fg);
    }, waitMs);
}

export function theme_set(name) {
    name = name.toLowerCase();
    document.body.classList.remove("light", "yellow");
    if (name == "white")  document.body.classList.add("light");
    if (name == "yellow") document.body.classList.add("yellow");
    storage.setItem("quran-theme", name);

    for (const el of document.querySelectorAll(".swatch")) {
        el.classList.toggle("active", el.dataset.theme == name);
    }

    syncNativeTheme();
}

// ---------- sizing ----------

// Single mushaf page's natural aspect ratio, in the same "chars" units
// updateFontSize uses below (28 chars wide, 46 tall). Book mode needs
// roughly double that width for the same height, so this doubles as the
// threshold for switching layouts: the available box has to be at least
// that wide *relative to its height* (with a little slack so the mode
// doesn't flip back and forth right at the edge), and wide enough in
// absolute terms that neither half-page becomes illegible.
const PAGE_CHARS_W = 31; // same dims as css at #output
const PAGE_CHARS_H = 46;
const PAGE_ASPECT  = PAGE_CHARS_W / PAGE_CHARS_H;

export function computePagesPerView() {
    const rect = document.querySelector(".pager-wrap")
          .getBoundingClientRect();
    if (rect.height <= 0) return 1;
    const wide = rect.width / rect.height >= PAGE_ASPECT * 2 * .9;
    return (wide && rect.width >= 700) ? 2 : 1;
}

export function updateFontSize(pagesPerView) {
    const charsW = pagesPerView === 2 ? PAGE_CHARS_W * 2 : PAGE_CHARS_W;
    const charsH = PAGE_CHARS_H;
    const rect = document.querySelector(".pager-wrap")
          .getBoundingClientRect();
    const size = Math.min(
        rect.width  * .99 / charsW,
        rect.height * .98 / charsH
    );
    document.getElementById("output").style.fontSize = size + "px";
}

// .page-text's `transform: scaleY(var(--quran-line-stretch, ...))` in
// style.css corrects for how compressed this app's Quran fonts' natural
// line metrics are -- Android's WebView renders that same font slightly
// differently than a desktop browser, so it needs a smaller stretch
// factor there (1.2) than desktop's default (1.3). Hardcoded rather than
// measured: set once, here, for the lifetime of the page.
document.documentElement.style.setProperty("--quran-line-stretch", bridge ? "1.2" : "1.3");

// ---------- back button (Android hardware back *and* browser back) ----------
//
// Model: the base page is history depth 0. Every real navigation that
// changes what is on screen (opening or switching a panel, showing the
// consent dialog) pushes ONE entry whose state is a snapshot of the
// resulting UI plus its depth: {panel, consent, d}. So:
//
//   * hardware/gesture/browser back = the browser's own "undo one
//     navigation"; popstate hands back the previous snapshot and
//     applyOverlayState() redraws the UI to match (user-initiated).
//   * every in-app "back" control calls goBackInOverlay(), which is the
//     same history.back(), so a tap on a chevron and a hardware back
//     press can never disagree.
//   * every "close" (X, backdrop, Escape, finishing a navigation) unwinds
//     the whole stack with a single history.go(-depth). Popping just one
//     entry here would land on the previous snapshot and redraw the menu
//     the user just dismissed, and leave stale entries behind.
//
// Because history.back()/go() complete asynchronously (popstate arrives
// later), all history operations are serialized through one promise
// queue, and each operation reads the *current* depth when it actually
// runs. That makes sequences like "dismiss consent, then close the menu"
// or "close, then immediately open something" safe: none can compute
// its offset against an entry that is about to disappear.
//
// popstate events caused by our own unwinds do not redraw anything (the
// UI was already updated first); only user-initiated ones and the
// explicit chevron-back do.
let restoringFromHistory = false; // true only while applyOverlayState() runs

const TRAVERSAL_TIMEOUT_MS = 600; // safety net if popstate never arrives

let historyQueue = Promise.resolve();
let pendingTraversal = null; // {apply, resolve} for the in-flight go()/back()

function overlayDepth() {
    return history.state?.d || 0;
}

function enqueueHistory(op) {
    historyQueue = historyQueue
        .then(op)
        .catch(e => console.warn("overlay history operation failed:", e));
    return historyQueue;
}

// Moves through history and resolves once the matching popstate has been
// seen (or the safety timeout fires). `apply` says whether that popstate
// should redraw the UI (true: UI hasn't been updated yet, e.g. chevron
// back; false: the caller already updated it, e.g. closing).
function traverseHistory(delta, apply) {
    return new Promise(resolve => {
        const entry = {
            apply,
            resolve: () => { clearTimeout(timer); resolve(); },
        };
        const timer = setTimeout(() => {
            if (pendingTraversal === entry) pendingTraversal = null;
            resolve();
        }, TRAVERSAL_TIMEOUT_MS);
        pendingTraversal = entry;
        history.go(delta);
    });
}

function currentOverlayState() {
    return {
        panel: currentPanelId,
        consent: isConsentDialogOpen(),
    };
}

// Called after any real (non-history-replay) action that opens or
// switches to a panel, or shows the consent dialog.
export function pushOverlayState() {
    if (restoringFromHistory) return;
    enqueueHistory(() => {
        history.pushState({ ...currentOverlayState(), d: overlayDepth() + 1 }, "");
    });
}

// Called when something that pushed its own entry (the consent dialog)
// is resolved by a real action: undoes exactly that one entry. The UI
// has already been updated by the caller, so the popstate is not applied.
export function popOverlayState() {
    if (restoringFromHistory) return Promise.resolve();
    return enqueueHistory(() =>
        overlayDepth() > 0 ? traverseHistory(-1, false) : undefined);
}

// The one function every in-app "back" control should call.
export function goBackInOverlay() {
    return enqueueHistory(() => {
        if (overlayDepth() > 0) return traverseHistory(-1, true);
        closeAllPanelsUI(); // history lost track of us; at least don't strand the UI
    });
}

// Redraws the overlay UI to match a history snapshot (null/base = nothing
// open). Never itself pushes or pops history.
function applyOverlayState(state) {
    restoringFromHistory = true;
    try {
        const target = state?.panel || null;
        if (target) {
            if (target !== currentPanelId) openPanel(target);
        } else if (currentPanelId || !backdrop().hidden) {
            closeAllPanelsUI();
        }
        if (isConsentDialogOpen() && !state?.consent) {
            dismissConsentDialog();
        }
        // state?.consent === true with the dialog not open would mean the
        // user went *forward* back into it -- a one-shot yes/no/remember
        // prompt can't be re-entered, so there's nothing to do.
    } finally {
        restoringFromHistory = false;
    }
}

window.addEventListener("popstate", e => {
    const p = pendingTraversal;
    pendingTraversal = null;
    if (!p || p.apply) applyOverlayState(e.state);
    p?.resolve();
});

// A reload (e.g. changing the UI language) keeps history.state, so the
// page can start "inside" an overlay entry with nothing actually open.
// Step back out to the base entry before anything else happens.
if (overlayDepth() > 0) {
    enqueueHistory(() => traverseHistory(-overlayDepth(), false));
}

// ---------- wiring ----------

export function bindPanelsUI() {
    for (const el of document.querySelectorAll(".swatch")) {
        el.addEventListener("click", () => theme_set(el.dataset.theme));
    }

    /* document.getElementById("font-select").addEventListener("change", e => {
        storage.setItem("quran-font", e.target.value);
        document.documentElement.style.setProperty("--quran-font", `"${e.target.value}"`);
    }); */

    // "system" | "ar" | "en" -- see strings.js. Guarded on the element
    // existing since it's an optional addition to whatever settings
    // markup index.html has (add e.g.
    // <select id="language-select"><option value="system">...</option>
    // <option value="ar">...</option><option value="en">...</option></select>
    // to wire this up).
    const languageSelect = document.getElementById("language-select");
    if (languageSelect) {
        languageSelect.value = getLanguagePreference();
        languageSelect.addEventListener("change", e => setLanguage(e.target.value));
    }

    document.getElementById("btn-menu").addEventListener("click", () => {
        resetMenuSearch(); // a fresh open starts on the home view, not the last query
        openPanel("panel-menu");
    });

    for (const btn of document.querySelectorAll("[data-target]")) {
        btn.addEventListener("click", () => {
            const target = btn.dataset.target;
            openPanel(target);
            if (target === "panel-suras") onOpenSurasPanel();
        });
    }

    for (const btn of document.querySelectorAll("[data-back]")) {
        btn.addEventListener("click", goBackInOverlay);
    }

    for (const btn of document.querySelectorAll("[data-close]")) {
        btn.addEventListener("click", closeAllPanels);
    }
    backdrop().addEventListener("click", closeAllPanels);

    window.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (isConsentDialogOpen()) {
            dismissConsentDialog();
        } else {
            closeAllPanels();
        }
    });
}
