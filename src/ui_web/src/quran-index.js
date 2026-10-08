export const TOTAL_PAGES = 604;
export const TOTAL_SURAS = 114;
export const TOTAL_JUZUS = 30;

export let suraNames     = new Array(TOTAL_SURAS).fill("");
export let suraOfPage    = new Array(TOTAL_PAGES).fill(0);
export let suraAyaCount  = new Array(TOTAL_SURAS).fill(0);

// Suras and juzus together, in page order, as [{ kind: "sura" | "juzu",
// number, page, loc }] with every number zero-based. Filled by buildIndex()
// from the engine's own index (quran_index in quran_core.c), so the web UI
// and the CLI's -i list the same thing in the same order.
export const indexEntries = [];

let engine = null; // set by buildIndex(); the lookups below ask it directly

// Pulls the index out of the engine. Everything here is plain data the C
// side already holds, so nothing is rendered or parsed any more.
export function buildIndex(quranEngine) {
    engine = quranEngine;

    for (let s = 0; s < TOTAL_SURAS; ++s) {
        suraNames[s]    = engine.suraName(s);
        suraAyaCount[s] = engine.suraAyas(s);
    }
    for (let p = 0; p < TOTAL_PAGES; ++p) {
        // the page header names the sura of the page's first aya
        suraOfPage[p] = engine.pageFirstLoc(p) >> 9;
    }

    indexEntries.length = 0;
    indexEntries.push(...engine.getIndex());
}

export function firstPageOfSura(sura) {
    return Math.max(0, engine.ayaPage(sura, 0));
}

// First aya to play for "listen from this page".
export function firstAyaOfPage(page) {
    page = Math.max(0, Math.min(TOTAL_PAGES - 1, page));
    const loc = engine.pageFirstLoc(page);
    return { sura: loc >> 9, aya: loc & 0x1FF };
}

export function pageOfSuraAya(sura, aya) {
    return Math.max(0, engine.ayaPage(sura, aya));
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
