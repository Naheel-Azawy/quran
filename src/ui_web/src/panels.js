import { onOpenSurasPanel, onOpenPagePanel, onOpenSearchPanel } from "./navigation.js";
import { isConsentDialogOpen, dismissConsentDialog } from "./consent.js";

const PANEL_TRANSITION_MS = 180; // must match .overlay-panel's transition duration in style.css

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
}

// ---------- theme ----------

export function theme_set(name) {
    name = name.toLowerCase();
    document.body.classList.remove("light", "yellow");
    if (name == "white")  document.body.classList.add("light");
    if (name == "yellow") document.body.classList.add("yellow");
    localStorage["quran-theme"] = name;

    for (const el of document.querySelectorAll(".swatch")) {
        el.classList.toggle("active", el.dataset.theme == name);
    }
}

// ---------- sizing ----------

// Single mushaf page's natural aspect ratio, in the same "chars" units
// updateFontSize uses below (28 chars wide, 46 tall). Book mode needs
// roughly double that width for the same height, so this doubles as the
// threshold for switching layouts: the available box has to be at least
// that wide *relative to its height* (with a little slack so the mode
// doesn't flip back and forth right at the edge), and wide enough in
// absolute terms that neither half-page becomes illegible.
const PAGE_ASPECT = 28 / 46;

export function computePagesPerView() {
    const rect = document.querySelector(".pager-wrap").getBoundingClientRect();
    if (rect.height <= 0) return 1;
    const wide = rect.width / rect.height >= PAGE_ASPECT * 2 * .9;
    return (wide && rect.width >= 700) ? 2 : 1;
}

export function updateFontSize(pagesPerView) {
    const charsW = pagesPerView === 2 ? 56 : 28; // same dims as css
    const charsH = 46;
    const rect = document.querySelector(".pager-wrap").getBoundingClientRect();
    const size = Math.min(
        rect.width  * .99 / charsW,
        rect.height * .98 / charsH
    );
    document.getElementById("output").style.fontSize = size + "px";
}

// ---------- wiring ----------

export function bindPanelsUI() {
    for (const el of document.querySelectorAll(".swatch")) {
        el.addEventListener("click", () => theme_set(el.dataset.theme));
    }

    document.getElementById("font-select").addEventListener("change", e => {
        localStorage["quran-font"] = e.target.value;
        document.documentElement.style.setProperty("--quran-font", `"${e.target.value}"`);
    });

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
        btn.addEventListener("click", () => openPanel(btn.dataset.back));
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
