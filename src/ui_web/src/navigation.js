import { TOTAL_PAGES, TOTAL_SURAS, suraNames, suraAyaCount, suraOfPage, indexEntries, firstPageOfSura, pageOfSuraAya } from "./quran-index.js";
import { toArabicDigits, fromArabicDigits } from "./text-utils.js";
import { closeAllPanels } from "./panels.js";
import { t, localizeNumber } from "./strings.js";

const MAX_SEARCH_RESULTS  = 50;
const SEARCH_DEBOUNCE_MS  = 200;
const MAX_SURA_MATCHES    = 4;

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

// ---------- page jump (number box + slider in the menu) ----------

let pageInput, pageSlider, suraNameEl, btnPrev, btnNext;

export function gotoPageInput() {
    const p = Number(pageInput.value) - 1;
    if (!Number.isFinite(p)) return;
    vp.goto(Math.max(0, Math.min(TOTAL_PAGES - 1, p)));
}

export function syncStatus(page, nav) {
    pageInput.value  = page + 1;
    pageSlider.value = page + 1;
    suraNameEl.textContent = suraNames[suraOfPage[page]] || "";
    highlightActiveSura(suraOfPage[page]);
    btnPrev.disabled = !nav.hasPrev;
    btnNext.disabled = !nav.hasNext;
}

// ---------- sura index ----------

let suraList, suraFilterInput;

function juzuLabel(juzu) {
    return t("navigation.juzu", { n: localizeNumber(juzu + 1) });
}

function suraListItem(entry) {
    const s = entry.number;

    const li = document.createElement("li");
    li.className = "sura-item";
    li.dataset.sura = s;
    li.dataset.page = entry.page;
    li.setAttribute("role", "option");

    const badge = document.createElement("span");
    badge.className = "sura-badge";
    badge.textContent = toArabicDigits(s + 1);

    const info = document.createElement("span");
    info.className = "sura-info";

    const nameEl = document.createElement("span");
    nameEl.className = "sura-name";
    nameEl.textContent = suraNames[s] || "";

    const meta = document.createElement("span");
    meta.className = "sura-meta";
    meta.textContent = t("navigation.ayaCount", { count: localizeNumber(suraAyaCount[s] || 0) });

    info.append(nameEl, meta);
    li.append(badge, info);
    return li;
}

// A juzu is a row between the suras, at the page where it starts.
function juzuListItem(entry) {
    const li = document.createElement("li");
    li.className = "juzu-item";
    li.dataset.juzu = entry.number;
    li.dataset.page = entry.page;
    li.setAttribute("role", "option");

    const nameEl = document.createElement("span");
    nameEl.className = "juzu-name";
    nameEl.textContent = juzuLabel(entry.number);

    const meta = document.createElement("span");
    meta.className = "juzu-meta";
    meta.textContent = t("navigation.pageNumber", { page: localizeNumber(entry.page + 1) });

    li.append(nameEl, meta);
    return li;
}

function indexEntryMatches(entry, q) {
    if (!q) return true;
    const text = entry.kind === "juzu" ? juzuLabel(entry.number) : (suraNames[entry.number] || "");
    return text.includes(q) || String(entry.number + 1).includes(q);
}

// Suras and juzus in the page order the engine gives them.
export function renderSuraList(filter = "") {
    const q = filter.trim();
    suraList.innerHTML = "";

    let shown = 0;
    for (const entry of indexEntries) {
        if (!indexEntryMatches(entry, q)) continue;
        shown++;
        suraList.appendChild(entry.kind === "juzu" ? juzuListItem(entry) : suraListItem(entry));
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
        // on touch devices focusing would raise the keyboard over the list
        if (window.matchMedia("(pointer: fine)").matches) suraFilterInput.focus();
        scrollActiveSuraIntoView();
    });
}

// ---------- unified search (lives in the menu panel) ----------
//
// One box handles all three "go somewhere" intents:
//   - a number            -> that page (and the sura with that number)
//   - text matching a sura name -> that sura
//   - any text            -> full-text ayah search
// Results replace the menu's home view while there is a query and every
// result closes the whole overlay stack after navigating.

let searchInput, searchResults, menuHome, menuPanel;

// Loose matching for sura names: ignore diacritics/tatweel and fold the
// common letter variants so "الفاتحه" or "ال عمران" still find their sura.
function normalizeArabic(s) {
    return String(s)
        .replace(/&nbsp;/g, " ")
        .normalize("NFKD")
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ")
        .trim();
}

function goTo(page, blink) {
    vp.goto(page);
    closeAllPanels();
    if (blink) setTimeout(() => blinkAya(blink.sura, blink.aya), vp.transitionSpeed + 50);
}

function appendResult(li, i) {
    li.style.setProperty("--i", Math.min(i, 12));
    searchResults.appendChild(li);
}

function pageResultItem(pageNumber) {
    const li = document.createElement("li");
    li.className = "result-item result-goto";
    li.dataset.goto = "page";
    const label = document.createElement("div");
    label.className = "result-label";
    label.textContent = t("navigation.gotoPage", { page: localizeNumber(pageNumber) });
    li.appendChild(label);
    li.addEventListener("click", () => goTo(pageNumber - 1));
    return li;
}

function suraResultItem(sura) {
    const li = document.createElement("li");
    li.className = "sura-item result-goto";
    li.dataset.goto = "sura";

    const badge = document.createElement("span");
    badge.className = "sura-badge";
    badge.textContent = toArabicDigits(sura + 1);

    const info = document.createElement("span");
    info.className = "sura-info";
    const nameEl = document.createElement("span");
    nameEl.className = "sura-name";
    nameEl.textContent = suraNames[sura];
    const meta = document.createElement("span");
    meta.className = "sura-meta";
    meta.textContent = t("navigation.ayaCount", { count: localizeNumber(suraAyaCount[sura] || 0) });
    info.append(nameEl, meta);

    li.append(badge, info);
    li.addEventListener("click", () => goTo(firstPageOfSura(sura)));
    return li;
}

function showSearchView(active) {
    searchResults.hidden = !active;
    menuHome.hidden = active;
    menuPanel.classList.toggle("searching", active);
}

function runSearch() {
    searchResults.innerHTML = "";
    const raw = searchInput.value.trim();
    if (!raw) { showSearchView(false); return; }
    showSearchView(true);

    let n = 0;
    const digits = fromArabicDigits(raw);
    const isNumber = /^\d{1,3}$/.test(digits);

    if (isNumber) {
        const num = Number(digits);
        if (num >= 1 && num <= TOTAL_PAGES) appendResult(pageResultItem(num), n++);
        if (num >= 1 && num <= TOTAL_SURAS) appendResult(suraResultItem(num - 1), n++);
        if (!n) {
            const empty = document.createElement("li");
            empty.className = "result-note";
            empty.textContent = t("navigation.noResults");
            searchResults.appendChild(empty);
        }
        return; // digits are never worth a full-text search
    }

    const nq = normalizeArabic(raw);
    let suraHits = 0;
    for (let s = 0; s < TOTAL_SURAS && suraHits < MAX_SURA_MATCHES; ++s) {
        if (normalizeArabic(suraNames[s] || "").includes(nq)) {
            appendResult(suraResultItem(s), n++);
            suraHits++;
        }
    }

    const matches = engine.search(raw, true);
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

        const label = document.createElement("div");
        label.className = "result-label";
        label.textContent = `${suraNames[sura]} ﴿${toArabicDigits(aya + 1)}﴾`;

        const text = document.createElement("div");
        text.className = "result-text";
        text.textContent = engine.ayaText(sura, aya, globalThis.simple);

        li.append(label, text);
        li.addEventListener("click", () => goTo(pageOfSuraAya(sura, aya), { sura, aya }));
        appendResult(li, n + i);
    });
}

// Back to the menu's home view with an empty box. Called when the menu is
// opened from the main view (not when history restores it, so going back
// from the index to the menu keeps whatever the user had typed).
export function resetMenuSearch() {
    clearTimeout(searchTimer);
    searchInput.value = "";
    searchResults.innerHTML = "";
    showSearchView(false);
}

let searchTimer = null;

// DOM refs are cached separately from event wiring: renderSuraList() (and
// syncStatus/gotoPageInput) need suraList/pageInput/etc. to exist before
// the ViewPager is even created, well before bindNavigationUI() below
// runs and attaches the actual event listeners.
export function cacheNavigationDom() {
    pageInput   = document.getElementById("page-input");
    pageSlider  = document.getElementById("page-slider");
    suraNameEl  = document.getElementById("menu-sura-name");
    btnPrev     = document.getElementById("btn-prev");
    btnNext    = document.getElementById("btn-next");

    suraList        = document.getElementById("sura-list");
    suraFilterInput = document.getElementById("sura-filter");

    searchInput   = document.getElementById("menu-search");
    searchResults = document.getElementById("menu-results");
    menuHome      = document.getElementById("menu-home");
    menuPanel     = document.getElementById("panel-menu");
}

export function bindNavigationUI() {
    suraList.addEventListener("click", e => {
        const li = e.target.closest(".sura-item, .juzu-item");
        if (!li) return;
        vp.goto(Number(li.dataset.page));
        closeAllPanels();
    });

    suraFilterInput.addEventListener("input", () => renderSuraList(suraFilterInput.value));

    pageInput.addEventListener("change", gotoPageInput);
    pageInput.addEventListener("keydown", e => {
        if (e.key === "Enter") { gotoPageInput(); pageInput.blur(); closeAllPanels(); }
    });

    // auto-selects page number text
    pageInput.addEventListener("focus", () => pageInput.select());
    pageInput.addEventListener("mouseup", e => e.preventDefault());

    // Dragging only previews the number; the page turns on release, so a
    // long drag doesn't render hundreds of pages on the way.
    pageSlider.addEventListener("input", () => { pageInput.value = pageSlider.value; });
    pageSlider.addEventListener("change", () => vp.goto(Number(pageSlider.value) - 1));

    btnPrev.addEventListener("click", () => vp.prev());
    btnNext.addEventListener("click", () => vp.next());

    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
    });
    searchInput.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        clearTimeout(searchTimer);
        runSearch();
        // a typed page/sura number + Enter just goes there
        if (/^\d{1,3}$/.test(fromArabicDigits(searchInput.value.trim()))) {
            searchResults.querySelector("[data-goto]")?.click();
        }
    });
}
