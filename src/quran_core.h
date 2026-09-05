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

size_t quran_read(int sura, int aya, quran_chr_t **out);
size_t quran_read_wchar(int sura, int aya, wchar_t *out, size_t len_max, bool simple);

int quran_juzu_of(quran_loc_t loc);
int quran_page_of(quran_loc_t loc);

int quran_search(wchar_t *target, bool simple, void *user,
                 void (*onmatch)(int i, quran_loc_t loc, int start, int end, void *user));
int quran_search_locs(quran_loc_t *locs, wchar_t *target, bool simple);

#endif // QURAN_CORE_H_
