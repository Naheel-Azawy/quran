#include <stdio.h>
#include <stdarg.h>
#include <stdbool.h>
#include <wchar.h>
#include <locale.h>
#include <wctype.h>

#include "quran_core.h"
#include "quran_printer.h"

#define WCHAR_MALLOC(name, count) wchar_t name[count]
#define WCHAR_FREE(ptr) ((void) 0)

// TODO: stop using printf
// TODO: use quran_chr_t instead of wchar_t
// TODO: strict size checks

// Extra room for the juzu/sura listing on top of one page of text
#define QURAN_INDEX_MAX_WCHARS (QURAN_PAGE_MAX_WCHARS + 1024)

// Share of the extra line width filled with tatweel, the rest goes to spaces
#define TATWEEL_RATIO .8
// Max number of tatweel that can be stacked at a single spot
#define TATWEEL_MAX_REPEAT 3
// Tatweel stretching the س of بِسْمِ in the sura-opening basmala
#define BISMILLAH_TATWEEL 8

static bool has_break_at(int page, int w_count) {
    for (int l = 0; l < 15; ++l) {
        if (quran.breaks[page][l] &&
            quran.breaks[page][l] == w_count) {
            return true;
        }
    }
    return false;
}

void quran_printer_init(void) {
    // Wide output fails in the C locale: musl's wcrtomb rejects any wchar
    // above 0x7F when MB_CUR_MAX is 1, so every swprintf holding Arabic
    // returns -1. The JS side cannot pass a string, so set it here.
    setlocale(LC_ALL, "C.UTF-8");
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

static bool is_alef(wchar_t c) {
    switch (c) {
    case L'ا':
    case L'أ':
    case L'إ':
    case L'آ':
    case L'ٱ':
    case L'ٲ':
    case L'ٳ':
    case L'ٵ':
        return true;
    }
    return false;
}

// Hamza as a standalone letter or as a combining mark
static bool is_hamza(wchar_t c) {
    return c == L'ء' || c == L'\u0654' || c == L'\u0655';
}

// True if c is a ل that starts the لا ligature: it is followed by an alef,
// possibly with harakat, hamza or tatweel in between. next is the char after
// c. The source text itself carries a tatweel before a combining hamza
// (e.g. ٱلْـَٔاخِرَةِ), so an existing tatweel must not hide the ligature.
static bool is_lam_alef(wchar_t c, const wchar_t *next) {
    if (c != L'ل' || next == NULL) return false;
    while (*next && (quran_is_tashkeel(*next) || is_hamza(*next) ||
                     *next == L'ـ')) ++next;
    return is_alef(*next);
}

static bool can_add_tatweel(wchar_t c, wchar_t *next_ptr) {
    if (next_ptr != NULL) {
        // Never split the لا ligature, even with harakat or hamza between
        if (is_lam_alef(c, next_ptr)) return false;
        // false if at the end of the word
        if (*next_ptr == L'\0' || *next_ptr == L' ') return false;
        while (*next_ptr && quran_is_tashkeel(*next_ptr)) ++next_ptr;
        if (*next_ptr == L'\0' || *next_ptr == L' ') return false;
        // Hamza never joins to the letter before it
        if (*next_ptr == L'ء') return false;
    }
    // Not after: ا د ذ ر ز و ء
    // Not before: ء
    static const wchar_t allowed[] = L"جحخهعغفقثصضطكلمنتبيسشظئ";
    for (size_t i = 0; allowed[i]; ++i) {
        if (c == allowed[i]) {
            return true;
        }
    }
    return false;
}

// True if the word starting at w is the name of God, with or without a
// one-letter prefix (و ف ب ت ك): ٱللَّهِ، لِلَّهِ، وَٱللَّهُ، بِٱللَّهِ، وَلِلَّهِ...
// Harakat, stop signs, dagger alef and existing tatweel are ignored, so the
// match works on the bare letters. The word ends at whitespace or NUL.
static bool is_allah_word(const wchar_t *w) {
    wchar_t l[8];
    size_t  n = 0;
    for (; *w && !iswspace(*w); ++w) {
        if (quran_is_tashkeel(*w) || *w == L'ـ') continue;
        if (n == 7) return false; // too long to be the name
        l[n++] = *w;
    }
    l[n] = L'\0';

    size_t p = 0;
    if (n >= 4 && wcschr(L"وفبتك", l[p]) != NULL &&
        (is_alef(l[p + 1]) || l[p + 1] == L'ل')) {
        ++p;
    }
    if (is_alef(l[p])) ++p;
    return n - p == 3 && l[p] == L'ل' && l[p + 1] == L'ل' && l[p + 2] == L'ه';
}

static size_t justify_line(wchar_t *out, wchar_t *line,
                           int target_width, bool nest, float percent) {
    size_t len = wcslen(line);

    // Never pad past the buffers, whatever width the caller asks for
    if (target_width < 1) target_width = 1;
    if (target_width > QURAN_LINE_MAX_WIDTH) target_width = QURAN_LINE_MAX_WIDTH;

    // Skip if the line starts with a space (probably centered)
    if (line[0] == L' ') {
        wcscpy(out, line);
        return len;
    }

    // Count words and printable characters
    int word_count    = 0;
    int char_count    = 0;
    int tatweel_slots = 0;
    int tatweel_count = 0;
    int in_word       = 0;
    bool no_tatweel   = false; // current word is the name of God

    for (size_t i = 0; line[i]; i++) {
        if (!iswspace(line[i])) {
            if (!in_word) {
                // Count words
                ++word_count;
                in_word = 1;
                no_tatweel = is_allah_word(&line[i]);
            }

            if (is_printable(line[i])) {
                // Only printable chars; skip tashkeel
                ++char_count;
            }

            if (is_lam_alef(line[i], &line[i + 1])) {
                // Count لا variations as one char (harakat or hamza
                // in between do not break the ligature)
                --char_count;
            }

            if (!no_tatweel && can_add_tatweel(line[i], &line[i + 1])) {
                ++tatweel_slots;
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
    if (tatweel_slots > 0 && spaces_needed > gaps) {
        // Distribute the extra width between tatweel and spaces, one space
        // per gap is always kept out of the split
        tatweel_count = (int) ((spaces_needed - gaps) * TATWEEL_RATIO);
        if (tatweel_count > tatweel_slots * TATWEEL_MAX_REPEAT) {
            tatweel_count = tatweel_slots * TATWEEL_MAX_REPEAT;
        }
        spaces_needed -= tatweel_count;
    } else if (spaces_needed < gaps) {
        // No space, at least one space after every word
        spaces_needed = gaps;
    }
    int space_per_gap = spaces_needed / gaps;
    int extra_spaces  = spaces_needed % gaps;

    // Allocate enough space
    //size_t max_out_len = wcslen(line) + spaces_needed + tatweel_count + 1;
    WCHAR_MALLOC(result, QURAN_PAGE_MAX_WCHARS);

    wchar_t *dst = result;
    wchar_t *ptr = line;
    in_word = 0;
    int gap_index     = 0;
    int tatweel_index = 0;
    static const wchar_t tatweel = L'ـ';

    while (*ptr) {
        // Copy word
        no_tatweel = is_allah_word(ptr);
        while (*ptr && !iswspace(*ptr)) {
            *dst++ = *ptr++;
            if (tatweel_count > 0 && !no_tatweel &&
                can_add_tatweel(*(ptr - 1), ptr)) {
                // Copy the tashkeel first, so it stays on the letter
                // and not on the tatweel
                while (*ptr && quran_is_tashkeel(*ptr)) {
                    *dst++ = *ptr++;
                }
                // Spread the tatweels evenly over the possible slots
                int num_tatweel =
                    (tatweel_index + 1) * tatweel_count / tatweel_slots -
                    tatweel_index * tatweel_count / tatweel_slots;
                for (int i = 0; i < num_tatweel; i++) {
                    *dst++ = tatweel;
                }
                ++tatweel_index;
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

static size_t justify_text(wchar_t *out, wchar_t* text, int target_width,
                           bool nest, float *percents, size_t percents_len) {
    wchar_t *start   = text;
    size_t   len;
    size_t   len_tot = 0;
    size_t   l_count = 0;
    wchar_t *end;
    float    percent;

    while (*start) {
        end = wcschr(start, L'\n');
        if (percents != NULL && l_count < percents_len) {
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

    // The last line wrote a newline over its terminator
    out[len_tot] = L'\0';

    return len_tot;
}

// Stretch the س of بِسْمِ with tatweel, the way the printed mushaf elongates
// it. Tashkeel belongs on the letter, so the tatweel goes after any marks
// that follow the seen, matching how justify_line inserts them. Returns the
// new length; the string is left untouched if there is no room.
static size_t stretch_bismillah(wchar_t *s, size_t len, size_t size) {
    static const wchar_t tatweel = L'ـ';
    size_t i = 0;

    while (i < len && s[i] != L'س') ++i;
    if (i == len) return len;
    ++i;
    while (i < len && quran_is_tashkeel(s[i])) ++i;

    // +1 so the terminator that wmemmove carries along still fits
    if (len + BISMILLAH_TATWEEL + 1 > size) return len;

    wmemmove(s + i + BISMILLAH_TATWEEL, s + i, len - i + 1);
    wmemset(s + i, tatweel, BISMILLAH_TATWEEL);
    return len + BISMILLAH_TATWEEL;
}

static size_t swprint_page_base(wchar_t *buf, int page, bool simple) {
    if (page < 0 || page >= QURAN_PAGES) {
        // The pager asks for the pages around the edges too
        *buf = L'\0';
        return 0;
    }

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
    len = stretch_bismillah(bismillah, len,
                            sizeof(bismillah) / sizeof(bismillah[0]));

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
            c_next1 = (i + 1 < len) ? (wchar_t) QURAN_TXT_DEC(txt[i + 1]) : L'\0';
            c_next2 = (i + 2 < len) ? (wchar_t) QURAN_TXT_DEC(txt[i + 2]) : L'\0';
            if (simple) c = quran_simplify_char(c);
            if (!c) continue;

            // if (c == L'۩') --w_count;
            // NOTE: ۩ is a token of its own in the breaks table -- it is
            // preceded by a space, so it consumes a slot like any other
            // word, and may open a line just as an aya marker can. Rolling
            // w_count back here made the break before it fire a second time
            // at the aya-end gap, stranding ۩ alone and pushing {n} onto a
            // third line; it also shifted every later break by one, leaving
            // the page's trailing break unreachable and tripping the
            // sura-name hack below (p453). Note simple mode never reached
            // the rollback, since ۩ simplifies to 0 and continues out above,
            // so it always agreed with the table.

            if (c ==  L' ' &&
                // not space then stop sign then space
                !(c == L' ' && c_next1 !=  L' ' && c_next2 ==  L' ')) {
                NEWL();
                continue;
            }
            PPRINT(L"%C", c);
        }
        // The same applies to the last aya of a sura, even mid-page (e.g.
        // {62} of sura 53 on p528): the table generator derives that line's
        // break from the last text word, so it lands before the marker. Left
        // alone, {62} was stranded at the start of the next line, the sura
        // header was appended to it, and justify_line then stretched the
        // header with tatweel because the line no longer began with a space.
        //
        // A break at the gap before an aya marker is legitimate mid-page:
        // the marker simply opens the next line, joined by the words that
        // follow it (e.g. {54} on p7).
        //
        // The exception is the last aya on the page. There is nothing after
        // its marker to share a line with, so a break there would strand
        // "{n}" alone on an extra line -- and push l_count to 16, tripping
        // the sura-name hack below into deleting a real line of text. That
        // happens because a page's trailing break is generated from the last
        // text word and misses the closing marker, landing one gap early
        // (e.g. p26, where it is 129 but should be 130). For that case only,
        // keep the marker's word slot so w_count stays in step with the
        // table, but carry the break over to after the marker.
        quran_loc_t loc_next = QURAN_LOC_NEXT(loc);
        if (loc_next >= loc_next_page || QURAN_AYA(loc_next) == 0) {
            bool brk = has_break_at(page, w_count);
            PPRINT(L" ");
            ++w_count;
            PPRINT(L"{%d}", aya + 1);
            if (brk || has_break_at(page, w_count)) {
                PPRINT(L"\n");
                ++l_count;
            } else {
                PPRINT(L" ");
            }
            ++w_count;
        } else {
            NEWL();
            PPRINT(L"{%d}", aya + 1);
            NEWL();
        }

        loc = loc_next;
    }

    if (*(buf - 1) != L'\n') {
        // Not sure why, but sometimes the last break is in the dataset and
        // sometimes it's not, so, a final check. Close the line before
        // counting, l_count only sees the breaks that were printed.
        PPRINT(L"\n");
        ++l_count;
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
    size_t percents_len = sizeof(percents_custom) / sizeof(percents_custom[0]);
    bool nest = page <= 1 || page >= 600;
    len = justify_text(out, buf, QURAN_LINE_MAX_WIDTH, nest,
                       percents, percents_len);
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
    // One line per entry, "<page> <kind> ...", in page order; the entries
    // come from the same quran_index() the web UI uses.
    quran_index_entry_t entries[QURAN_SURAS + QURAN_JUZUS];
    size_t count = quran_index(entries, sizeof(entries) / sizeof(entries[0]));
    size_t len = 0;
    int    n;

    if (size == 0) return 0;
    out[0] = L'\0';
    for (size_t i = 0; i < count; ++i) {
        const quran_index_entry_t *e = &entries[i];
        if (e->kind == QURAN_INDEX_JUZU) {
            n = swprintf(out + len, size - len, L"%d الجزء %d\n",
                         e->page + 1, e->number + 1);
        } else {
            n = swprintf(out + len, size - len, L"%d سورة %S (%d)\n",
                         e->page + 1, quran.sura_names[e->number],
                         e->number + 1);
        }
        if (n < 0) break; // out of room: keep the whole lines written so far
        len += n;
    }
    return len;
}

size_t fwprint_index(FILE *f) {
    WCHAR_MALLOC(buf, QURAN_INDEX_MAX_WCHARS);
    wprint_index(buf, QURAN_INDEX_MAX_WCHARS);
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
