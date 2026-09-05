#include <stdio.h>
#include <stdarg.h>
#include <stdbool.h>
#include <wchar.h>
#include <locale.h>
#include <wctype.h>

#include "quran_core.h"

#define WCHAR_MALLOC(name, count) wchar_t *name = malloc(count * sizeof(wchar_t))
#define WCHAR_FREE(ptr) free(ptr)

/* #define WCHAR_MALLOC(name, count) wchar_t name[count * sizeof(wchar_t)] */
/* #define WCHAR_FREE(ptr) ((void) 0) */

// TODO: reduce allocations
// TODO: stop using printf
// TODO: use quran_chr_t instead of wchar_t
// TODO: strict size checks

static bool has_break_at(int page, int w_count) {
    for (int l = 0; l < 15; ++l) {
        if (quran.breaks[page][l] &&
            quran.breaks[page][l] == w_count) {
            return true;
        }
    }
    return false;
}

static bool is_printable(wchar_t c) {
    return !quran_is_tashkeel(c) || quran_is_stop_sign(c);
}

static size_t center_swprintf(int width, wchar_t *buf, size_t size,
                              const wchar_t *format, ...) {
    va_list args;
    int     len, len_printable = 0;
    bool    nl = false;

    va_start(args, format);
    len = vswprintf(buf, size, format, args);
    va_end(args);

    if (buf[len - 1] == '\n') {
        --len;
        nl = true;
    }
    for (int i = 0; i < len; ++i) {
        if (is_printable(buf[i])) {
            ++len_printable;
        }
    }

    int padding;
    bool one_more;
    if (width > len_printable) {
        padding = (width - len_printable) / 2;
        one_more = (width - len_printable) % 2 != 0;
    } else {
        padding = 0;
        one_more = false;
    }
    len = 0;

#define CENTER_FMT L" "

    for (int i = 0; i < padding; i++) {
        len += swprintf(len + buf, size, CENTER_FMT);
    }

    va_start(args, format);
    len += vswprintf(len + buf, size, format, args);
    va_end(args);
    if (nl) --len;

    for (int i = 0; i < padding; i++) {
        len += swprintf(len + buf, size, CENTER_FMT);
    }
    if (one_more) {
        len += swprintf(len + buf, size, CENTER_FMT);
    }
    if (nl) len += swprintf(len + buf, size, L"\n");

    return len;
#undef CENTER_FMT
}

static bool can_add_tatweel(wchar_t c, wchar_t *next_ptr) {
    return false; // TODO: bring tatweel back once improved
    if (next_ptr != NULL) {
        // false if at the end of the word
        if (*next_ptr == L'\0' || *next_ptr == L' ') return false;
        while (*next_ptr && quran_is_tashkeel(*next_ptr)) ++next_ptr;
        if (*next_ptr == L'\0' || *next_ptr == L' ') return false;
    }
    // Not after: ا د ذ ر ز و ء
    // Not before: ء
    static const wchar_t allowed[] = L"جحخهعغفقثصضطكمنتبيسشظئ";
    for (size_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); ++i) {
        if (c == allowed[i]) {
            return true;
        }
    }
    return false;
}

static size_t justify_line(wchar_t *out, wchar_t *line,
                           int target_width, bool nest, float percent) {
    size_t len = wcslen(line);

    // Skip if the line starts with a space (probably centered)
    if (line[0] == L' ') {
        wcscpy(out, line);
        return len;
    }

    // Count words and printable characters
    int word_count    = 0;
    int char_count    = 0;
    int tatweel_count = 0;
    int in_word       = 0;

    for (size_t i = 0; line[i]; i++) {
        if (!iswspace(line[i])) {
            if (!in_word) {
                // Count words
                ++word_count;
                in_word = 1;
            }

            if (is_printable(line[i])) {
                // Only printable chars; skip tashkeel
                ++char_count;
            }

            if (line[i + 1] && line[i] == L'ل') {
                // Count لا variations as one char
                switch (line[i + 1]) {
                case L'ا':
                case L'أ':
                case L'إ':
                case L'آ':
                    --char_count;
                    break;
                }
            }

            if (can_add_tatweel(line[i], &line[i + 1])) {
                ++tatweel_count;
            }
        } else {
            in_word = 0;
        }
    }

    if (word_count < 2 || char_count >= target_width) {
        wcscpy(out, line);
        return len;
    }

    if (nest) {
        // Modify target width and maybe center if needed
        bool ok = false;
        size_t w = target_width;
        if (percent != 1) {
            w = (int) w * percent;
        } else if (word_count <= 4) {
            w = (int) w * .4;
        } else if (word_count <= 5) {
            w = (int) w * .6;
        } else if (word_count<= 6) {
            w = (int) w * .7;
        } else {
            ok = true;
        }
        // If too little words, reduce with and then center
        if (!ok) {
            WCHAR_MALLOC(tmp, QURAN_LINE_MAX_WCHARS);
            len = justify_line(tmp, line, w, false, 1);
            len = center_swprintf(target_width, out, QURAN_LINE_MAX_WCHARS, L"%S", tmp);
            WCHAR_FREE(tmp);
            return len;
        }
    }

    int spaces_needed = target_width - char_count;
    int gaps = word_count - 1;
    if (spaces_needed - tatweel_count > gaps) {
        spaces_needed -= tatweel_count;
        // TODO: 50/50 distribution between spaces and tatweel
    } else {
        tatweel_count = 0;
        if (spaces_needed < gaps) {
            // No space, at least one space after every word
            spaces_needed = gaps;
        }
    }
    int space_per_gap = spaces_needed / gaps;
    int extra_spaces  = spaces_needed % gaps;

    // Allocate enough space
    //size_t max_out_len = wcslen(line) + spaces_needed + tatweel_count + 1;
    WCHAR_MALLOC(result, QURAN_PAGE_MAX_WCHARS);

    wchar_t *dst = result;
    wchar_t *ptr = line;
    in_word = 0;
    int gap_index = 0;
    static const wchar_t tatweel = L'ـ';

    while (*ptr) {
        // Copy word
        while (*ptr && !iswspace(*ptr)) {
            *dst++ = *ptr++;
            if (tatweel_count > 0 &&
                can_add_tatweel(*(ptr - 1), ptr)) {
                *dst++ = tatweel;
                --tatweel_count;
                // TODO: this will add tatweel at the beginning only,
                //       distribute better
            }
            in_word = 1;
        }

        // Insert justified spaces (after word, if not last)
        if (in_word && gap_index < gaps) {
            int num_spaces = space_per_gap + (gap_index < extra_spaces ? 1 : 0);
            for (int i = 0; i < num_spaces; i++) {
                *dst++ = L' ';
            }
            gap_index++;
            in_word = 0;
        }

        // Skip any existing spaces
        while (*ptr && iswspace(*ptr)) {
            ptr++;
        }
    }

    *dst = L'\0';

    // Safely copy to output
    size_t written_len = dst - result;
    wcsncpy(out, result, written_len + 1); // +1 to include null-terminator
    WCHAR_FREE(result);

    return written_len;
}

static size_t justify_text(wchar_t *out, wchar_t* text, int target_width, bool nest, float *percents) {
    wchar_t *start   = text;
    size_t   len;
    size_t   len_tot = 0;
    size_t   l_count = 0;
    wchar_t *end;
    float    percent;

    while (*start) {
        end = wcschr(start, L'\n');
        if (percents != NULL) {
            percent = percents[l_count];
        } else {
            percent = 1;
        }
        if (!end) {
            // Last line
            len = justify_line(len_tot + out, start, target_width, nest, percent);
            len_tot += len;
            ++l_count;
            break;
        } else {
            *end = L'\0';  // Temporarily null-terminate the line
            len = justify_line(len_tot + out, start, target_width, nest, percent);
            len_tot += len + 1; // +1 for the newline
            *(len_tot + out - 1) = L'\n';
            *end = L'\n';  // Restore newline
            start = end + 1;
            ++l_count;
        }
    }

    return len_tot;
}

static size_t swprint_page_base(wchar_t *buf, int page, bool simple) {
    wchar_t *buf_init = buf;
    size_t print_size = QURAN_PAGE_MAX_WCHARS;
    size_t print_len;

#define PPRINT(...)  do {                                   \
        print_len = swprintf(buf, print_size, __VA_ARGS__); \
        buf += print_len;                                   \
        print_size -= print_len;                            \
    } while (0)

#define CPPRINT(...) do {                                           \
        print_len = center_swprintf(QURAN_LINE_MAX_WIDTH,           \
                                    buf, print_size, __VA_ARGS__);  \
        buf += print_len;                                           \
        print_size -= print_len;                                    \
    } while (0)

#define PRINT_SURA_NAME(num) CPPRINT(L"--{ سورة %S %d }--\n",         \
                                     quran.sura_names[num], num + 1)

    quran_loc_t loc = quran.pages[page];
    quran_loc_t loc_next_page;
    if (page < QURAN_PAGES - 1) {
        loc_next_page = quran.pages[page + 1];
    } else {
        loc_next_page = QURAN_LOC_END;
    }

    int sura, aya, juzu;

    juzu = quran_juzu_of(loc);
    sura = QURAN_SURA(loc);
    CPPRINT(L"صفحة %d\n", page + 1); // Center
    wchar_t *tmp = buf;
    buf = buf_init;
    PPRINT(L" سورة %S %d", quran.sura_names[sura], sura + 1); // Right
    *buf = L' ';
    wchar_t juzu_buf[64];
    buf = buf_init + QURAN_LINE_MAX_WIDTH - 1 -
        swprintf(juzu_buf, sizeof(juzu_buf) / sizeof(wchar_t), L" الجزء %d", juzu + 1);
    PPRINT(L"%S", juzu_buf); // Left
    *buf = L' ';
    buf = tmp;

    wchar_t bismillah[64];
    size_t len;
    len = quran_read_wchar(0, 0, bismillah, quran_read(0, 0, NULL), simple);
    bismillah[len] = '\0';

    int l_count = 0;
    int w_count = 0;
    while (loc < loc_next_page) {
        sura = QURAN_SURA(loc);
        aya = QURAN_AYA(loc);

        if (aya == 0) {
            PRINT_SURA_NAME(sura);
            ++l_count;
            if (sura != 0 && sura != 8) {
                CPPRINT(L"%S\n", bismillah);
                ++l_count;
            }
        }

        quran_chr_t *txt;
        size_t       len;
        wchar_t      c, c_next1, c_next2;

#define NEWL0() do {                            \
            if (has_break_at(page, w_count)) {  \
                PPRINT(L"\n");                  \
                ++l_count;                      \
            } else {                            \
                PPRINT(L" ");                   \
            }                                   \
            ++w_count;                          \
        } while (0)
#define NEWL1() do {                            \
            if (has_break_at(page, w_count)) {  \
                PPRINT(L"-\n");                 \
                ++l_count;                      \
            } else {                            \
                PPRINT(L".");                   \
            }                                   \
            ++w_count;                          \
        } while (0)
#define NEWL2() do {                                        \
            if (has_break_at(page, w_count)) {              \
                PPRINT(L"(%d) === %d\n", w_count, l_count); \
                ++l_count;                                  \
            } else {                                        \
                PPRINT(L"(%d).", w_count);                  \
            }                                               \
            ++w_count;                                      \
        } while (0)
#define NEWL NEWL0

        len = quran_read(sura, aya, &txt);
        for (size_t i = 0; i < len; ++i) {
            c = (wchar_t) QURAN_TXT_DEC(txt[i]);
            if (i + 2 < len) {
                c_next1 = (wchar_t) QURAN_TXT_DEC(txt[i + 1]);
                c_next2 = (wchar_t) QURAN_TXT_DEC(txt[i + 2]);
            } else {
                c_next1 = c_next2 = L'\0';
            }
            if (simple) c = quran_simplify_char(c);
            if (!c) continue;
            if (c == L'۩') --w_count;
            if (c ==  L' ' &&
                // not space then stop sign then space
                !(c == L' ' && c_next1 !=  L' ' && c_next2 ==  L' ')) {
                NEWL();
                continue;
            }
            PPRINT(L"%C", c);
        }
        NEWL();
        PPRINT(L"{%d}", aya + 1);
        NEWL();

        loc = QURAN_LOC_NEXT(loc);
    }

    if (l_count == 14 && QURAN_AYA(loc) == 0) {
        // Add the sura name at the bottom of the page (e.g. p594)
        PRINT_SURA_NAME(QURAN_SURA(loc));
        ++l_count;
    } else if (l_count == 16) {
        // Delete the sura name from the top of the page (e.g. p595)
        wchar_t* newline1 = wcschr(buf_init, L'\n');
        wchar_t* newline2 = wcschr(newline1 + 1, L'\n');
        wmemmove(newline1 + 1, newline2 + 1, wcslen(newline2 + 1) + 1);
        return wcslen(buf_init + 1);
    } else if (*(buf - 1) != L'\n') {
        // Not sure why, but sometimes the last break is in the dataset and
        // sometimes it's not, so, a final check
        PPRINT(L"\n");
    }

#undef PPRINT
#undef CPPRINT
#undef PRINT_SURA_NAME
#undef NEWL
#undef NEWL0
#undef NEWL1
#undef NEWL2

    return buf - buf_init;
}

size_t swprint_page(wchar_t *buf, int page, bool simple, bool just) {
    size_t len;
    len = swprint_page_base(buf, page, simple);
    if (!just) return len;
    WCHAR_MALLOC(out, QURAN_PAGE_MAX_WCHARS);
    static float percents_custom[] = {1, 1, .4, .6, .7, .7, .7, .5, .25};
    float *percents = page < 2 ? percents_custom : NULL;
    bool nest = page <= 1 || page >= 600;
    len = justify_text(out, buf, QURAN_LINE_MAX_WIDTH, nest, percents);
    wcscpy(buf, out);
    WCHAR_FREE(out);
    return len;
}

size_t fwprint_page(FILE *f, int page, bool simple, bool just) {
    WCHAR_MALLOC(buf, QURAN_PAGE_MAX_WCHARS);
    swprint_page(buf, page, simple, just);
    size_t len = fwprintf(f, L"%S", buf);
    WCHAR_FREE(buf);
    return len;
}

static void sura_pages_range(int *p_start, int *p_end, int sura) {
    quran_loc_t loc_start = QURAN_LOC(sura, 0);
    quran_loc_t loc_end   = QURAN_LOC(sura + 1, 0);
    int p;
    *p_start = 0;
    *p_end = 0;
    for (p = QURAN_PAGES - 1; p >= 0; --p) {
        if (loc_end >= quran.pages[p]) {
            *p_end = p;
            break;
        }
    }
    for (p = QURAN_PAGES - 1; p >= 0; --p) {
        if (loc_start >= quran.pages[p]) {
            *p_start = p;
            break;
        }
    }
    if (*p_start == *p_end) ++*p_end;
}

size_t swprint_sura(wchar_t *out, int sura, bool simple, bool just) {
    int p_start, p_end;
    sura_pages_range(&p_start, &p_end, sura);
    size_t len = 0;
    for (int p = p_start; p < p_end; ++p) {
        len += swprint_page(len + out, p, simple, just);
        if (p != p_end - 1) {
            len += swprintf(len + out, 2, L"\n");
        }
    }
    return len;
}

size_t fwprint_sura(FILE *f, int sura, bool simple, bool just) {
    int p_start, p_end;
    sura_pages_range(&p_start, &p_end, sura);
    size_t len = 0;
    for (int p = p_start; p < p_end; ++p) {
        len += fwprint_page(f, p, simple, just);
        if (p != p_end - 1) {
            len += fwprintf(f, L"\n");
        }
    }
    return len;
}

size_t wprint_index(wchar_t *out, size_t size) {
    int sura, page, juzu = 0;
    quran_loc_t loc, loc_last;
    size_t len = 0;
    for (sura = 0; sura < QURAN_SURAS; ++sura) {
        loc      = QURAN_LOC(sura, 0);
        loc_last = QURAN_LOC(sura, quran.sura_ayas[sura] - 1);
        page     = quran_page_of(loc);
        while (juzu < QURAN_JUZUS && loc_last >= quran.juzus[juzu]) {
            len += swprintf(out + len, size - len, L"%d الجزء %d\n",
                            quran_page_of(quran.juzus[juzu]) + 1, juzu + 1);
            ++juzu;
        }
        len += swprintf(out + len, size - len, L"%d سورة %S (%d)\n",
                        page + 1, quran.sura_names[sura], sura + 1);
    }
    return len;
}

size_t fwprint_index(FILE *f) {
    const size_t size = 2048 + 1024;
    WCHAR_MALLOC(buf, size);
    wprint_index(buf, size);
    size_t len = fwprintf(f, L"%S", buf);
    WCHAR_FREE(buf);
    return len;
}

size_t fwprint_all(const char *dir, bool simple, bool just) {
    size_t len = 0;
    char fname[64];
    for (int p = 0; p < QURAN_PAGES; ++p) {
        sprintf(fname, "./%s/%d.txt", dir, p);
        FILE *f = fopen(fname, "w");
        len += fwprint_page(f, p, simple, just);
        fclose(f);
    }
    return len;
}
