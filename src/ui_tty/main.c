#include <stdio.h>
#include <wchar.h>
#include <locale.h>
#include <limits.h>
#include <unistd.h>
#include <string.h>
#include <time.h>

#include "../quran_core.h"
#include "../quran_printer.h"
#include "bidi.h"
#include "tui.h"
#include "../../build/version.h"

// Quran text goes out through the functions below. By default it is run
// through libfribidi, as piping the output through `fribidi -w 75` used to do:
// lines wider than CLI_WIDTH are wrapped at spaces, every line is reordered and
// shaped, and right-to-left lines are padded to CLI_WIDTH so they sit flush
// right. With -b (or a build without fribidi) the text is printed as it is, in
// logical order, for a terminal that does bidi itself.
#define CLI_WIDTH 75

static bool    cli_bidi = true;
static wchar_t cli_line[4096];
static size_t  cli_len;

// One display line: reordered, padded if right to left, newline added.
static void cli_emit(const wchar_t *s, size_t n) {
    wchar_t vis[BIDI_MAX];
    bool    rtl;
    size_t  vn = bidi_visual(s, n, vis, true, false, &rtl);

    if (rtl)
        for (int i = bidi_str_w(vis, vn); i < CLI_WIDTH; ++i) putwchar(L' ');
    for (size_t i = 0; i < vn; ++i) putwchar(vis[i]);
    putwchar(L'\n');
}

// Columns a logical string takes once shaped: a lam-alef pair becomes one
// ligature, so measuring the logical text would overstate it.
static int cli_width(const wchar_t *s, size_t n) {
    wchar_t vis[BIDI_MAX];
    bool    rtl;
    size_t  vn = bidi_visual(s, n, vis, true, false, &rtl);
    return bidi_str_w(vis, vn);
}

// The pending logical line, wrapped to CLI_WIDTH where it is wider.
static void cli_end_line(void) {
    size_t seg = 0, i = 0;
    int    sw = 0;

    if (cli_len < BIDI_MAX && cli_width(cli_line, cli_len) <= CLI_WIDTH) {
        cli_emit(cli_line, cli_len);
    } else {
        while (i < cli_len) {
            size_t j = i;
            int    ww;
            while (j < cli_len && cli_line[j] != L' ') ++j;
            ww = cli_width(cli_line + i, j - i < BIDI_MAX ? j - i : BIDI_MAX - 1);
            if (sw > 0 && sw + 1 + ww > CLI_WIDTH) { // the word starts a new line
                cli_emit(cli_line + seg, i - 1 - seg);
                seg = i;
                sw = 0;
            }
            sw += (sw ? 1 : 0) + ww;
            i = j < cli_len ? j + 1 : j;
        }
        cli_emit(cli_line + seg, cli_len - seg);
    }
    cli_len = 0;
}

static void cli_putc(wchar_t c) {
    if (!cli_bidi) { putwchar(c); return; }
    if (c == L'\n') { cli_end_line(); return; }
    if (cli_len == sizeof cli_line / sizeof *cli_line - 1) cli_end_line(); // absurdly long
    cli_line[cli_len++] = c;
}

static void cli_puts(const wchar_t *s) {
    for (; *s; ++s) cli_putc(*s);
}

// A last line without a newline of its own.
static void cli_flush(void) {
    if (cli_bidi && cli_len > 0) cli_end_line();
}

void read_wchar_test() {
    bool simple = true;
    int sura = 0, aya = 0;
    wchar_t out[QURAN_PAGE_MAX_WCHARS];
    size_t len, len_real;

    //len = quran_read_wchar(sura, aya, NULL, LONG_MAX, simple); // real length (lighter)
    len = quran_read(sura, aya, NULL); // complex text length (faster)
    // Clamp: quran_read_wchar has no size argument for the aya itself,
    // only for how much of it we're willing to receive
    if (len >= QURAN_PAGE_MAX_WCHARS) len = QURAN_PAGE_MAX_WCHARS - 1;
    len_real = quran_read_wchar(sura, aya, out, len, simple);
    // quran_read_wchar does not null-terminate
    out[len_real] = L'\0';

    wprintf(L"%zu %zu >>>%S<<<\n", len, len_real, out);
}

void print_aya(int sura, int aya, bool simple) {
    wchar_t      num[16];
    quran_chr_t *txt;
    size_t       len;
    wchar_t      c;

    swprintf(num, sizeof num / sizeof *num, L"{%d} ", aya + 1);
    cli_puts(num);

    len = quran_read(sura, aya, &txt);
    for (size_t i = 0; i < len; ++i) {
        c = (wchar_t) QURAN_TXT_DEC(txt[i]);
        if (simple) c = quran_simplify_char(c);
        if (!c) continue;
        cli_putc(c);
    }
    cli_putc(L'\n');
}

void print_sura(int sura, bool simple, bool list) {
    if (!list) {
        // swprint_sura takes no size; the whole book is an upper bound for any sura
        wchar_t *buf = malloc(QURAN_PAGES * QURAN_PAGE_MAX_WCHARS * sizeof *buf);
        if (!buf) return;
        swprint_sura(buf, sura, simple, true);
        cli_puts(buf);
        free(buf);
        return;
    }

    for (int a = 0; a < quran.sura_ayas[sura]; ++a) {
        print_aya(sura, a, simple);
    }
    cli_putc(L'\n');
}

void print_page(int page, bool simple, bool list) {
    if (!list) {
        wchar_t buf[QURAN_PAGE_MAX_WCHARS];
        swprint_page(buf, page, simple, true);
        cli_puts(buf);
        return;
    }

    quran_loc_t loc = quran.pages[page];
    quran_loc_t loc_next;
    if (page < 603) {
        loc_next = quran.pages[page + 1];
    } else {
        loc_next = QURAN_LOC(113, 6);
    }

    while (loc < loc_next) {
        print_aya(QURAN_SURA(loc), QURAN_AYA(loc), simple);
        loc = QURAN_LOC_NEXT(loc);
    }
}

void print_all(bool simple) {
    size_t len;
    quran_chr_t *txt;
    wchar_t c;
    for (int s = 0; s < QURAN_SURAS; ++s) {
        for (int a = 0; a < quran.sura_ayas[s]; ++a) {
            len = quran_read(s, a, &txt);
            for (size_t i = 0; i < len; ++i) {
                c = (wchar_t) QURAN_TXT_DEC(txt[i]);
                if (simple) c = quran_simplify_char(c);
                if (!c) continue;
                cli_putc(c);
            }
        }
    }
}

void main_onmatch(int i, quran_loc_t loc, int start, int end, void *_) {
    int sura = QURAN_SURA(loc);
    int aya  = QURAN_AYA(loc);
    int page = quran_page_of(loc);
    wchar_t head[64];
    swprintf(head, sizeof head / sizeof *head, L"%d. {س%d آ%d ص%d} ", i, sura + 1, aya + 1, page + 1);
    cli_puts(head);

    quran_chr_t *txt;
    size_t       len;
    wchar_t      c;
    bool         simple = true;

    len = quran_read(sura, aya, &txt);
    for (size_t i = 0; i < len; ++i) {
        c = (wchar_t) QURAN_TXT_DEC(txt[i]);
        if ((int) i == start) cli_puts(L">>");
        if (simple) c = quran_simplify_char(c);
        if (!c) continue;
        cli_putc(c);
        if ((int) i == end) cli_puts(L"<<");
    }
    cli_putc(L'\n');
}

int count_letters(bool and_tashkeel) {
    int count = 0;
    size_t len;
    quran_chr_t *txt;
    wchar_t c;
    for (int s = 0; s < QURAN_SURAS; ++s) {
        for (int a = 0; a < quran.sura_ayas[s]; ++a) {
            len = quran_read(s, a, &txt);
            for (size_t i = 0; i < len; ++i) {
                c = (wchar_t) QURAN_TXT_DEC(txt[i]);
                if (!and_tashkeel) c = quran_simplify_char(c);
                if (!c) continue;
                ++count;
            }
        }
    }
    return count;
}

static void print_marker(int aya) {
    wchar_t buf[24];
    swprintf(buf, sizeof buf / sizeof *buf, L" {%d} ", aya);
    cli_puts(buf);
}

void print_from(bool and_tashkeel, int char_start, int str_len) {
    int count = 0;
    bool can_print;
    size_t len;
    quran_chr_t *txt;
    wchar_t c;
    for (int s = 0; s < QURAN_SURAS; ++s) {
        for (int a = 0; a < quran.sura_ayas[s]; ++a) {
            len = quran_read(s, a, &txt);
            can_print = false;
            for (size_t i = 0; i < len; ++i) {
                c = (wchar_t) QURAN_TXT_DEC(txt[i]);
                if (!and_tashkeel) c = quran_simplify_char(c);
                if (!c) continue;
                can_print = count >= char_start &&
                    count < (char_start + str_len);
                if (can_print) {
                    cli_putc(c);
                }
                ++count;
            }
            if (can_print) {
                print_marker(a);
            }
        }
    }
}

int count_words(bool and_tashkeel) {
    int count = 0;
    size_t len;
    quran_chr_t *txt;
    wchar_t c;
    for (int s = 0; s < QURAN_SURAS; ++s) {
        for (int a = 0; a < quran.sura_ayas[s]; ++a) {
            len = quran_read(s, a, &txt);
            for (size_t i = 0; i < len; ++i) {
                c = (wchar_t) QURAN_TXT_DEC(txt[i]);
                if (!and_tashkeel) c = quran_simplify_char(c);
                if (!c) continue;
                if (c == ' ') ++count;
            }
            ++count;
        }
    }
    return count;
}

void print_from_word(bool and_tashkeel, int word_start, int word_count) {
    int count = 0;
    bool can_print;
    size_t len;
    quran_chr_t *txt;
    wchar_t c;
    for (int s = 0; s < QURAN_SURAS; ++s) {
        for (int a = 0; a < quran.sura_ayas[s]; ++a) {
            len = quran_read(s, a, &txt);
            can_print = false;
            for (size_t i = 0; i < len; ++i) {
                c = (wchar_t) QURAN_TXT_DEC(txt[i]);
                if (!and_tashkeel) c = quran_simplify_char(c);
                if (!c) continue;
                can_print = count >= word_start &&
                    count < (word_start + word_count);
                if (can_print) {
                    cli_putc(c);
                }
                if (c == ' ') ++count;
            }
            ++count;
            if (can_print) {
                print_marker(a);
            }
        }
    }
}

void foo() {
    // fwprint_all("tmp_pages", false, true);

    bool and_tashkeel = false;

    /* int count = count_letters(and_tashkeel); */
    /* wprintf(L"%d\n", count); */
    /* print_from(and_tashkeel, count / 2 - 10, 100); */

    int wcount = count_words(and_tashkeel);
    wprintf(L"%d\n", wcount);
    print_from_word(and_tashkeel, wcount / 2 - 3, 10);
}

void help(char *bin) {
    wprintf(L"Usage: %s [-slpafixhtb] [SURA]\n", bin);
    wprintf(L"Version %s\n", QURAN_VERSION);
    wprintf(L"  (no arguments)   interactive reader, same as -t\n");
    wprintf(L"  -t [PAGE]        interactive reader; opens PAGE, default the last viewed\n");
    wprintf(L"  -b               no fribidi: print text in logical order, for a terminal\n");
    wprintf(L"                   that does bidi itself. Default: reordered, wrapped at %d\n", CLI_WIDTH);
    wprintf(L"  -s               simple text; no tashkeel\n");
    wprintf(L"  -l               print as a simple list\n");
    wprintf(L"  -p <PAGE>        print a page\n");
    wprintf(L"  -a <SURA> <AYA>  print one aya\n");
    wprintf(L"  -f <TEXT>        find text\n");
    wprintf(L"  -i               list indices\n");
    wprintf(L"  -x               run experimental function\n");
    wprintf(L"  -h               show this help\n");
    wprintf(L"\n");
    exit(EXIT_FAILURE);
}

int main(int argc, char **argv) {
    if (!setlocale(LC_ALL, "en_US.UTF-8") && !setlocale(LC_ALL, "C.UTF-8"))
        setlocale(LC_ALL, "");

    bool simple   = false;
    bool list     = false;
    bool page     = false;
    bool aya      = false;
    bool find     = false;
    bool index    = false;
    bool exp      = false;
    bool tui      = false;
    bool no_bidi  = false;
    char *args[2] = {NULL};

    int opt;
    while ((opt = getopt(argc, argv, "slpafixhtb")) != -1) {
        switch (opt) {
        case 's': simple = true; break;
        case 'l': list   = true; break;
        case 'p': page   = true; break;
        case 'a': aya    = true; break;
        case 'f': find   = true; break;
        case 'i': index  = true; break;
        case 'x': exp    = true; break;
        case 't': tui    = true; break;
        case 'b': no_bidi = true; break;
        case 'h': help(argv[0]); break;
        default:  help(argv[0]);
        }
    }
    for (int i = 0; optind < argc && i < 2; ++optind, ++i) {
        args[i] = argv[optind];
    }

    cli_bidi = !no_bidi && bidi_compiled();

    // no arguments on a terminal: the interactive reader
    if (argc == 1 && isatty(STDIN_FILENO) && isatty(STDOUT_FILENO)) tui = true;

    if (tui) {
        tui_opts_t opts = {
            .simple = simple,
            .list   = list,
            .bidi   = !no_bidi,
            .page   = (args[0] != NULL && atoi(args[0]) > 0) ? atoi(args[0]) - 1 : -1,
        };
        return tui_run(&opts);
    }

    if (exp) { // experimental
        foo();
    } else if (index) { // list pages, suras, and juzus
        wchar_t buf[8192];
        wprint_index(buf, sizeof buf / sizeof *buf);
        cli_puts(buf);
    } else if (find) { // search for target text
        char *target = args[0];
        size_t len = strlen(target);
        wchar_t wtarget[QURAN_LINE_MAX_WCHARS];
        if (len >= QURAN_LINE_MAX_WCHARS) {
            wprintf(L"Search text too long (max %d characters)\n",
                    QURAN_LINE_MAX_WCHARS - 1);
            return EXIT_FAILURE;
        }
        len = mbstowcs(wtarget, target, len);
        // mbstowcs does not guarantee a terminator when it stops at the
        // size limit rather than the source's own null byte
        wtarget[len] = L'\0';
        quran_search(wtarget, true, NULL, main_onmatch);
    } else if (page) { // one page
        int page = atoi(args[0]) - 1;
        print_page(page, simple, list);
    } else if (aya) { // one aya
        int sura = atoi(args[0]) - 1;
        int aya  = atoi(args[1]) - 1;
        if (aya < 0) aya = quran.sura_ayas[sura] + aya + 1;
        print_aya(sura, aya, simple);
    } else if (args[0] != NULL) { // sura
        int sura = atoi(args[0]) - 1;
        print_sura(sura, simple, list);
    } else { // random page
        srand(time(NULL));
        int page = rand() % QURAN_PAGES;
        print_page(page, simple, list);
    }

    cli_flush();
    return 0;
}
