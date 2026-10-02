import { parseHeaderLine, parseSuraLabel } from "./text-utils.js";

export const TOTAL_PAGES = 604;
export const TOTAL_SURAS = 114;

export let suraNames     = new Array(TOTAL_SURAS).fill("");
export let suraOfPage    = new Array(TOTAL_PAGES).fill(0);
export let suraAyaCount  = new Array(TOTAL_SURAS).fill(0);
export let pageOfLoc     = new Map();

// First aya whose end marker appears on each page; lets "listen from
// this page" start on something visible rather than at the sura's start.
const firstLocOfPage = new Array(TOTAL_PAGES);

// No wasm export gives us sura->page or aya->page directly, so this
// builds the mapping once at startup by reading every page's own header
// and aya markers (the same markers render.js's tag_ayas already parses
// for on-page rendering). just=false skips justification, which only
// pads spacing and never changes line breaks or marker positions, so
// this is a cheap, exact stand-in for the fully rendered page here.
export function buildIndex(engine) {
    // TODO: add C API and remove this
    for (let p = 0; p < TOTAL_PAGES; ++p) {
        try {
            const lines = engine.get_page(p, false, false).split("\n");
            let { name, sura } = parseSuraLabel(parseHeaderLine(lines[0])[0]);
            suraNames[sura]  = name.replace(/&nbsp;/g, " ");
            suraOfPage[p]    = sura;

            const body = lines.slice(1).join("\n");
            const markerRe = /--\{([^}]+)\}--|\{(\d+)\}/g;
            let m;
            while ((m = markerRe.exec(body))) {
                if (m[1]) {
                    ({ name, sura } = parseSuraLabel(m[1]));
                    suraNames[sura] = name.replace(/&nbsp;/g, " ");
                } else {
                    const aya = Number(m[2]) - 1;
                    pageOfLoc.set((sura << 9) | aya, p);
                    if (firstLocOfPage[p] === undefined) firstLocOfPage[p] = { sura, aya };
                    // this loop already visits every marker of every sura,
                    // so the highest one seen is the aya count
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

export function firstPageOfSura(sura) {
    return pageOfLoc.get(sura << 9) ?? 0;
}

// First aya to play for "listen from this page". A page that holds no aya
// end marker (one long aya spanning it) falls forward to the next page
// that does, since that is the aya being read there.
export function firstAyaOfPage(page) {
    for (let p = page; p < TOTAL_PAGES; ++p) {
        if (firstLocOfPage[p]) return { ...firstLocOfPage[p] };
    }
    return { sura: suraOfPage[page] || 0, aya: 0 };
}

export function pageOfSuraAya(sura, aya) {
    return pageOfLoc.get((sura << 9) | aya) ?? 0;
}

// alquran.cloud's audio CDN numbers ayat globally (1..6236) rather than
// per-sura, so this turns buildIndex()'s per-sura counts into a running
// offset: globalAyahStart[s] is the count of every ayah in suras before s.
export let globalAyahStart = new Array(TOTAL_SURAS).fill(0);

export function buildGlobalAyahIndex() {
    let acc = 0;
    for (let s = 0; s < TOTAL_SURAS; ++s) {
        globalAyahStart[s] = acc;
        acc += suraAyaCount[s] || 0;
    }
}

export function globalAyahNumber(sura, aya) {
    return globalAyahStart[sura] + aya + 1;
}

// Shared by audio.shiftAya (manual) and the crossfade engine (automatic),
// so both agree on what "next"/"previous" ayah means at sura edges.
export function stepAya(sura, aya, delta) {
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
