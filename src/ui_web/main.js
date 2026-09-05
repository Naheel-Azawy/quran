async function main() {
    const LC_ALL             = 6;
    const SIZEOF_WCHAR_T     = 4;
    const SIZEOF_QURAN_LOC_T = 2;

    document.getElementById("output").innerHTML = "<h2>تحميل...</h2>";

    const {
        memory, malloc, free,
        setlocale,
        swprint_page, quran_read, quran_read_wchar, quran_search_locs
    } = await loadWasm("quran.wasm");

    function init() {
        setlocale(LC_ALL, "en_US.UTF-8");
    }

    function get_page(page, simple=false) {
        const size = 2048 * SIZEOF_WCHAR_T;
        const ptr = malloc(size);
        swprint_page(ptr, page, simple, true);
        const str = decodeWchar32(memory, ptr);
        free(ptr);
        return str;
    }

    function get_aya(sura, aya, simple=false) {
        sura = Number(sura), aya = Number(aya);
        const len = quran_read(sura, aya, null);
        const ptr = malloc(SIZEOF_WCHAR_T * (len + 1));
        const len_real = quran_read_wchar(sura, aya, ptr, len, simple);
        // Not sure why, but looks like \0 is not set properly
        const str = decodeWchar32(memory, ptr)
              .slice(0, len_real)
              + ` {${aya + 1}}`;
        free(ptr);
        return str;
    }

    function locDecode(loc) {
        return {sura: (loc / 1000 |0) - 1, aya: (loc % 1000) - 1};
    }

    function search(target, simple=true) {
        // prepare utf32 string
        const target_w = [];
        for (let char of target) {
            const codePoint = char.codePointAt(0);
            target_w.push(codePoint);
        }
        target_w.push(0);
        const target_ptr = malloc(target_w.length * SIZEOF_WCHAR_T);
        let mem = new Uint32Array(memory.buffer);
        mem.set(target_w, target_ptr / 4);

        // first run to get length
        let matches = quran_search_locs(null, target_ptr, simple);

        const ptr = malloc(SIZEOF_QURAN_LOC_T * matches);
        matches = quran_search_locs(ptr, target_ptr, simple);
        console.log(matches);

        mem = new Uint16Array(memory.buffer, ptr * SIZEOF_QURAN_LOC_T, matches);
        let arr = Array.from(mem);
        // arr is all zeros, not sure why, maybe in c maybe in js TODO: fix
        //arr = arr.map(loc => locDecode(loc));

        free(ptr);
        free(target_ptr);
        return arr;
    }

    function tag_ayas(input, sura) {
        const parts = [];
        let lastIndex = 0;

        // Match numbered markers like {1} and headers like --{ some header }--
        const regex = /--\{([^}]+)\}--|\{(\d+)\}/g;
        let match;

        while ((match = regex.exec(input)) !== null) {
            const start = match.index;

            if (match[1]) {
                // Header match: --{ header text }--
                let segment = match[0];
                if (start > lastIndex) {
                    // Text before this match
                    const textBefore = input.slice(lastIndex, start);
                    if (textBefore.trim()) {
                        segment = textBefore + segment;
                    }
                }

                // move to the end of line
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
                sura = Number(match[1].replace(/&nbsp;/g, " ")
                              .match(/.+ (\d+)/)[1]) - 1;
                parts.push(`<span class="sura" data-sura="${sura}">${segment}</span>`);

            } else if (match[2]) {
                // Numbered marker match: {1}, {2}, etc.
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
                parts.push(`<span class="aya" data-aya="${aya}" ` +
                           `data-sura="${sura}" onclick="aya_click(this)">${segment}</span>`);
            }

            lastIndex = regex.lastIndex;
        }

        // Remaining text
        if (lastIndex < input.length) {
            const rest = input.slice(lastIndex);
            if (rest.trim()) {
                parts.push(rest);
            }
        }

        return parts.join('');
    }

    function mk_header(header) {
        header = header.split(/  +/).map(s => s.trim())
            .map(s => {
                const m = s.match(/(.+) (\d+)/);
                const t = m[1], num = Number(m[2]);
                if (s.includes("صفحة")) {
                    s = `${t} <input id="num" type="number" ` +
                        `onchange="vp.goto(this.value - 1)" value="${num}">`;
                }
                return [s, num];
            });
        const sura = header[0][1] - 1;
        header = '<table class="header"><tr>' +
            `<td style="float:right">${header[0][0]}</td>` +
            `<td style="">${header[1][0]}</td>` +
            `<td style="float:left;">${header[2][0]}</td>` +
            "</tr></table>";
        return [header, sura];
    }

    function render(page) {
        if (typeof page != "number") {
            page = globalThis.page;
        }
        let txt = get_page(page, globalThis.simple);

        // process line by line
        txt = txt.split("\n");

        // extract header
        let [header, sura] = mk_header(txt[0]);

        // workaround to hide mess, TODO: fix
        txt = txt.slice(1, page <= 1 ? 9 : 16);

        // non-breaking spaces if the first char is not a space
        txt = txt.map(l => l[0] == ' ' ? l.replace(/ /g, "&nbsp;") : l);

        // add html tags
        txt = tag_ayas(txt.join("\n"), sura).split("\n");

        // separate lines
        txt = txt.map(l => `${l}<br>`);

        // process all again
        txt = txt.join("\n");

        // nice aya numbers
        txt = txt.replace(/{(\d+)}/g, (_, num) => {
            let res = "";
            for (let digit of num) {
                res += String.fromCharCode(digit.charCodeAt(0) + 0x0660 - 0x0030);
            }
            return `﴿${res}﴾`;
        });

        // bring header back
        txt = `${header}\n<div class="page-text">${txt}</div>`;

        // extend page if needed
        const lines = txt.match(/<br\s*\/?>/gi).length;
        if (lines < 16) {
            const needed = 16 - lines;
            for (let i = 0; i < needed; ++i)
                txt += "<br>";
        }

        const div = document.createElement("div");
        div.className = "page";
        div.innerHTML = txt;
        return div;
    }

    function aya_click(target) {
        const {sura, aya} = target.dataset;
        alert(get_aya(sura, aya, globalThis.simple));
    }

    function theme_set(name) {
        if (!name) {
            name = localStorage["quran-theme"] || "black";
        }
        name = name.toLowerCase();
        document.body.classList.remove("light");
        document.body.classList.remove("yellow");
        if (name == "white")  document.body.classList.add("light");
        if (name == "yellow") document.body.classList.add("yellow");
        localStorage["quran-theme"] = name;
    }

    function simple_tog() {
        globalThis.simple = !globalThis.simple;
        localStorage["quran-simple"] = globalThis.simple;
        vp.reload();
    }

    function updateFontSize() {
        const charsW = 30 + 2 * .5; // 30em + 2 * .5em padding left and right
        const charsH = 46;
        const size = Math.min(
            window.innerWidth  * .99 / charsW,
            window.innerHeight * .90 / charsH
        );
        document.getElementById("output").style.fontSize = size + "px";
    }

    async function handle_pwa() {
        if ("serviceWorker" in navigator) {
            try {
                let reg = await navigator.serviceWorker.register("sw.js");
                console.log("SW registered: ", reg);
            } catch (e) {
                console.log("SW registration failed: ", e);
            }
        }
    }

    if (localStorage["quran-page"] !== undefined) {
        globalThis.page = Number(localStorage["quran-page"]);
    } else {
        globalThis.page = 0;
    }
    if (localStorage["quran-simple"] !== undefined) {
        globalThis.simple = localStorage["quran-simple"] == "true";
    } else {
        globalThis.simple = false;
    }

    async function loadFont() {
        const font = "me_quran";
        if (document.fonts) {
            await document.fonts.load(`13px "${font}"`);
        }
        document.getElementById("output").style.fontFamily = font;
    }

    theme_set();
    handle_pwa();
    init();
    updateFontSize();
    await loadFont();
    document.getElementById("output").innerHTML = "";
    const vp = new ViewPager({
        parent:       document.getElementById("output"),
        initPage:     globalThis.page,
        totalPages:   604,
        pageRenderer: index => render(index),
        onChange: page => {
            if (page <   0) page =   0;
            if (page > 603) page = 603;
            globalThis.page = page;
            localStorage["quran-page"] = page;
        },
    });

    window.addEventListener("keydown", event => {
        switch (event.key) {
        case "ArrowLeft":  vp.next(); break;
        case "ArrowRight": vp.prev(); break;
        }
    });

    window.addEventListener("resize", () => {
        if (document.activeElement &&
            document.activeElement.id == "num") {
            return;
        }
        updateFontSize();
        vp.reload();
    });

    Object.assign(globalThis, {
        vp, aya_click, theme_set, simple_tog, search,
    });
}

main();
