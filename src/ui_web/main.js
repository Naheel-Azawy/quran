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

    // Aya circle
    let ayaMarkerSeq = 0;
    const ayaSvgTemplate = inlineSvg(await fetch("aya.svg").then(r => r.text()))
        .replace("<svg ", '<svg class="aya-marker-svg" ');

    function ayaMarkerSvg() {
        const uid = `aya${ayaMarkerSeq++}`;
        return ayaSvgTemplate
            .replace('<g id="header">',  `<g id="${uid}-header">`)
            .replace('<path id="repu"',  `<path id="${uid}-repu"`)
            .replace('xlink:href="#header"', `xlink:href="#${uid}-header"`)
            .replace('xlink:href="#repu"',   `xlink:href="#${uid}-repu"`);
    }

    // Anything fetched and inlined into page markup has to survive
    // render(), which splits the body on newlines and appends a <br> to
    // every line. A <br> inside SVG is foreign content the HTML parser
    // cannot accept, so it breaks out and closes the <svg> early, spilling
    // the rest of the artwork into the page as text. Flattening to a
    // single line avoids that entirely. Comments and <metadata> go too:
    // the former are pure documentation, the latter is provenance data
    // some tools inject into .svg files, and neither renders.
    function inlineSvg(text) {
        return text
            .replace(/<\?xml[\s\S]*?\?>/g, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, "")
            .replace(/\s+xmlns:c2pa="[^"]*"/g, "")
            .replace(/\s*\n\s*/g, " ")
            .trim();
    }

    // Sura header
    let suraHeaderSeq = 0;
    const suraSvgTemplate = inlineSvg(await fetch("header.svg").then(r => r.text()));

    function escapeHtml(s) {
        return String(s).replace(/&(?!nbsp;)/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");
    }

    function suraHeaderSvg(sura) {
        const uid = `sura${suraHeaderSeq++}`;
        return suraSvgTemplate
            .replace('id="sura-name"',   `id="${uid}-sura-name"`)
            .replace('id="sura-number"', `id="${uid}-sura-number"`)
            .replace('id="aya-count"',   `id="${uid}-aya-count"`)
            .replace("{{sura_name}}",   escapeHtml((suraNames[sura] || "").replace(/&nbsp;/g, " ")))
            .replace("{{sura_number}}", toArabicDigits(sura + 1))
            .replace("{{aya_count}}",   toArabicDigits(suraAyaCount[sura] || 0));
    }
    //
    // No wasm export gives us sura->page or aya->page directly, so this
    // builds the mapping once at startup by reading every page's own
    // header and aya markers (the same markers tag_ayas already parses
    // for on-page rendering). just=false skips justification, which only
    // pads spacing and never changes line breaks or marker positions, so
    // this is a cheap, exact stand-in for the fully rendered page here.

    let suraNames  = new Array(TOTAL_SURAS).fill("");
    let suraOfPage = new Array(TOTAL_PAGES).fill(0);
    let suraAyaCount = new Array(TOTAL_SURAS).fill(0);
    let pageOfLoc  = new Map();

    function buildIndex() {
        // TODO: add C API and remove this
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
                        // this loop already visits every marker of every
                        // sura, so the highest one seen is the aya count
                        if (aya + 1 > suraAyaCount[sura]) {
                            suraAyaCount[sura] = aya + 1;
                        }
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

    // alquran.cloud's audio CDN numbers ayat globally (1..6236) rather
    // than per-sura, so this turns buildIndex()'s per-sura counts into a
    // running offset: globalAyahStart[s] is the count of every ayah in
    // suras before s.
    let globalAyahStart = new Array(TOTAL_SURAS).fill(0);

    function buildGlobalAyahIndex() {
        let acc = 0;
        for (let s = 0; s < TOTAL_SURAS; ++s) {
            globalAyahStart[s] = acc;
            acc += suraAyaCount[s] || 0;
        }
    }

    function globalAyahNumber(sura, aya) {
        return globalAyahStart[sura] + aya + 1;
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
                // The band is absolutely positioned over the span, and the
                // sura name now lives inside it. The original line text is
                // kept (rendered transparent by .sura) purely as a spacer,
                // so the span still measures one full line exactly as before.
                parts.push(`<span class="sura" data-sura="${sura}">${suraHeaderSvg(sura)}${segment}</span>`);

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
                const segment = input.slice(lastIndex, end)
                      .replace(/ /g, "&nbsp;");
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
        body = body.replace(/\{(\d+)\}/g, (_, num) =>
            `<span class="aya-marker">${ayaMarkerSvg()}<span class="aya-marker-num">${toArabicDigits(num)}</span></span>`);

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

    const pageInput  = document.getElementById("page-input");
    const btnPrev    = document.getElementById("btn-prev");
    const btnNext    = document.getElementById("btn-next");

    const suraList       = document.getElementById("sura-list");
    const suraFilterInput = document.getElementById("sura-filter");

    function renderSuraList(filter = "") {
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
            meta.textContent = `${toArabicDigits(suraAyaCount[s] || 0)} آية`;

            info.append(nameEl, meta);
            li.append(badge, info);
            suraList.appendChild(li);
        }

        if (!shown) {
            const empty = document.createElement("li");
            empty.className = "sura-empty";
            empty.textContent = "لا توجد نتائج";
            suraList.appendChild(empty);
        }

        highlightActiveSura(suraOfPage[globalThis.page]);
    }

    function highlightActiveSura(sura) {
        for (const el of suraList.querySelectorAll(".sura-item")) {
            el.classList.toggle("active", Number(el.dataset.sura) === sura);
        }
    }

    function scrollActiveSuraIntoView() {
        const el = suraList.querySelector(".sura-item.active");
        if (el) el.scrollIntoView({ block: "center" });
    }

    function populateServerSelect() {
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

    function populateReaderSelect() {
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

    function gotoPageInput() {
        const p = Number(pageInput.value) - 1;
        if (!Number.isFinite(p)) return;
        vp.goto(Math.max(0, Math.min(TOTAL_PAGES - 1, p)));
    }

    function syncStatus(page) {
        pageInput.value = page + 1;
        highlightActiveSura(suraOfPage[page]);
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

    let ayaShown = null; // {sura, aya} last opened in panel-aya, for btn-play-from-aya

    function showAya(sura, aya) {
        ayaShown = { sura, aya };
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

    // ---------- audio ----------

    // Two audio sources, each with its own reader-id scheme and URL shape.
    // Both lists are curated to the same set of reciters (by voice, not by
    // id -- the ids differ per server) so switching servers is really just
    // switching *where the same voices come from*.
    const SERVERS = {
        cdn: {
            name: "alquran.cloud (cdn.islamic.network)",
            defaultReader: "ar.ajamy",
            // Any other "ar.*" edition id from https://alquran.cloud/cdn
            // works here too; this is just a curated subset.
            readers: [
                { id: "ar.ajamy",              name: "أحمد بن علي العجمي" },
                { id: "ar.alafasy",            name: "مشاري راشد العفاسي" },
                { id: "ar.abdulbasitmurattal", name: "عبد الباسط عبد الصمد (مرتل)" },
                { id: "ar.abdurrahmaansudais", name: "عبد الرحمن السديس" },
                { id: "ar.husary",             name: "محمود خليل الحصري" },
                { id: "ar.minshawi",           name: "محمد صديق المنشاوي" },
                { id: "ar.hudhaify",           name: "علي بن عبد الرحمن الحذيفي" },
                { id: "ar.shaatree",           name: "أبو بكر الشاطري" },
                { id: "ar.mahermuaiqly",       name: "ماهر المعيقلي" },
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
                { id: "Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net", name: "أحمد بن علي العجمي" },
                { id: "Alafasy_128kbps",                               name: "مشاري راشد العفاسي" },
                { id: "Abdul_Basit_Murattal_64kbps",                   name: "عبد الباسط عبد الصمد (مرتل)" },
                { id: "Abdurrahmaan_As-Sudais_64kbps",                 name: "عبد الرحمن السديس" },
                { id: "Husary_128kbps",                                name: "محمود خليل الحصري" },
                { id: "Minshawy_Murattal_128kbps",                     name: "محمد صديق المنشاوي" },
                { id: "Hudhaify_128kbps",                              name: "علي بن عبد الرحمن الحذيفي" },
                { id: "Abu_Bakr_Ash-Shaatree_128kbps",                 name: "أبو بكر الشاطري" },
                { id: "MaherAlMuaiqly128kbps",                         name: "ماهر المعيقلي" },
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
    // next .play() -- that has a hard, audible seam. Instead two <audio>
    // elements are kept: one "active" (playing/paused, whatever the user
    // hears) and one "standby" pre-loaded with the upcoming ayah. As the
    // active one nears its end, both are played simultaneously for
    // CROSSFADE_SEC while their volumes ramp in opposite directions, then
    // the standby becomes active. Manual jumps (prev/next, tapping an aya,
    // switching reader) are hard cuts on purpose -- they're the user
    // explicitly asking for a different place, not a continuation.
    const CROSSFADE_SEC = .3;

    const slots = [new Audio(), new Audio()];
    slots.forEach(a => { a.preload = "auto"; });
    let activeIdx     = 0;
    let crossfading   = false;
    let crossfadeTimer = null;
    let queuedNext     = null; // {sura, aya} pre-loaded into the standby slot

    const activeAudio = () => slots[activeIdx];
    const otherAudio  = () => slots[1 - activeIdx];

    const initServer = localStorage["quran-server"] in SERVERS
        ? localStorage["quran-server"] : "everyayah";

    const audioState = {
        server:      initServer,
        reader:      localStorage[readerStorageKey(initServer)] || SERVERS[initServer].defaultReader,
        autoAdvance: localStorage["quran-autoadvance"] !== undefined
            ? localStorage["quran-autoadvance"] === "true" : true,
        sura:    null,
        aya:     null,
    };

    function audioUrl(sura, aya) {
        return SERVERS[audioState.server].buildUrl(audioState.reader, sura, aya);
    }

    // Shared by shiftAya (manual) and the crossfade engine (automatic),
    // so both agree on what "next"/"previous" ayah means at sura edges.
    function stepAya(sura, aya, delta) {
        aya += delta;
        if (aya < 0) {
            if (--sura < 0) return null;
            aya = (suraAyaCount[sura] || 1) - 1;
        } else if (aya >= (suraAyaCount[sura] || 1)) {
            if (++sura >= TOTAL_SURAS) return null;
            aya = 0;
        }
        return { sura, aya };
    }

    // Reflects visits to the currently-playing aya's <span class="aya">,
    // if it's part of the currently rendered page(s). Unlike .blink (a
    // one-shot animation), this has to survive page re-renders, so it's
    // reapplied any time the pager redraws rather than set once.
    function applyPlayingHighlight() {
        for (const el of output.querySelectorAll(".aya.playing")) {
            el.classList.remove("playing");
        }
        if (audioState.sura == null) return;
        const el = output.querySelector(
            `.aya[data-sura="${audioState.sura}"][data-aya="${audioState.aya}"]`);
        if (el) el.classList.add("playing");
    }

    function updateAudioUI() {
        // .paused is the actual source of truth; a separately-tracked
        // boolean can drift out of sync if a play/pause event from a
        // slot that's since stopped being "active" arrives late
        const playing = audioState.sura != null && !activeAudio().paused;

        const label = document.getElementById("audio-now-playing");
        label.textContent = audioState.sura != null
            ? `${suraNames[audioState.sura]} ﴿${toArabicDigits(audioState.aya + 1)}﴾`
            : "لم يبدأ التشغيل";
        label.onclick = () => gotoPlayingAya({ force: true });

        const playBtn = document.getElementById("btn-audio-playpause");
        playBtn.classList.toggle("is-playing", playing);
        const playLabel = playing ? "إيقاف مؤقت" : "تشغيل";
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
    }

    // Whether page-navigation should auto-follow the playing ayah. True
    // right after any explicit jump (play button, prev/next-aya, "play
    // from here") and whenever the user is already on (or returns to) the
    // page containing it; false the moment the user navigates elsewhere
    // on their own while audio keeps advancing in the background.
    let followPlayback = true;
    // Set just before *our own* vp.goto() calls, so the pager's onChange
    // handler (which also fires for user-driven navigation) can tell the
    // two apart and only reconsider followPlayback for real user moves.
    let programmaticNav = false;

    function gotoPlayingAya(opts = {}) {
        const force = !!opts.force;
        const targetPage = pageOfSuraAya(audioState.sura, audioState.aya);

        if (targetPage === globalThis.page) {
            // already here -- (re)join auto-following
            followPlayback = true;
            applyPlayingHighlight();
            return;
        }
        if (!force && !followPlayback) {
            // the user wandered off to browse elsewhere; don't drag them
            // back just because playback moved to a different page
            return;
        }

        followPlayback = true;
        programmaticNav = true;
        vp.goto(targetPage);
        // the target page's markup may still be mid-transition;
        // give it a moment before looking for the .aya element,
        // mirroring blinkAya's own use of this delay
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
        crossfading   = false;
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

    function playAya(sura, aya) {
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

    function stopAudio() {
        cancelCrossfade();
        for (const a of slots) {
            a.pause();
            a.removeAttribute("src");
            a.load();
        }
        queuedNext = null;
        audioState.sura    = null;
        audioState.aya     = null;
        applyPlayingHighlight();
        updateAudioUI();
    }

    function togglePlayPause() {
        if (audioState.sura == null) {
            // nothing picked yet -- start from the beginning of the
            // sura shown on the current page
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

    function shiftAya(delta) {
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
            // no crossfade happened (e.g. duration was unknown) -- fall
            // back to a hard cut rather than not advancing at all
            playAya(loc.sura, loc.aya);
        });
    });

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
        document.getElementById("btn-menu").classList.add("hidden");
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
        document.getElementById("btn-menu").classList.remove("hidden");
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
        const charsW = 28; // same dims as css
        const charsH = 46;
        const rect = pagerWrap.getBoundingClientRect();
        const size = Math.min(
            rect.width  * .99 / charsW,
            rect.height * .98 / charsH
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
    buildGlobalAyahIndex();
    renderSuraList();
    populateServerSelect();
    populateReaderSelect();
    document.getElementById("autoadvance-toggle").checked = audioState.autoAdvance;
    updateAudioUI();

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
        pageRenderer: index => {
            const div = render(index);
            requestAnimationFrame(applyPlayingHighlight);
            return div;
        },
        onChange: page => {
            page = Math.max(0, Math.min(TOTAL_PAGES - 1, page));
            globalThis.page = page;
            localStorage["quran-page"] = page;
            syncStatus(page);

            if (programmaticNav) {
                programmaticNav = false;
            } else if (audioState.sura != null) {
                // a real user navigation (swipe, prev/next page, sura
                // select, page jump, search result...): follow only if
                // it happens to land them back on the playing page
                followPlayback = (page === pageOfSuraAya(audioState.sura, audioState.aya));
            }
        },
    });

    output.addEventListener("click", e => {
        const el = e.target.closest(".aya");
        if (el) showAya(Number(el.dataset.sura), Number(el.dataset.aya));
    });

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

    document.getElementById("btn-menu").addEventListener("click", () => openPanel("panel-menu"));

    for (const btn of document.querySelectorAll(".menu-item[data-target]")) {
        btn.addEventListener("click", () => {
            const target = btn.dataset.target;
            openPanel(target);
            if (target === "panel-suras") {
                suraFilterInput.value = "";
                renderSuraList("");
                requestAnimationFrame(() => {
                    suraFilterInput.focus();
                    scrollActiveSuraIntoView();
                });
            } else if (target === "panel-page") {
                pageInput.focus();
                pageInput.select();
            } else if (target === "panel-search") {
                searchInput.focus();
            }
        });
    }

    for (const btn of document.querySelectorAll("[data-back]")) {
        btn.addEventListener("click", () => openPanel(btn.dataset.back));
    }

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

    document.getElementById("btn-audio-playpause").addEventListener("click", togglePlayPause);
    document.getElementById("btn-audio-stop").addEventListener("click", stopAudio);
    document.getElementById("btn-audio-prev").addEventListener("click", () => shiftAya(-1));
    document.getElementById("btn-audio-next").addEventListener("click", () => shiftAya(1));

    document.getElementById("btn-menu-audio-playpause").addEventListener("click", togglePlayPause);
    document.getElementById("btn-menu-audio-stop").addEventListener("click", stopAudio);

    function reloadCurrentAudioSource() {
        // restarts whatever's currently loaded/playing using the (now
        // updated) audioState.server/reader -- used when either changes
        if (audioState.sura == null) return;
        cancelCrossfade();
        const a = activeAudio();
        const wasPlaying = !a.paused;
        a.src = audioUrl(audioState.sura, audioState.aya);
        if (wasPlaying) a.play().catch(() => {});
        preloadNext(); // the standby ayah was buffered from the old source
    }

    document.getElementById("server-select").addEventListener("change", e => {
        audioState.server = e.target.value;
        localStorage["quran-server"] = audioState.server;
        audioState.reader = localStorage[readerStorageKey(audioState.server)]
            || SERVERS[audioState.server].defaultReader;
        populateReaderSelect();
        reloadCurrentAudioSource();
    });

    document.getElementById("reader-select").addEventListener("change", e => {
        audioState.reader = e.target.value;
        localStorage[readerStorageKey(audioState.server)] = audioState.reader;
        reloadCurrentAudioSource();
    });

    document.getElementById("autoadvance-toggle").addEventListener("change", e => {
        audioState.autoAdvance = e.target.checked;
        localStorage["quran-autoadvance"] = audioState.autoAdvance;
    });

    document.getElementById("btn-play-from-aya").addEventListener("click", () => {
        if (ayaShown) playAya(ayaShown.sura, ayaShown.aya);
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
