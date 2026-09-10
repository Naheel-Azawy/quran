import { injectIcons } from "./icons.js";
import { loadQuranEngine } from "./quran-engine.js";
import {
    TOTAL_PAGES, buildIndex, buildGlobalAyahIndex,
    suraNames, suraAyaCount, pageOfSuraAya, stepAya,
} from "./quran-index.js";
import { loadRenderAssets, render } from "./render.js";
import ViewPager from "./viewpager.js";
import { toArabicDigits } from "./text-utils.js";
import { initConsentDialog } from "./consent.js";
import * as audio from "./audio.js";
import * as tafsir from "./tafsir.js";
import { openPanel, theme_set, computePagesPerView, updateFontSize, bindPanelsUI } from "./panels.js";
import {
    renderSuraList, syncStatus, bindNavigationUI, cacheNavigationDom,
    setViewPager as setNavViewPager, setEngine as setNavEngine,
} from "./navigation.js";

async function handle_pwa() {
    if ("serviceWorker" in navigator) {
        try {
            const reg = await navigator.serviceWorker.register("sw.js");
            console.log("SW registered: ", reg);
        } catch (e) {
            console.log("SW registration failed: ", e);
        }
    }
}

async function loadFont() {
    const font = localStorage["quran-font"] || "me_quran";
    if (document.fonts) {
        await document.fonts.load(`13px "${font}"`);
    }
    document.getElementById("font-select").value = font;
    document.documentElement.style.setProperty("--quran-font", `"${font}"`);
}

// ---------- aya detail ----------

let ayaShown = null; // {sura, aya} last opened in panel-aya, for btn-play-from-aya

function showAya(sura, aya) {
    ayaShown = { sura, aya };
    tafsir.resetAyaEditionChoice();
    updateAyaPanelContent();
    openPanel("panel-aya");
}

function stepShownAya(delta) {
    if (!ayaShown) return;
    const loc = stepAya(ayaShown.sura, ayaShown.aya, delta);
    if (!loc) return;
    ayaShown = loc;
    updateAyaPanelContent();
}

// Redraws panel-aya's contents for whichever {sura, aya} is currently
// shown, without touching the panel's own open/close state -- used both
// by showAya() (first open) and by the in-panel prev/next buttons (which
// should update in place, not re-trigger the open animation).
function updateAyaPanelContent() {
    if (!ayaShown) return;
    const { sura, aya } = ayaShown;

    document.getElementById("aya-title").textContent =
        `${suraNames[sura]} ﴿${toArabicDigits(aya + 1)}﴾`;
    document.getElementById("aya-text").textContent =
        engineRef.ayaText(sura, aya, globalThis.simple);
    document.getElementById("aya-nav-label").textContent =
        `${toArabicDigits(aya + 1)} / ${toArabicDigits(suraAyaCount[sura] || 0)}`;

    if (tafsir.hasAyaEditionChoice()) {
        tafsir.loadTafsirForShown();
    } else {
        document.getElementById("aya-tafsir-section").hidden = true;
    }
}

let engineRef = null; // set once loadQuranEngine() resolves, read by updateAyaPanelContent

async function main() {
    injectIcons();
    cacheNavigationDom();

    const output = document.getElementById("output");
    output.innerHTML = "<h2>تحميل...</h2>";

    // quran.wasm is built directly into build/web/ by the top-level
    // Makefile's emcc rule (see build/web/quran.wasm), not shipped as a
    // webpack-managed static resource -- fetch it from the site root.
    const engine = await loadQuranEngine("quran.wasm");
    engineRef = engine;

    await loadRenderAssets();
    initConsentDialog();

    // ---------- initial state ----------

    globalThis.page = localStorage["quran-page"] !== undefined
        ? Number(localStorage["quran-page"]) : 0;
    globalThis.simple = localStorage["quran-simple"] !== undefined
        ? localStorage["quran-simple"] == "true" : false;

    tafsir.setAyaProvider(() => ayaShown);

    // ---------- build index, then wire everything up ----------

    output.innerHTML = "<h2>تجهيز الفهرس...</h2>";
    await new Promise(r => requestAnimationFrame(r)); // let the message paint
    buildIndex(engine);
    buildGlobalAyahIndex();

    setNavEngine(engine);
    renderSuraList();
    audio.populateServerSelect();
    audio.populateReaderSelect();
    tafsir.populateTafsirServerSelect();
    await tafsir.initTafsirEditionDefault();
    document.getElementById("autoadvance-toggle").checked = audio.audioState.autoAdvance;
    audio.updateAudioUI();

    theme_set(localStorage["quran-theme"] || "black");
    handle_pwa();

    let pagesPerView = computePagesPerView();
    output.classList.toggle("two-page", pagesPerView === 2);
    updateFontSize(pagesPerView);
    await loadFont();
    document.getElementById("simple-toggle").checked = globalThis.simple;
    output.innerHTML = "";

    const vp = new ViewPager({
        parent:       output,
        initPage:     globalThis.page,
        totalPages:   TOTAL_PAGES,
        pagesPerView: pagesPerView,
        pageRenderer: index => {
            const div = render(engine, index, globalThis.simple);
            requestAnimationFrame(audio.applyPlayingHighlight);
            return div;
        },
        onChange: (page, nav) => {
            page = Math.max(0, Math.min(TOTAL_PAGES - 1, page));
            globalThis.page = page;
            localStorage["quran-page"] = page;
            syncStatus(page, nav);

            if (!audio.consumeProgrammaticNav() && audio.audioState.sura != null) {
                // a real user navigation (swipe, prev/next page, sura
                // select, page jump, search result...): follow only if it
                // happens to land them back on the playing page
                audio.setFollowPlayback(vp.isVisible(pageOfSuraAya(audio.audioState.sura, audio.audioState.aya)));
            }
        },
    });

    audio.setViewPager(vp);
    setNavViewPager(vp);

    output.addEventListener("click", e => {
        const el = e.target.closest(".aya");
        if (el) showAya(Number(el.dataset.sura), Number(el.dataset.aya));
    });

    bindPanelsUI();
    bindNavigationUI();
    audio.bindAudioUI();
    tafsir.bindTafsirUI();

    document.getElementById("simple-toggle").addEventListener("change", e => {
        globalThis.simple = e.target.checked;
        localStorage["quran-simple"] = globalThis.simple;
        vp.reload();
    });

    document.getElementById("btn-aya-prev").addEventListener("click", () => stepShownAya(-1));
    document.getElementById("btn-aya-next").addEventListener("click", () => stepShownAya(1));
    document.getElementById("btn-play-from-aya").addEventListener("click", () => {
        if (ayaShown) audio.playAya(ayaShown.sura, ayaShown.aya);
    });

    window.addEventListener("keydown", event => {
        if (document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
            return;
        }
        switch (event.key) {
        case "ArrowLeft":  vp.next(); break;
        case "ArrowRight": vp.prev(); break;
        }
    });

    window.addEventListener("resize", () => {
        if (document.activeElement && document.activeElement.id == "page-input") {
            return;
        }
        const newPagesPerView = computePagesPerView();
        if (newPagesPerView !== pagesPerView) {
            pagesPerView = newPagesPerView;
            output.classList.toggle("two-page", pagesPerView === 2);
            vp.setPagesPerView(pagesPerView);
        }
        updateFontSize(pagesPerView);
        vp.reload();
    });

    // handy for debugging from devtools
    Object.assign(globalThis, { vp, search: engine.search });
}

main();
