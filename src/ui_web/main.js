async function main() {
    const SIZEOF_WCHAR_T     = 4;
    const SIZEOF_QURAN_LOC_T = 2;
    const TOTAL_PAGES        = 604;
    const TOTAL_SURAS        = 114;
    const LINES_PER_PAGE     = 16;
    const MAX_SEARCH_RESULTS = 50;
    const SEARCH_DEBOUNCE_MS = 250;
    const PANEL_TRANSITION_MS = 180; // must match .overlay-panel's transition duration in style.css

    const output = document.getElementById("output");
    output.innerHTML = "<h2>تحميل...</h2>";

    const {
        memory, malloc, free,
        quran_printer_init,
        swprint_page, quran_read, quran_read_wchar, quran_search_locs,
    } = await loadWasm("quran.wasm");

    quran_printer_init();

    // ---------- low-level wasm bridges ----------

    function get_page(page, simple = false, just = true) {
        const ptr = malloc(2048 * SIZEOF_WCHAR_T);
        swprint_page(ptr, page, simple, just);
        const str = decodeWchar32(memory, ptr);
        free(ptr);
        return str;
    }

    function get_aya(sura, aya, simple = false) {
        sura = Number(sura), aya = Number(aya);
        const len = quran_read(sura, aya, null);
        const ptr = malloc(SIZEOF_WCHAR_T * (len + 1));
        const len_real = quran_read_wchar(sura, aya, ptr, len, simple);
        // quran_read_wchar does not null-terminate. decodeWchar32 scans
        // for a terminator to know where to stop, so without one it
        // reads into whatever heap garbage follows -- occasionally a
        // value outside the Unicode range, which throws. The +1 slot in
        // the malloc above exists for exactly this; write it.
        new Uint32Array(memory.buffer, ptr, len + 1)[len_real] = 0;
        const str = decodeWchar32(memory, ptr).slice(0, len_real) + ` {${aya + 1}}`;
        free(ptr);
        return str;
    }

    // get_aya's trailing "{N}" marker is meant for tag_ayas' page markup,
    // not for display; strip it wherever the aya text is shown directly
    function ayaText(sura, aya, simple) {
        return get_aya(sura, aya, simple).replace(/\s*\{\d+\}\s*$/, "");
    }

    function locDecode(loc) {
        // matches QURAN_LOC(sura, aya) = (sura << 9) | aya
        return { sura: loc >> 9, aya: loc & 0x1FF };
    }

    function search(target, simple = true) {
        const target_w = [...target].map(c => c.codePointAt(0));
        target_w.push(0);
        const target_ptr = malloc(target_w.length * SIZEOF_WCHAR_T);
        new Uint32Array(memory.buffer).set(target_w, target_ptr / 4);

        // first run to get the match count, second to fill the buffer
        let matches = quran_search_locs(null, target_ptr, simple);
        const ptr = malloc(SIZEOF_QURAN_LOC_T * matches);
        matches = quran_search_locs(ptr, target_ptr, simple);

        const locs = new Uint16Array(memory.buffer, ptr, matches);
        const arr = Array.from(locs, locDecode);

        free(ptr);
        free(target_ptr);
        return arr;
    }

    // ---------- header text parsing ----------

    function parseHeaderLine(line) {
        return line.split(/  +/).map(s => s.trim()).filter(Boolean);
    }

    // Reads "سورة <name> <num>" whether it comes from the top-of-page
    // header or a mid-page "--{ ... }--" marker; both use this exact shape.
    function parseSuraLabel(text) {
        const m = text.trim().match(/سورة\s+(.+) (\d+)$/);
        return { name: m[1], sura: Number(m[2]) - 1 };
    }

    function toArabicDigits(str) {
        return [...String(str)]
            .map(d => String.fromCharCode(d.charCodeAt(0) + 0x0660 - 0x0030))
            .join("");
    }

    // ---------- sura/page index ----------
    //
    // No wasm export gives us sura->page or aya->page directly, so this
    // builds the mapping once at startup by reading every page's own
    // header and aya markers (the same markers tag_ayas already parses
    // for on-page rendering). just=false skips justification, which only
    // pads spacing and never changes line breaks or marker positions, so
    // this is a cheap, exact stand-in for the fully rendered page here.

    let suraNames  = new Array(TOTAL_SURAS).fill("");
    let suraOfPage = new Array(TOTAL_PAGES).fill(0);
    let pageOfLoc  = new Map();

    function buildIndex() {
        for (let p = 0; p < TOTAL_PAGES; ++p) {
            try {
                const lines = get_page(p, false, false).split("\n");
                let { name, sura } = parseSuraLabel(parseHeaderLine(lines[0])[0]);
                suraNames[sura]  = name;
                suraOfPage[p]    = sura;

                const body = lines.slice(1).join("\n");
                const markerRe = /--\{([^}]+)\}--|\{(\d+)\}/g;
                let m;
                while ((m = markerRe.exec(body))) {
                    if (m[1]) {
                        ({ name, sura } = parseSuraLabel(m[1]));
                        suraNames[sura] = name;
                    } else {
                        const aya = Number(m[2]) - 1;
                        pageOfLoc.set((sura << 9) | aya, p);
                    }
                }
            } catch (e) {
                console.warn(`Could not index page ${p}:`, e);
            }
        }
    }

    function firstPageOfSura(sura) {
        return pageOfLoc.get(sura << 9) ?? 0;
    }

    function pageOfSuraAya(sura, aya) {
        return pageOfLoc.get((sura << 9) | aya) ?? 0;
    }

    // ---------- page rendering ----------

    function mk_header(line) {
        const [suraText, pageText, juzuText] = parseHeaderLine(line);
        const { sura } = parseSuraLabel(suraText);
        const html =
              '<table class="header"><tr>' +
              `<td>${suraText}</td>` +
              `<td>${pageText}</td>` +
              `<td>${juzuText}</td>` +
              '</tr></table>';
        return [html, sura];
    }

    function tag_ayas(input, sura) {
        const parts = [];
        let lastIndex = 0;

        const regex = /--\{([^}]+)\}--|\{(\d+)\}/g;
        let match;

        while ((match = regex.exec(input)) !== null) {
            const start = match.index;

            if (match[1]) {
                // Header match: --{ some header }--
                let segment = match[0];
                if (start > lastIndex) {
                    const textBefore = input.slice(lastIndex, start);
                    if (textBefore.trim()) {
                        segment = textBefore + segment;
                    }
                }

                const nlIndex = input.indexOf("\n", regex.lastIndex) + 1;
                if (nlIndex > 0) {
                    segment += input.slice(regex.lastIndex, nlIndex);
                    regex.lastIndex = nlIndex;
                } else {
                    // sura name is at the bottom of the page
                    segment += input.slice(regex.lastIndex, input.length);
                    regex.lastIndex = input.length;
                }
                segment = segment.replace("--{", "").replace("}--", "");
                sura = parseSuraLabel(match[1].replace(/&nbsp;/g, " ")).sura;
                parts.push(`<span class="sura" data-sura="${sura}">${segment}</span>`);

            } else if (match[2]) {
                // Numbered marker: {1}, {2}, etc.
                const aya = match[2] - 1;
                if (aya == 0 && sura != 0 && sura != 8) {
                    // shift bismillah
                    const nlIndex = input.indexOf("\n", lastIndex) + 1;
                    if (nlIndex > 0) {
                        parts.push(input.slice(lastIndex, nlIndex));
                        lastIndex = nlIndex;
                    }
                }
                const nbspIndex = input.indexOf("\n", regex.lastIndex) + 1;
                if (nbspIndex > 0) {
                    const rest = input.slice(regex.lastIndex, nbspIndex)
                          .replace(/&nbsp;/g, "").trim();
                    if (!rest) {
                        regex.lastIndex = nbspIndex;
                    }
                }
                const end = regex.lastIndex;
                const segment = input.slice(lastIndex, end);
                parts.push(`<span class="aya" data-aya="${aya}" data-sura="${sura}">${segment}</span>`);
            }

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < input.length) {
            const rest = input.slice(lastIndex);
            if (rest.trim()) {
                parts.push(rest);
            }
        }

        return parts.join('');
    }

    function render(page) {
        const lines = get_page(page, globalThis.simple).split("\n");
        const [header, sura] = mk_header(lines[0]);

        // TODO: pages 0-1 render extra lines that don't belong on the
        // page; cut them off here until that's fixed upstream
        let body = lines.slice(1, page <= 1 ? 9 : LINES_PER_PAGE);

        // non-breaking spaces if the line is centered (starts with a space)
        body = body.map(l => l[0] == ' ' ? l.replace(/ /g, "&nbsp;") : l);
        body = tag_ayas(body.join("\n"), sura).split("\n");
        body = body.map(l => `${l}<br>`).join("\n");
        body = body.replace(/\{(\d+)\}/g, (_, num) => `﴿${toArabicDigits(num)}﴾`);

        const lineCount = (body.match(/<br\s*\/?>/gi) || []).length;
        if (lineCount < LINES_PER_PAGE) {
            body += "<br>".repeat(LINES_PER_PAGE - lineCount);
        }

        const div = document.createElement("div");
        div.className = "page";
        div.innerHTML = `${header}<div class="page-text">${body}</div>`;
        return div;
    }

    // ---------- navigation ----------

    const suraSelect = document.getElementById("sura-select");
    const pageInput  = document.getElementById("page-input");
    const btnPrev    = document.getElementById("btn-prev");
    const btnNext    = document.getElementById("btn-next");

    function populateSuraSelect() {
        suraSelect.innerHTML = "";
        for (let s = 0; s < TOTAL_SURAS; ++s) {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = `${s + 1}. ${suraNames[s]}`;
            suraSelect.appendChild(opt);
        }
    }

    function gotoPageInput() {
        const p = Number(pageInput.value) - 1;
        if (!Number.isFinite(p)) return;
        vp.goto(Math.max(0, Math.min(TOTAL_PAGES - 1, p)));
    }

    function syncToolbar(page) {
        pageInput.value = page + 1;
        suraSelect.value = suraOfPage[page];
        btnPrev.disabled = page <= 0;
        btnNext.disabled = page >= TOTAL_PAGES - 1;
    }

    // ---------- search ----------

    const searchInput   = document.getElementById("search-input");
    const searchResults = document.getElementById("search-results");

    function runSearch() {
        searchResults.innerHTML = "";
        const q = searchInput.value.trim();
        if (!q) return;

        const matches = search(q, true);
        const shown = matches.slice(0, MAX_SEARCH_RESULTS);

        const note = document.createElement("li");
        note.className = "result-note";
        note.textContent = matches.length > shown.length
            ? `أول ${shown.length} من ${matches.length} نتيجة`
            : `${matches.length} نتيجة`;
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
            text.textContent = ayaText(sura, aya, globalThis.simple);

            li.append(label, text);
            li.addEventListener("click", () => {
                vp.goto(pageOfSuraAya(sura, aya));
                closeAllPanels();
                setTimeout(() => blinkAya(sura, aya), vp.transitionSpeed + 50);
            });
            searchResults.appendChild(li);
        });
    }

    // ---------- aya detail ----------

    function showAya(sura, aya) {
        document.getElementById("aya-title").textContent =
            `${suraNames[sura]} ﴿${toArabicDigits(aya + 1)}﴾`;
        document.getElementById("aya-text").textContent =
            ayaText(sura, aya, globalThis.simple);
        openPanel("panel-aya");
    }

    function blinkAya(sura, aya) {
        const el = output.querySelector(`.aya[data-sura="${sura}"][data-aya="${aya}"]`);
        if (!el) return;
        el.classList.remove("blink");
        void el.offsetWidth; // force reflow so a repeat blink restarts cleanly
        el.classList.add("blink");
        el.addEventListener("animationend", () => el.classList.remove("blink"), { once: true });
    }

    // ---------- settings ----------

    function theme_set(name) {
        name = name.toLowerCase();
        document.body.classList.remove("light", "yellow");
        if (name == "white")  document.body.classList.add("light");
        if (name == "yellow") document.body.classList.add("yellow");
        localStorage["quran-theme"] = name;

        for (const el of document.querySelectorAll(".swatch")) {
            el.classList.toggle("active", el.dataset.theme == name);
        }
    }

    // ---------- overlay panels ----------

    const backdrop = document.getElementById("overlay-backdrop");

    let panelCloseTimer = null;

    function openPanel(id) {
        clearTimeout(panelCloseTimer);
        // Switching directly between two panels: snap-hide everything
        // else immediately rather than fading it, only the target panel
        // animates in. Leaving a "closing" panel's hidden attribute off
        // while its fade plays would leave it focusable and visible to
        // screen readers even though it's invisible.
        for (const p of document.querySelectorAll(".overlay-panel")) {
            if (p.id !== id) {
                p.classList.remove("open");
                p.hidden = true;
            }
        }

        backdrop.hidden = false;
        const panel = document.getElementById(id);
        panel.hidden = false;
        // Force layout so the browser has registered the "closed" state
        // above before the next line flips it open; otherwise both
        // changes land in the same frame and there's nothing to
        // transition from.
        void panel.offsetWidth;
        requestAnimationFrame(() => {
            backdrop.classList.add("open");
            panel.classList.add("open");
        });
        panel.querySelector("input, select, button")?.focus();
    }

    function closeAllPanels() {
        clearTimeout(panelCloseTimer);
        backdrop.classList.remove("open");
        for (const p of document.querySelectorAll(".overlay-panel")) {
            p.classList.remove("open");
        }
        panelCloseTimer = setTimeout(() => {
            backdrop.hidden = true;
            for (const p of document.querySelectorAll(".overlay-panel")) {
                p.hidden = true;
            }
        }, PANEL_TRANSITION_MS);
    }

    // ---------- sizing ----------

    const pagerWrap = document.querySelector(".pager-wrap");

    function updateFontSize() {
        const charsW = 30 + 2 * .5; // 30em + 2 * .5em padding left and right
        const charsH = 46;
        const rect = pagerWrap.getBoundingClientRect();
        const size = Math.min(
            rect.width  * .99 / charsW,
            rect.height * .90 / charsH
        );
        output.style.fontSize = size + "px";
    }

    // ---------- pwa ----------

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

    // ---------- initial state ----------

    globalThis.page = localStorage["quran-page"] !== undefined
        ? Number(localStorage["quran-page"]) : 0;
    globalThis.simple = localStorage["quran-simple"] !== undefined
        ? localStorage["quran-simple"] == "true" : false;

    async function loadFont() {
        const font = localStorage["quran-font"] || "me_quran";
        if (document.fonts) {
            await document.fonts.load(`13px "${font}"`);
        }
        document.getElementById("font-select").value = font;
        document.documentElement.style.setProperty("--quran-font", `"${font}"`);
    }

    // ---------- build index, then wire everything up ----------

    output.innerHTML = "<h2>تجهيز الفهرس...</h2>";
    await new Promise(r => requestAnimationFrame(r)); // let the message paint
    buildIndex();
    populateSuraSelect();

    theme_set(localStorage["quran-theme"] || "black");
    handle_pwa();
    updateFontSize();
    await loadFont();
    document.getElementById("simple-toggle").checked = globalThis.simple;
    output.innerHTML = "";

    const vp = new ViewPager({
        parent:       output,
        initPage:     globalThis.page,
        totalPages:   TOTAL_PAGES,
        pageRenderer: index => render(index),
        onChange: page => {
            page = Math.max(0, Math.min(TOTAL_PAGES - 1, page));
            globalThis.page = page;
            localStorage["quran-page"] = page;
            syncToolbar(page);
        },
    });

    output.addEventListener("click", e => {
        const el = e.target.closest(".aya");
        if (el) showAya(Number(el.dataset.sura), Number(el.dataset.aya));
    });

    suraSelect.addEventListener("change", () => {
        vp.goto(firstPageOfSura(Number(suraSelect.value)));
    });

    pageInput.addEventListener("change", gotoPageInput);
    pageInput.addEventListener("keydown", e => {
        if (e.key === "Enter") { gotoPageInput(); pageInput.blur(); }
    });

    btnPrev.addEventListener("click", () => vp.prev());
    btnNext.addEventListener("click", () => vp.next());

    document.getElementById("btn-search").addEventListener("click", () => openPanel("panel-search"));
    document.getElementById("btn-settings").addEventListener("click", () => openPanel("panel-settings"));
    for (const btn of document.querySelectorAll("[data-close]")) {
        btn.addEventListener("click", closeAllPanels);
    }
    backdrop.addEventListener("click", closeAllPanels);
    window.addEventListener("keydown", e => {
        if (e.key === "Escape") closeAllPanels();
    });

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

    for (const el of document.querySelectorAll(".swatch")) {
        el.addEventListener("click", () => theme_set(el.dataset.theme));
    }

    document.getElementById("font-select").addEventListener("change", e => {
        localStorage["quran-font"] = e.target.value;
        document.documentElement.style.setProperty("--quran-font", `"${e.target.value}"`);
    });

    document.getElementById("simple-toggle").addEventListener("change", e => {
        globalThis.simple = e.target.checked;
        localStorage["quran-simple"] = globalThis.simple;
        vp.reload();
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
        updateFontSize();
        vp.reload();
    });

    // handy for debugging from devtools
    Object.assign(globalThis, { vp, search });
}

main();
