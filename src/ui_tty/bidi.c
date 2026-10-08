#ifdef USE_FRIBIDI
#include <fribidi.h>
#endif

#include "../quran_core.h"
#include "bidi.h"

bool bidi_compiled(void) {
#ifdef USE_FRIBIDI
    return true;
#else
    return false;
#endif
}

int bidi_cell_w(wchar_t c) {
    if (c == 0xFEFF || (c >= 0x200B && c <= 0x200F) || (c >= 0x2060 && c <= 0x2064))
        return 0;
    if (c >= 0x0300 && c <= 0x036F) return 0;
    if (quran_is_tashkeel(c) && c != 0x06E5 && c != 0x06E6) return 0;
    return 1;
}

int bidi_str_w(const wchar_t *s, size_t n) {
    int w = 0;
    for (size_t i = 0; i < n; ++i) w += bidi_cell_w(s[i]);
    return w;
}

size_t bidi_visual(const wchar_t *in, size_t len, wchar_t *out,
                   bool bidi, bool force_rtl, bool *rtl) {
    if (len > BIDI_MAX - 1) len = BIDI_MAX - 1;
    *rtl = force_rtl;
#ifdef USE_FRIBIDI
    if (bidi) {
        static FriBidiChar l[BIDI_MAX], v[BIDI_MAX];
        FriBidiParType base = force_rtl ? FRIBIDI_PAR_RTL : FRIBIDI_PAR_ON;
        size_t n = 0;
        for (size_t i = 0; i < len; ++i) l[i] = (FriBidiChar) in[i];
        fribidi_log2vis(l, (FriBidiStrIndex) len, &base, v, NULL, NULL, NULL);
        for (size_t i = 0; i < len; ++i) {
            if (v[i] == 0xFEFF) continue; // filler left by a lam-alef ligature
            out[n++] = (wchar_t) v[i];
        }
        *rtl = FRIBIDI_IS_RTL(base);
        return n;
    }
#else
    (void) bidi;
#endif
    wmemcpy(out, in, len);
    return len;
}
