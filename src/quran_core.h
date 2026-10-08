#ifndef QURAN_CORE_H_
#define QURAN_CORE_H_

#include <stdbool.h>
#include <wchar.h>

#include "quran_defs.h"
#include "../build/lut.h"
#include "../build/data.h"

bool quran_is_tashkeel(wchar_t c);
bool quran_is_stop_sign(wchar_t c);
wchar_t quran_simplify_char(wchar_t c);

QURAN_API size_t quran_read(int sura, int aya, quran_chr_t **out);
QURAN_API size_t quran_read_wchar(int sura, int aya, wchar_t *out, size_t len_max, bool simple);

int quran_juzu_of(quran_loc_t loc);
int quran_page_of(quran_loc_t loc);

// ---------- index (suras and juzus, in page order) ----------
//
// One source for every front end: the CLI's -i and the web UI's index list
// both read it, so neither has to re-derive it from rendered pages.

#define QURAN_INDEX_SURA 0
#define QURAN_INDEX_JUZU 1

// Fixed layout (4 x uint16, 8 bytes, no padding) so JavaScript can read an
// array of these straight out of wasm memory through a Uint16Array.
typedef struct {
    uint16_t kind;   // QURAN_INDEX_SURA or QURAN_INDEX_JUZU
    uint16_t number; // zero-based sura or juzu number
    uint16_t page;   // zero-based page where it starts
    uint16_t loc;    // QURAN_LOC of its first aya
} quran_index_entry_t;

// Writes the index to out, ordered by position in the text and therefore by
// page. A juzu that starts at the same aya as a sura comes first. At most
// max entries are written, but the return value is always the full number of
// entries, so quran_index(NULL, 0) sizes the buffer.
QURAN_API size_t quran_index(quran_index_entry_t *out, size_t max);

// Number of ayas in a sura, or 0 if sura is out of range.
QURAN_API int quran_sura_ayas(int sura);

// Copies the sura's name to out as a terminated string of at most len - 1
// characters and returns its length. With out == NULL it only returns the
// full length. Returns 0 if sura is out of range.
QURAN_API size_t quran_sura_name(int sura, wchar_t *out, size_t len);

// Page (zero-based) an aya starts on; ayas never span pages in this text.
// -1 if sura/aya is out of range.
QURAN_API int quran_aya_page(int sura, int aya);

// QURAN_LOC of the first aya on a page, or -1 if page is out of range.
QURAN_API int quran_page_first_loc(int page);

int quran_search(wchar_t *target, bool simple, void *user,
                 void (*onmatch)(int i, quran_loc_t loc, int start, int end, void *user));
QURAN_API int quran_search_locs(quran_loc_t *locs, wchar_t *target, bool simple);

#endif // QURAN_CORE_H_
