#include <stdio.h>
#include <wchar.h>
#include <locale.h>
#include <limits.h>
#include <unistd.h>
#include <string.h>
#include <time.h>

#include "../quran_core.h"
#include "../quran_printer.h"
#include "../../build/version.h"

void read_wchar_test() {
    bool simple = true;
    int sura = 0, aya = 0;
    wchar_t *out;
    size_t len, len_real;

    //len = quran_read_wchar(sura, aya, NULL, LONG_MAX, simple); // real length (lighter)
    len = quran_read(sura, aya, NULL); // complex text length (faster)
    out = (wchar_t *) malloc(sizeof(wchar_t) * (len + 1));
    len_real = quran_read_wchar(sura, aya, out, len, simple);

    wprintf(L"%d %d >>>%S<<<\n", len, len_real, out);
    free(out);
}

void print_aya(int sura, int aya, bool simple) {
    wprintf(L"{%d} ", aya + 1);

    quran_chr_t *txt;
    size_t       len;
    wchar_t      c;

    len = quran_read(sura, aya, &txt);
    for (size_t i = 0; i < len; ++i) {
        c = (wchar_t) QURAN_TXT_DEC(txt[i]);
        if (simple) c = quran_simplify_char(c);
        if (!c) continue;
        wprintf(L"%C", c);
    }
    wprintf(L"\n");
}

void print_sura(int sura, bool simple, bool list) {
    if (!list) {
        fwprint_sura(stdout, sura, simple, true);
        return;
    }

    for (int a = 0; a < quran.sura_ayas[sura]; ++a) {
        print_aya(sura, a, simple);
    }
    wprintf(L"\n");
}

void print_page(int page, bool simple, bool list) {
    if (!list) {
        fwprint_page(stdout, page, simple, true);
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
                wprintf(L"%C", c);
            }
        }
    }
}

void main_onmatch(int i, quran_loc_t loc, int start, int end, void *_) {
    int sura = QURAN_SURA(loc);
    int aya  = QURAN_AYA(loc);
    int page = quran_page_of(loc);
    wprintf(L"%d. {س%d آ%d ص%d} ", i, sura + 1, aya + 1, page + 1);

    quran_chr_t *txt;
    size_t       len;
    wchar_t      c;
    bool         simple = true;

    len = quran_read(sura, aya, &txt);
    for (size_t i = 0; i < len; ++i) {
        c = (wchar_t) QURAN_TXT_DEC(txt[i]);
        if ((int) i == start) wprintf(L">>", c);
        if (simple) c = quran_simplify_char(c);
        if (!c) continue;
        wprintf(L"%C", c);
        if ((int) i == end) wprintf(L"<<", c);
    }
    wprintf(L"\n");
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
                    wprintf(L"%C", c);
                }
                ++count;
            }
            if (can_print) {
                wprintf(L" {%d} ", a);
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
                    wprintf(L"%C", c);
                }
                if (c == ' ') ++count;
            }
            ++count;
            if (can_print) {
                wprintf(L" {%d} ", a);
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
    wprintf(L"Usage: %s [-slpafxh] [SURA]\n", bin);
    wprintf(L"Version %s\n", QURAN_VERSION);
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
    setlocale(LC_ALL, "en_US.UTF-8");

    bool simple   = false;
    bool list     = false;
    bool page     = false;
    bool aya      = false;
    bool find     = false;
    bool index    = false;
    bool exp      = false;
    char *args[2] = {NULL};

    int opt;
    while ((opt = getopt(argc, argv, "slpafixh")) != -1) {
        switch (opt) {
        case 's': simple = true; break;
        case 'l': list   = true; break;
        case 'p': page   = true; break;
        case 'a': aya    = true; break;
        case 'f': find   = true; break;
        case 'i': index  = true; break;
        case 'x': exp    = true; break;
        case 'h': help(argv[0]); break;
        default:  help(argv[0]);
        }
    }
    for (int i = 0; optind < argc && i < 2; ++optind, ++i) {
        args[i] = argv[optind];
    }

    if (exp) { // experimental
        foo();
    } else if (index) { // list pages, suras, and juzus
        fwprint_index(stdout);
    } else if (find) { // search for target text
        char *target = args[0];
        size_t len = strlen(target);
        wchar_t *wtarget = (wchar_t *) malloc(sizeof(wchar_t) * (len + 1));
        mbstowcs(wtarget, target, len);
        quran_search(wtarget, true, NULL, main_onmatch);
        free(wtarget);
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

    return 0;
}
