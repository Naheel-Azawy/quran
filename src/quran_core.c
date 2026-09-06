#include "quran_core.h"

bool quran_is_tashkeel(wchar_t c) {
    return
        (c >= 0x0610 && c <= 0x061A) ||
        (c >= 0x064B && c <= 0x065F) ||
        (c == 0x0670)                ||
        (c >= 0x06D6 && c <= 0x06DC) ||
        (c >= 0x06DF && c <= 0x06E8) ||
        (c >= 0x06EA && c <= 0x06ED) ||
        (c >= 0x08D4 && c <= 0x08E1) ||
        (c >= 0x08D4 && c <= 0x08ED) ||
        (c >= 0x08E3 && c <= 0x08FF);
}

bool quran_is_stop_sign(wchar_t c) {
    return
        (c >= 0x06D6 && c <= 0x06DC) ||
        c == 0x06E5 || c == 0x06E6;
}

wchar_t quran_simplify_char(wchar_t c) {
    switch (c) {
    case L'۩': c =    0; break;
    case L'ٱ': c = L'ا'; break;
    case L'أ': c = L'ا'; break;
    case L'إ': c = L'ا'; break;
    /* case L'ء': c = L'ا'; break; */
    /* case L'ئ': c = L'ي'; break; */
    /* case L'ؤ': c = L'و'; break; */
    }
    if (quran_is_tashkeel(c)) return 0;
    return c;
}

size_t quran_read(int sura, int aya, quran_chr_t **out) {
    size_t start_s = (sura          == 0) ? 0 : quran.endings_s[sura - 1];
    size_t start_a = (start_s + aya == 0) ? 0 : quran.endings_a[start_s + aya - 1];
    size_t end_a   = quran.endings_a[start_s + aya];
    if (out != NULL) *out = quran.text + start_a;
    return end_a - start_a;
}

size_t quran_read_wchar(int sura, int aya, wchar_t *out, size_t len_max, bool simple) {
    quran_chr_t *txt;
    size_t       len;
    size_t       len_written = 0;
    wchar_t      c;
    len = quran_read(sura, aya, &txt);
    for (size_t i = 0; i < len; ++i) {
        c = (wchar_t) QURAN_TXT_DEC(txt[i]);
        if (simple) c = quran_simplify_char(c);
        if (!c) continue;
        if (out) out[len_written] = c;
        ++len_written;
        if (len_written >= len_max) {
            break;
        }
    }
    return len_written;
}

int quran_page_of(quran_loc_t loc) {
    for (int p = QURAN_PAGES - 1; p >= 0; --p) {
        if (loc >= quran.pages[p]) {
            return p;
        }
    }
    return -1;
}

int quran_juzu_of(quran_loc_t loc) {
    for (int j = 29; j >= 0; --j) {
        if (loc >= quran.juzus[j]) {
            return j;
        }
    }
    return -1;
}

int quran_search(wchar_t *target, bool simple, void *user,
                 void (*onmatch)(int i, quran_loc_t loc, int start, int end, void *user)) {
    size_t target_len   = wcslen(target);
    size_t target_match = 0;
    int    index_start  = 0;
    int    index_end    = 0;
    int    matches      = 0;

    size_t       len;
    quran_chr_t *txt;
    wchar_t      c;

    for (int s = 0; s < QURAN_SURAS; ++s) {
        for (int a = 0; a < quran.sura_ayas[s]; ++a) {
            len = quran_read(s, a, &txt);
            for (size_t i = 0; i < len; ++i) {
                c = (wchar_t) QURAN_TXT_DEC(txt[i]);
                if (simple) c = quran_simplify_char(c);
                if (!c) continue;

                if (target[target_match] == c) {
                    if (target_match == 0) {
                        index_start = i;
                    }
                    ++target_match;
                } else {
                    target_match = 0;
                }
                if (target_match == target_len) {
                    index_end = i;
                    ++matches;
                    if (onmatch != NULL) {
                        onmatch(matches, QURAN_LOC(s, a),
                                index_start, index_end, user);
                    }
                }
            }
        }
    }

    return matches;
}

struct match_res {
    int count;
    quran_loc_t *locs;
};

void quran_search_locs_onmatch(int _, quran_loc_t loc, int start, int end, void *user) {
    (void) start; // TODO: consider adding
    (void) end;
    struct match_res *res = (struct match_res *) user;
    if (res->locs == NULL) return;
    res->locs[res->count++] = loc;
}

int quran_search_locs(quran_loc_t *locs, wchar_t *target, bool simple) {
    struct match_res r = {0, locs};
    return quran_search(target, simple, (void *) &r,
                        quran_search_locs_onmatch);
}
