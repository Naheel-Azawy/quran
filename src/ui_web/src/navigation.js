import { TOTAL_PAGES, TOTAL_SURAS, suraNames, suraAyaCount, suraOfPage, firstPageOfSura, pageOfSuraAya } from "./quran-index.js";
import { toArabicDigits } from "./text-utils.js";
import { closeAllPanels } from "./panels.js";
import { t, localizeNumber } from "./strings.js";

const MAX_SEARCH_RESULTS  = 50;
const SEARCH_DEBOUNCE_MS  = 250;

let vp     = null; // the ViewPager instance, set once it's created
let engine = null; // the quran engine, for search() and ayaText()

export function setViewPager(pager) { vp = pager; }
export function setEngine(quranEngine) { engine = quranEngine; }

function output() {
    return document.getElementById("output");
}

// Flashes the given ayah's on-page span, e.g. after landing on it from a
// search result.
export function blinkAya(sura, aya) {
    const el = output().querySelector(`.aya[data-sura="${sura}"][data-aya="${aya}"]`);
    if (!el) return;
    el.classList.remove("blink");
    void el.offsetWidth; // force reflow so a repeat blink restarts cleanly
    el.classList.add("blink");
    el.addEventListener("animationend", () => el.classList.remove("blink"), { once: true });
}

// ---------- page jump ----------

let pageInput, btnPrev, btnNext;

export function gotoPageInput() {
    const p = Number(pageInput.value) - 1;
    if (!Number.isFinite(p)) return;
    vp.goto(Math.max(0, Math.min(TOTAL_PAGES - 1, p)));
}

export function syncStatus(page, nav) {
    pageInput.value = page + 1;
    highlightActiveSura(suraOfPage[page]);
    btnPrev.disabled = !nav.hasPrev;
    btnNext.disabled = !nav.hasNext;
}

// ---------- sura index ----------

let suraList, suraFilterInput;

export function renderSuraList(filter = "") {
    const q = filter.trim();
    suraList.innerHTML = "";

    let shown = 0;
    for (let s = 0; s < TOTAL_SURAS; ++s) {
        const name = suraNames[s] || "";
        if (q && !name.includes(q) && !String(s + 1).includes(q)) continue;
        shown++;

        const li = document.createElement("li");
        li.className = "sura-item";
        li.dataset.sura = s;
        li.setAttribute("role", "option");

        const badge = document.createElement("span");
        badge.className = "sura-badge";
        badge.textContent = toArabicDigits(s + 1);

        const info = document.createElement("span");
        info.className = "sura-info";

        const nameEl = document.createElement("span");
        nameEl.className = "sura-name";
        nameEl.textContent = name;

        const meta = document.createElement("span");
        meta.className = "sura-meta";
        meta.textContent = t("navigation.ayaCount", { count: localizeNumber(suraAyaCount[s] || 0) });

        info.append(nameEl, meta);
        li.append(badge, info);
        suraList.appendChild(li);
    }

    if (!shown) {
        const empty = document.createElement("li");
        empty.className = "sura-empty";
        empty.textContent = t("navigation.noResults");
        suraList.appendChild(empty);
    }

    highlightActiveSura(suraOfPage[globalThis.page]);
}

export function highlightActiveSura(sura) {
    for (const el of suraList.querySelectorAll(".sura-item")) {
        el.classList.toggle("active", Number(el.dataset.sura) === sura);
    }
}

export function scrollActiveSuraIntoView() {
    const el = suraList.querySelector(".sura-item.active");
    if (el) el.scrollIntoView({ block: "center" });
}

// Called by panels.js when the corresponding menu item opens its panel.
export function onOpenSurasPanel() {
    suraFilterInput.value = "";
    renderSuraList("");
    requestAnimationFrame(() => {
        suraFilterInput.focus();
        scrollActiveSuraIntoView();
    });
}

export function onOpenPagePanel() {
    pageInput.focus();
    pageInput.select();
}

export function onOpenSearchPanel() {
    searchInput.focus();
}

// ---------- search ----------

let searchInput, searchResults;

function runSearch() {
    searchResults.innerHTML = "";
    const q = searchInput.value.trim();
    if (!q) return;

    const matches = engine.search(q, true);
    const shown = matches.slice(0, MAX_SEARCH_RESULTS);

    const note = document.createElement("li");
    note.className = "result-note";
    note.textContent = matches.length > shown.length
        ? t("navigation.searchResultsTruncated", { shown: localizeNumber(shown.length), total: localizeNumber(matches.length) })
        : t("navigation.searchResultsCount", { count: localizeNumber(matches.length) });
    searchResults.appendChild(note);

    shown.forEach(({ sura, aya }, i) => {
        const li = document.createElement("li");
        li.className = "result-item";
        li.style.setProperty("--i", Math.min(i, 12));

        const label = document.createElement("div");
        label.className = "result-label";
        label.textContent = `${suraNames[sura]} ﴿${toArabicDigits(aya + 1)}﴾`;

        const text = document.createElement("div");
        text.className = "result-text";
        text.textContent = engine.ayaText(sura, aya, globalThis.simple);

        li.append(label, text);
        li.addEventListener("click", () => {
            vp.goto(pageOfSuraAya(sura, aya));
            closeAllPanels();
            setTimeout(() => blinkAya(sura, aya), vp.transitionSpeed + 50);
        });
        searchResults.appendChild(li);
    });
}

// DOM refs are cached separately from event wiring: renderSuraList() (and
// syncStatus/gotoPageInput) need suraList/pageInput/etc. to exist before
// the ViewPager is even created, well before bindNavigationUI() below
// runs and attaches the actual event listeners.
export function cacheNavigationDom() {
    pageInput  = document.getElementById("page-input");
    btnPrev    = document.getElementById("btn-prev");
    btnNext    = document.getElementById("btn-next");

    suraList        = document.getElementById("sura-list");
    suraFilterInput = document.getElementById("sura-filter");

    searchInput   = document.getElementById("search-input");
    searchResults = document.getElementById("search-results");
}

export function bindNavigationUI() {
    suraList.addEventListener("click", e => {
        const li = e.target.closest(".sura-item");
        if (!li) return;
        vp.goto(firstPageOfSura(Number(li.dataset.sura)));
        closeAllPanels();
    });

    suraFilterInput.addEventListener("input", () => renderSuraList(suraFilterInput.value));

    document.getElementById("btn-page-go").addEventListener("click", () => {
        gotoPageInput();
        closeAllPanels();
    });

    pageInput.addEventListener("change", gotoPageInput);
    pageInput.addEventListener("keydown", e => {
        if (e.key === "Enter") { gotoPageInput(); pageInput.blur(); closeAllPanels(); }
    });

    // auto-selects page number text
    pageInput.addEventListener("focus", () => pageInput.select());
    pageInput.addEventListener("mouseup", e => e.preventDefault());

    btnPrev.addEventListener("click", () => vp.prev());
    btnNext.addEventListener("click", () => vp.next());

    let searchTimer = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
    });
    searchInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            clearTimeout(searchTimer);
            runSearch();
        }
    });
}
