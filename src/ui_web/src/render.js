import { parseHeaderLine, parseSuraLabel, toArabicDigits, escapeHtml, inlineSvg } from "./text-utils.js";
import { suraNames, suraAyaCount } from "./quran-index.js";

const LINES_PER_PAGE = 16;

// ---------------------------------------------------------------------------
// Native لا + hamza glyphs (me-quran font)
//
// The Tanzil text spells the hamza-in-the-middle case as
//     ل  [marks]  ـ  [marks]  U+0654  ا
// which no font can shape as one ligature. me-quran ships the glyphs for it
// (lam_hamza_arabicalef.zz20 / lamfinal_hamza_arabicalef.zz20) and its GSUB
// builds them from   ل  U+0621  ا   (marks in between are ignored by the
// lookup), so the text is rewritten to that form before it reaches the DOM.
//
// Enable/disable:
//   - set NATIVE_LAM_HAMZA_ALEF below, or
//   - call setNativeLamHamzaAlef(true|false) at runtime (re-render after), or
//   - open the page with ?lamhamza=0 (off) or ?lamhamza=1 (on).
//
// Only meaningful while the page font is me-quran: with any other font the
// U+0621 shows as a separate hamza letter, so switch it off for those.
// ---------------------------------------------------------------------------
const NATIVE_LAM_HAMZA_ALEF = true;

let nativeLamHamzaAlef = (() => {
    try {
        const q = new URLSearchParams(globalThis.location?.search || "").get("lamhamza");
        if (q === "0") return false;
        if (q === "1") return true;
    } catch (_) { /* no location (tests) */ }
    return NATIVE_LAM_HAMZA_ALEF;
})();

export function setNativeLamHamzaAlef(on) {
    nativeLamHamzaAlef = !!on;
}

export function isNativeLamHamzaAlef() {
    return nativeLamHamzaAlef;
}

const TASHKEEL = "\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u08D4-\u08FF";
const ALEFS    = "\u0627\u0623\u0625\u0622\u0671";
// ل, lam marks, tatweel, hamza marks / more tatweel, alef. The tatweel is
// required: it is what the source text puts in front of the combining hamza.
const LAM_TATWEEL_ALEF_RE = new RegExp(
    `\u0644([${TASHKEEL}\u0621]*)\u0640([${TASHKEEL}\u0621\u0640]*)([${ALEFS}])`, "g");
const DROP_RE = /[\u0640\u0621\u0654\u0655]/g; // tatweel and any hamza form

// full:   ل ْ ـ َ ٔ ا   ->   ل ْ ء َ ا    (lam marks, ء, hamza marks)
// simple: ل ـ ا         ->   ل ا          (simple text carries no hamza, but the
//                                          leftover tatweel would split the pair)
function fixLamHamzaAlef(text, simple) {
    return text.replace(LAM_TATWEEL_ALEF_RE, (_, lamMarks, hamzaMarks, alef) =>
        simple
            ? "\u0644" + alef
            : "\u0644" + lamMarks.replace(DROP_RE, "") + "\u0621" +
              hamzaMarks.replace(DROP_RE, "") + alef);
}

// These two decorative SVGs (the aya-end roundel and the sura-header
// banner) are art assets fetched once at startup, not part of icons.js's
// small UI-chrome icon set.
let ayaSvgTemplate  = "";
let suraSvgTemplate = "";

export async function loadRenderAssets() {
    ayaSvgTemplate = inlineSvg(await fetch("res/aya.svg").then(r => r.text()))
        .replace("<svg ", '<svg class="aya-marker-svg" ');
    suraSvgTemplate = inlineSvg(await fetch("res/header.svg").then(r => r.text()));
}

// Aya circle. Every rendered marker needs its own unique ids since
// several can be on screen (this page, its preloaded neighbours) at once
// and the template's <use xlink:href="#..."> references would otherwise
// collide.
let ayaMarkerSeq = 0;

function ayaMarkerSvg() {
    const uid = `aya${ayaMarkerSeq++}`;
    return ayaSvgTemplate
        .replace('<g id="header">',  `<g id="${uid}-header">`)
        .replace('<path id="repu"',  `<path id="${uid}-repu"`)
        .replace('xlink:href="#header"', `xlink:href="#${uid}-header"`)
        .replace('xlink:href="#repu"',   `xlink:href="#${uid}-repu"`);
}

// Sura header banner, same reasoning for the unique ids.
let suraHeaderSeq = 0;

function suraHeaderSvg(sura) {
    const uid = `sura${suraHeaderSeq++}`;
    return suraSvgTemplate
        .replace('id="sura-name"',   `id="${uid}-sura-name"`)
        .replace('id="sura-number"', `id="${uid}-sura-number"`)
        .replace('id="aya-count"',   `id="${uid}-aya-count"`)
        .replace("{{sura_name}}",   "سورة " + escapeHtml((suraNames[sura] || "").replace(/&nbsp;/g, " ")))
        .replace("{{sura_number}}", toArabicDigits(sura + 1))
        .replace("{{aya_count}}",   toArabicDigits(suraAyaCount[sura] || 0));
}

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

export function render(engine, page, simple) {
    const lines = engine.get_page(page, simple).split("\n");
    const [header, sura] = mk_header(lines[0]);

    // TODO: pages 0-1 render extra lines that don't belong on the page;
    // cut them off here until that's fixed upstream
    let body = lines.slice(1, page <= 1 ? 9 : LINES_PER_PAGE);

    // rewrite before anything below tags or measures the text; the aya and
    // sura regexes in tag_ayas never look at these characters
    if (nativeLamHamzaAlef) {
        body = body.map(l => fixLamHamzaAlef(l, simple));
    }

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
