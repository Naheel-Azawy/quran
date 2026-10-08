import { loadWasm, decodeWchar32 } from "./wasm-loader.js";

const SIZEOF_WCHAR_T     = 4;
const SIZEOF_QURAN_LOC_T = 2;

// quran_index_entry_t in quran_core.h: four uint16 (kind, number, page, loc)
const INDEX_ENTRY_FIELDS = 4;
const INDEX_ENTRY_SIZE   = INDEX_ENTRY_FIELDS * 2;
const INDEX_KIND_SURA    = 0; // QURAN_INDEX_SURA
const SURA_NAME_MAX      = 64; // wchar_t slots, longest real name is 9

// Everything the C side must export for this file to work.
const REQUIRED_EXPORTS = [
    "memory", "malloc", "free", "quran_printer_init",
    "swprint_page", "quran_read", "quran_read_wchar", "quran_search_locs",
    "quran_index", "quran_sura_ayas", "quran_sura_name",
    "quran_aya_page", "quran_page_first_loc",
];

// Loads quran.wasm and returns a small object exposing the handful of
// operations the rest of the app needs (page text, single-ayah text,
// and full-text search), without leaking any of the raw malloc/free
// pointer bookkeeping to callers.
export async function loadQuranEngine(wasmPath = "quran.wasm") {
    const exports = await loadWasm(wasmPath);
    const missing = REQUIRED_EXPORTS.filter(name => !(name in exports));
    if (missing.length) {
        // an old quran.wasm built before the index API existed
        throw new Error(`${wasmPath} does not export: ${missing.join(", ")}. Rebuild it.`);
    }
    const {
        memory, malloc, free,
        quran_printer_init,
        swprint_page, quran_read, quran_read_wchar, quran_search_locs,
        quran_index, quran_sura_ayas, quran_sura_name,
        quran_aya_page, quran_page_first_loc,
    } = exports;

    quran_printer_init();

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
    // not for display; strip it wherever the aya text is shown directly.
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

    // ---------- index (see quran_core.h) ----------

    // Suras and juzus in page order: [{ kind: "sura" | "juzu", number,
    // page, loc }], all numbers zero-based.
    function getIndex() {
        const count = quran_index(0, 0);
        const ptr = malloc(count * INDEX_ENTRY_SIZE);
        const written = Math.min(quran_index(ptr, count), count);
        // the view is made after malloc, which could have grown the memory
        const raw = new Uint16Array(memory.buffer, ptr, written * INDEX_ENTRY_FIELDS);
        const entries = [];
        for (let i = 0; i < written; ++i) {
            const [kind, number, page, loc] = raw.subarray(i * INDEX_ENTRY_FIELDS,
                                                           (i + 1) * INDEX_ENTRY_FIELDS);
            entries.push({
                kind: kind === INDEX_KIND_SURA ? "sura" : "juzu",
                number, page, loc,
            });
        }
        free(ptr);
        return entries;
    }

    function suraName(sura) {
        const ptr = malloc(SURA_NAME_MAX * SIZEOF_WCHAR_T);
        const len = quran_sura_name(sura, ptr, SURA_NAME_MAX); // terminates the string
        const str = len ? decodeWchar32(memory, ptr) : "";
        free(ptr);
        return str;
    }

    const suraAyas     = sura => quran_sura_ayas(sura);
    const ayaPage      = (sura, aya) => quran_aya_page(sura, aya);      // -1 if invalid
    const pageFirstLoc = page => quran_page_first_loc(page);            // -1 if invalid

    return {
        get_page, get_aya, ayaText, search,
        getIndex, suraName, suraAyas, ayaPage, pageFirstLoc,
    };
}
