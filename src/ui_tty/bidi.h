#ifndef BIDI_H_
#define BIDI_H_

#include <stdbool.h>
#include <stddef.h>
#include <wchar.h>

// Longest line bidi_visual() takes; longer input is cut.
#define BIDI_MAX 1024

// Whether libfribidi is built in (USE_FRIBIDI). Without it bidi_visual()
// always passes text through.
bool bidi_compiled(void);

// Columns a character takes on a terminal. Harakat and the Quranic marks
// (stop signs included) stack on the previous letter and take none; small
// waw and yeh (U+06E5, U+06E6) are spacing letters although
// quran_is_tashkeel lists them.
int bidi_cell_w(wchar_t c);
int bidi_str_w(const wchar_t *s, size_t n);

// Logical text to what is printed left to right. With bidi on (and
// libfribidi built in) this is the same pipeline as the fribidi tool: bidi
// levels, Arabic joining and shaping, reordering with marks kept after their
// letter, and bracket mirroring. Otherwise the text is passed through, for a
// terminal that does bidi itself. out holds BIDI_MAX characters. force_rtl
// fixes the paragraph direction, else it follows the first strong character;
// *rtl tells the direction used.
size_t bidi_visual(const wchar_t *in, size_t len, wchar_t *out,
                   bool bidi, bool force_rtl, bool *rtl);

#endif // BIDI_H_
