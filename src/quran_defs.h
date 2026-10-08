#ifndef QURAN_DEFS_H_
#define QURAN_DEFS_H_

#include <stdint.h>
#include <stdlib.h>

#include "../build/data.h"

// NOTE: suras and ayas indexed from zero

#define QURAN_LOC(sura, aya) ((sura) << 9 | (aya))
#define QURAN_SURA(loc)      ((loc) >> 9)
#define QURAN_AYA(loc)       ((loc) & 0x01ff)

// Marks a function the web build must export to JavaScript. The wasm is
// loaded without any emscripten glue, so a function that is not exported
// does not exist for quran-engine.js. Native builds ignore it.
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define QURAN_API EMSCRIPTEN_KEEPALIVE
#else
#define QURAN_API
#endif

#define QURAN_SURAS 114
#define QURAN_PAGES 604
#define QURAN_JUZUS  30

#define QURAN_LINE_MAX_WIDTH  71
#define QURAN_LINE_MAX_WCHARS 128
#define QURAN_PAGE_MAX_WCHARS 2048 // 1593

#define QURAN_LOC_FIRST QURAN_LOC(0, 0)
#define QURAN_LOC_LAST  QURAN_LOC(113, 5)
#define QURAN_LOC_END   (QURAN_LOC_LAST + 1)

#define QURAN_LOC_NEXT(loc) ((QURAN_AYA(loc) + 1 >= quran.sura_ayas[QURAN_SURA(loc)]) ? \
                             QURAN_LOC(QURAN_SURA(loc) + 1, 0) :        \
                             loc + 1)

#define QURAN_TXT_DEC(num) (quran_txt_lut_rev[num])
#define QURAN_TXT_ENC(chr) (chr == ' ' ? 1 :                            \
                            (chr > QURAN_TXT_MAX || chr < QURAN_TXT_MIN) ? 0 : \
                            quran_txt_lut[chr - QURAN_TXT_MIN])

typedef uint32_t quran_chr_utf16_t;
typedef uint8_t  quran_chr_t;
typedef uint16_t quran_loc_t;

typedef struct {
    char        *tanzil_copyright;
    wchar_t     *sura_names[QURAN_SURAS];
    quran_loc_t  pages[QURAN_PAGES];
    quran_loc_t  juzus[QURAN_JUZUS];
    uint8_t      breaks[QURAN_PAGES][15];
    uint16_t     sura_ayas[QURAN_SURAS];
    size_t       endings_s[QURAN_SURAS];
    size_t       endings_a[QURAN_AYAS_LEN];
    quran_chr_t  text[QURAN_TEXT_LEN];
} quran_t;

extern quran_t quran;

#endif // QURAN_DEFS_H_
