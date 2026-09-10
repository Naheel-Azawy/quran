import { loadWasm, decodeWchar32 } from "./wasm-loader.js";

const SIZEOF_WCHAR_T     = 4;
const SIZEOF_QURAN_LOC_T = 2;

// Loads quran.wasm and returns a small object exposing the handful of
// operations the rest of the app needs (page text, single-ayah text,
// and full-text search), without leaking any of the raw malloc/free
// pointer bookkeeping to callers.
export async function loadQuranEngine(wasmPath = "quran.wasm") {
    const {
        memory, malloc, free,
        quran_printer_init,
        swprint_page, quran_read, quran_read_wchar, quran_search_locs,
    } = await loadWasm(wasmPath);

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

    return { get_page, get_aya, ayaText, search };
}
