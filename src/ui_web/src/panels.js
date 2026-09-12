import { onOpenSurasPanel, onOpenPagePanel, onOpenSearchPanel } from "./navigation.js";
import { isConsentDialogOpen, dismissConsentDialog } from "./consent.js";
import { storage, getAndroidBridge } from "./native-bridge.js";
import { getLanguagePreference, setLanguage } from "./strings.js";

const PANEL_TRANSITION_MS = 180; // must match .overlay-panel's transition duration in style.css

const bridge = getAndroidBridge();

let panelCloseTimer = null;

function backdrop() {
    return document.getElementById("overlay-backdrop");
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
    panel.hidden = false;
    // Force layout so the browser has registered the "closed" state above
    // before the next line flips it open; otherwise both changes land in
    // the same frame and there's nothing to transition from.
    void panel.offsetWidth;
    requestAnimationFrame(() => {
        bd.classList.add("open");
        panel.classList.add("open");
    });
    panel.querySelector("input, select, button")?.focus();

    pushOverlayState();
}

export function closeAllPanels() {
    clearTimeout(panelCloseTimer);
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

    popOverlayState();
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
const PAGE_CHARS_W = 30; // same dims as css at #output
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
// Every real navigation that changes what's on screen -- opening or
// switching a panel, showing the consent dialog -- pushes a *full
// snapshot* of the resulting state ({panel, consent}) as a history
// entry. That makes a back press (hardware, gesture, or a plain
// browser's back button) just the browser's own ordinary "undo my last
// navigation": it pops exactly one real entry already sitting on the
// stack, and popstate hands back the snapshot from *before* whatever's
// being undone -- applyOverlayState() below just redraws the UI to
// match it (or closes everything, for the base/no-entry state).
//
// This replaces an earlier, more fragile design that tried to react to
// each popstate by closing something and then blindly re-pushing a
// fresh entry to "arm" the next back press: with only one shared flag,
// two panels deep couldn't be told apart from one, and re-pushing
// *inside* a popstate handler relied on that pushState() being reliably
// registered before the *next* hardware back press's canGoBack() check
// -- a real race, not just a theoretical one. Pushing one entry per
// actual navigation sidesteps both problems: there's a real, distinct
// entry for every level, so N presses undo exactly N navigations, with
// nothing to race.
//
// It's also why every "back" control in the app -- a panel's own
// in-header chevron ([data-back] below), the edition picker's back
// button (see tafsir.js) -- should call goBackInOverlay() (a thin
// history.back() wrapper) instead of directly opening a target panel:
// routing every "back" through the exact same history.back() is what
// guarantees an in-app back tap and a subsequent hardware back press can
// never disagree about what "back" means.
let restoringFromHistory = false; // true only while applyOverlayState() runs

function currentOverlayState() {
    return {
        panel: document.querySelector(".overlay-panel:not([hidden])")?.id || null,
        consent: isConsentDialogOpen(),
    };
}

// Called after any real (non-history-replay) action that opens or
// switches to a panel, or shows the consent dialog -- pushes a fresh
// snapshot of the *resulting* state on top of whatever was there before.
export function pushOverlayState() {
    if (restoringFromHistory) return;
    history.pushState(currentOverlayState(), "");
}

// Called after any real (non-history-replay), non-back action that
// *closes* something -- X button, backdrop click, Escape, resolving the
// consent dialog -- so it pops the entry that represented it being open,
// rather than pushing a new "closed" one (which would make a
// *subsequent* back press perversely reopen what was just closed here).
export function popOverlayState() {
    if (restoringFromHistory) return;
    if (history.state?.panel || history.state?.consent) history.back();
}

// The one function every in-app "back" control should call -- see the
// big comment above for why this has to be history.back() and not, say,
// openPanel(theTargetPanelId) directly.
export function goBackInOverlay() {
    history.back();
}

// Redraws the overlay UI to match a history snapshot -- from a real
// back/forward navigation's popstate event, or null for "the base page,
// nothing open". Never itself pushes/pops history; it's purely applying
// a state the browser has already navigated to.
function applyOverlayState(state) {
    restoringFromHistory = true;
    try {
        if (state?.panel) {
            openPanel(state.panel);
        } else {
            closeAllPanels();
        }
        if (isConsentDialogOpen() && !state?.consent) {
            dismissConsentDialog();
        }
        // state?.consent === true with the dialog not already open would
        // mean the user went *forward* back into it -- not a flow this
        // app's one-shot yes/no/remember consent prompt supports
        // re-entering, so there's nothing to do for that case.
    } finally {
        restoringFromHistory = false;
    }
}

window.addEventListener("popstate", e => applyOverlayState(e.state));

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

    document.getElementById("btn-menu").addEventListener("click", () => openPanel("panel-menu"));

    for (const btn of document.querySelectorAll(".menu-item[data-target]")) {
        btn.addEventListener("click", () => {
            const target = btn.dataset.target;
            openPanel(target);
            if (target === "panel-suras") onOpenSurasPanel();
            else if (target === "panel-page") onOpenPagePanel();
            else if (target === "panel-search") onOpenSearchPanel();
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
