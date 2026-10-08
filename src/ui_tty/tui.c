// Full-screen terminal reader: page view, aya list, index, search.
//
// No curses: the whole terminal side is raw mode (termios), the alternate
// screen, SGR mouse reporting, and absolute cursor positioning, about 150
// lines. curses would not help with the hard part anyway, which is Arabic:
// it does neither bidi reordering nor shaping, and models stacked combining
// marks poorly. That is done here with libfribidi (see visual()), exactly
// as the fribidi command line tool does it, or left to the terminal when
// bidi is off.

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <termios.h>
#include <unistd.h>
#include <wchar.h>

#ifdef USE_FRIBIDI
#include <fribidi.h>
#endif

#include "../quran_core.h"
#include "../quran_printer.h"
#include "tui.h"

#define BLOCK_W    QURAN_LINE_MAX_WIDTH // columns of one printed page line
#define PAGE_ROWS  (1 + 16)             // header + body lines
#define BOTTOM_ROWS 2                   // message/prompt row + button row
#define QMAX       128                  // longest prompt text
#define BIDI_MAX   1024                 // longest line sent to the bidi step
#define MAX_INDEX  (QURAN_SURAS + QURAN_JUZUS)
#define MAX_LINES  1024                 // wrapped lines of one page in list mode

// ---------------------------------------------------------------------------
// Keys and events
// ---------------------------------------------------------------------------

enum {
    K_ENTER = 0x200000, K_BS, K_TAB, K_ESC,
    K_UP, K_DOWN, K_LEFT, K_RIGHT, K_PGUP, K_PGDN, K_HOME, K_END,
    K_CTRL_C = 3, K_CTRL_U = 21,
};

typedef enum { EV_NONE, EV_KEY, EV_MOUSE, EV_RESIZE, EV_QUIT } ev_type_t;

typedef struct {
    ev_type_t type;
    int       key;       // EV_KEY: code point or a K_* value
    int       x, y;      // EV_MOUSE: 1-based cell
    int       button;    // EV_MOUSE: 0 left, 1 middle, 2 right
    int       wheel;     // EV_MOUSE: -1 up, +1 down, 0 none
} ev_t;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

typedef enum { V_PAGE, V_INDEX, V_RESULTS, V_HELP } view_t;
typedef enum { P_NONE, P_GOTO, P_SEARCH, P_FILTER } prompt_t;

typedef struct { int row, x0, x1, key; } hit_t;

static struct {
    int  W, H;
    int  page;
    bool simple, list, bidi;
    view_t view;

    int  scroll, scroll_max;     // aya-list mode

    quran_index_entry_t idx[MAX_INDEX];
    int  nidx;
    int  vis[MAX_INDEX];         // idx entries passing the filter
    int  nvis;
    wchar_t filter[QMAX];

    quran_loc_t *res;            // search results
    int  nres;

    int  sel, top;               // selection in the current list view

    prompt_t prompt;
    wchar_t  pbuf[QMAX];
    int      plen;

    char msg[160];
    hit_t hits[32];
    int   nhits;
    bool  quit;
} S;

#ifdef USE_FRIBIDI
#define HAVE_BIDI 1
#else
#define HAVE_BIDI 0
#endif

// ---------------------------------------------------------------------------
// Output buffer
// ---------------------------------------------------------------------------

typedef struct { char *p; size_t n, cap; } buf_t;

static void b_reserve(buf_t *b, size_t extra) {
    if (b->n + extra + 1 <= b->cap) return;
    b->cap = (b->n + extra + 1) * 2;
    b->p = realloc(b->p, b->cap);
    if (!b->p) abort();
}

static void b_puts(buf_t *b, const char *s) {
    size_t l = strlen(s);
    b_reserve(b, l);
    memcpy(b->p + b->n, s, l);
    b->n += l;
    b->p[b->n] = '\0';
}

static void b_printf(buf_t *b, const char *fmt, ...) {
    char tmp[256];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(tmp, sizeof tmp, fmt, ap);
    va_end(ap);
    b_puts(b, tmp);
}

static void b_putw(buf_t *b, wchar_t c) {
    char u[4];
    int n;
    unsigned v = (unsigned) c;
    if (v < 0x80)         { u[0] = (char) v; n = 1; }
    else if (v < 0x800)   { u[0] = (char) (0xC0 | v >> 6);
                            u[1] = (char) (0x80 | (v & 0x3F)); n = 2; }
    else if (v < 0x10000) { u[0] = (char) (0xE0 | v >> 12);
                            u[1] = (char) (0x80 | ((v >> 6) & 0x3F));
                            u[2] = (char) (0x80 | (v & 0x3F)); n = 3; }
    else                  { u[0] = (char) (0xF0 | v >> 18);
                            u[1] = (char) (0x80 | ((v >> 12) & 0x3F));
                            u[2] = (char) (0x80 | ((v >> 6) & 0x3F));
                            u[3] = (char) (0x80 | (v & 0x3F)); n = 4; }
    b_reserve(b, 4);
    memcpy(b->p + b->n, u, n);
    b->n += n;
    b->p[b->n] = '\0';
}

static void b_spaces(buf_t *b, int n) {
    if (n <= 0) return;
    b_reserve(b, n);
    memset(b->p + b->n, ' ', n);
    b->n += n;
    b->p[b->n] = '\0';
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

static struct termios g_orig;
static bool g_raw;
static volatile sig_atomic_t g_resize, g_quit;

static void out_write(const char *p, size_t n) {
    while (n > 0) {
        ssize_t w = write(STDOUT_FILENO, p, n);
        if (w < 0) {
            if (errno == EINTR) continue;
            return;
        }
        p += w;
        n -= (size_t) w;
    }
}

static void term_restore(void) {
    static const char off[] =
        "\x1b[0m\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l";
    if (!g_raw) return;
    out_write(off, sizeof off - 1);
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &g_orig);
    g_raw = false;
}

static void term_raw(void) {
    static const char on[] =
        "\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h";
    struct termios t;
    tcgetattr(STDIN_FILENO, &g_orig);
    t = g_orig;
    t.c_iflag &= ~(tcflag_t) (BRKINT | ICRNL | INPCK | ISTRIP | IXON);
    t.c_oflag &= ~(tcflag_t) OPOST;
    t.c_cflag |= CS8;
    t.c_lflag &= ~(tcflag_t) (ECHO | ICANON | IEXTEN | ISIG);
    t.c_cc[VMIN]  = 1;
    t.c_cc[VTIME] = 0;
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &t);
    g_raw = true;
    atexit(term_restore);
    out_write(on, sizeof on - 1);
}

static void on_signal(int sig) {
    if (sig == SIGWINCH) g_resize = 1;
    else                 g_quit = 1;
}

static void install_signals(void) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_signal;   // no SA_RESTART: a signal interrupts read
    sigemptyset(&sa.sa_mask);
    sigaction(SIGWINCH, &sa, NULL);
    sigaction(SIGTERM,  &sa, NULL);
    sigaction(SIGHUP,   &sa, NULL);
}

static void update_size(void) {
    struct winsize ws;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0 && ws.ws_col > 0 && ws.ws_row > 0) {
        S.W = ws.ws_col;
        S.H = ws.ws_row;
    } else {
        S.W = 80;
        S.H = 24;
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// -1 timeout, -2 interrupted by a signal, -3 input is gone
static int read_byte(int timeout_ms) {
    struct pollfd p = { STDIN_FILENO, POLLIN, 0 };
    unsigned char c;
    int r = poll(&p, 1, timeout_ms);
    if (r == 0) return -1;
    if (r < 0)  return errno == EINTR ? -2 : -3;
    r = (int) read(STDIN_FILENO, &c, 1);
    if (r < 0)  return errno == EINTR ? -2 : -3;
    if (r == 0) return -3;
    return c;
}

static ev_t key_ev(int key) {
    ev_t e = { EV_KEY, key, 0, 0, 0, 0 };
    return e;
}

static ev_t none_ev(void) {
    ev_t e = { EV_NONE, 0, 0, 0, 0, 0 };
    return e;
}

// Called after an ESC byte: a lone ESC, an Alt chord, or a CSI/SS3 sequence.
static ev_t parse_escape(void) {
    int c = read_byte(40);
    char seq[32];
    int n = 0, fin;

    if (c < 0) return key_ev(K_ESC);
    if (c == 'O') {
        c = read_byte(40);
        switch (c) {
        case 'A': return key_ev(K_UP);
        case 'B': return key_ev(K_DOWN);
        case 'C': return key_ev(K_RIGHT);
        case 'D': return key_ev(K_LEFT);
        case 'H': return key_ev(K_HOME);
        case 'F': return key_ev(K_END);
        }
        return none_ev();
    }
    if (c != '[') return none_ev();

    for (;;) {
        c = read_byte(40);
        if (c < 0) return none_ev();
        if (c >= 0x40 && c <= 0x7E) break;
        if (n < (int) sizeof seq - 1) seq[n++] = (char) c;
    }
    seq[n] = '\0';
    fin = c;

    if (seq[0] == '<') { // SGR mouse: ESC [ < button ; x ; y (M press | m release)
        int b, x, y;
        ev_t e = none_ev();
        if (fin != 'M' || sscanf(seq + 1, "%d;%d;%d", &b, &x, &y) != 3) return e;
        if (b & 32) return e; // motion
        e.type = EV_MOUSE;
        e.x = x;
        e.y = y;
        if (b & 64) e.wheel = (b & 1) ? 1 : -1;
        else        e.button = b & 3;
        return e;
    }

    switch (fin) {
    case 'A': return key_ev(K_UP);
    case 'B': return key_ev(K_DOWN);
    case 'C': return key_ev(K_RIGHT);
    case 'D': return key_ev(K_LEFT);
    case 'H': return key_ev(K_HOME);
    case 'F': return key_ev(K_END);
    case '~':
        switch (atoi(seq)) {
        case 1: case 7: return key_ev(K_HOME);
        case 4: case 8: return key_ev(K_END);
        case 5:         return key_ev(K_PGUP);
        case 6:         return key_ev(K_PGDN);
        }
    }
    return none_ev();
}

static ev_t next_event(void) {
    for (;;) {
        int c;
        ev_t e = none_ev();

        if (g_quit)   { e.type = EV_QUIT;   return e; }
        if (g_resize) { g_resize = 0; e.type = EV_RESIZE; return e; }

        c = read_byte(-1);
        if (c == -2) continue;               // a signal: look at the flags
        if (c < 0)   { e.type = EV_QUIT; return e; }

        if (c == 27)                return parse_escape();
        if (c == '\r' || c == '\n') return key_ev(K_ENTER);
        if (c == 127 || c == 8)     return key_ev(K_BS);
        if (c == '\t')              return key_ev(K_TAB);
        if (c < 0x80)               return key_ev(c);

        { // UTF-8 lead byte: collect the continuation bytes
            int extra = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : c >= 0xC0 ? 1 : -1;
            unsigned cp;
            if (extra < 0) continue;
            cp = (unsigned) c & (0x3F >> extra);
            for (int i = 0; i < extra; ++i) {
                int d = read_byte(50);
                if (d < 0 || (d & 0xC0) != 0x80) { cp = 0; break; }
                cp = cp << 6 | ((unsigned) d & 0x3F);
            }
            if (cp) return key_ev((int) cp);
        }
    }
}

// ---------------------------------------------------------------------------
// Text: cell widths and bidi
// ---------------------------------------------------------------------------

// Columns a character takes. Harakat and the Quranic marks (stop signs
// included) stack on the previous letter and take none; small waw and yeh
// (U+06E5, U+06E6) are spacing letters although quran_is_tashkeel lists them.
static int cell_w(wchar_t c) {
    if (c == 0xFEFF || (c >= 0x200B && c <= 0x200F) || (c >= 0x2060 && c <= 0x2064))
        return 0;
    if (c >= 0x0300 && c <= 0x036F) return 0;
    if (quran_is_tashkeel(c) && c != 0x06E5 && c != 0x06E6) return 0;
    return 1;
}

static int str_w(const wchar_t *s, size_t n) {
    int w = 0;
    for (size_t i = 0; i < n; ++i) w += cell_w(s[i]);
    return w;
}

// Logical text to what is printed left to right. With libfribidi this is the
// same pipeline as the fribidi tool: bidi levels, Arabic joining and shaping,
// reordering with marks kept after their letter, and bracket mirroring. With
// bidi off the text is passed through for a terminal that does it itself.
// out holds BIDI_MAX characters. *rtl tells the paragraph direction used.
static size_t visual(const wchar_t *in, size_t len, wchar_t *out,
                     bool force_rtl, bool *rtl) {
    if (len > BIDI_MAX - 1) len = BIDI_MAX - 1;
    *rtl = force_rtl;
#ifdef USE_FRIBIDI
    if (S.bidi) {
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
#endif
    wmemcpy(out, in, len);
    return len;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

static void row_start(buf_t *b, int row) {
    b_printf(b, "\x1b[%d;1H\x1b[2K", row);
}

static void at(buf_t *b, int row, int col) {
    b_printf(b, "\x1b[%d;%dH", row, col);
}

static void block_geom(int *x0, int *w) {
    *w  = S.W < BLOCK_W ? S.W : BLOCK_W;
    *x0 = (S.W - *w) / 2;
}

// One logical RTL line, flush right inside the block. With bidi off nothing
// is padded: a bidi-aware terminal aligns right-to-left lines itself.
static void put_rtl(buf_t *b, int row, int x0, int w,
                    const wchar_t *s, size_t n, const char *sgr) {
    wchar_t vis[BIDI_MAX];
    bool rtl;
    size_t vn = visual(s, n, vis, true, &rtl);
    int vw = str_w(vis, vn);

    at(b, row, x0 + 1);
    if (sgr) b_puts(b, sgr);
    if (S.bidi) b_spaces(b, w - vw);
    for (size_t i = 0; i < vn; ++i) b_putw(b, vis[i]);
    if (sgr) b_puts(b, "\x1b[0m");
}

// A list row: a short ASCII part on the left, an Arabic label flush right.
static void put_split(buf_t *b, int row, int x0, int w, const char *left,
                      const wchar_t *right, size_t rn, bool selected,
                      const char *sgr) {
    wchar_t vis[BIDI_MAX];
    bool rtl;
    size_t vn = visual(right, rn, vis, true, &rtl);
    int vw = str_w(vis, vn);
    int lw = (int) strlen(left);

    at(b, row, x0 + 1);
    if (selected)  b_puts(b, "\x1b[7m");
    else if (sgr)  b_puts(b, sgr);
    b_puts(b, left);
    if (S.bidi) b_spaces(b, w - lw - vw);
    else        b_spaces(b, 1);
    for (size_t i = 0; i < vn; ++i) b_putw(b, vis[i]);
    b_puts(b, "\x1b[0m");
}

static void put_centered_ascii(buf_t *b, int row, const char *s) {
    int w = (int) strlen(s);
    at(b, row, (S.W - w) / 2 + 1);
    b_puts(b, s);
}

// ---------------------------------------------------------------------------
// Config: the last viewed page
// ---------------------------------------------------------------------------

static bool config_path(char *out, size_t cap, bool dir_only) {
    const char *xdg  = getenv("XDG_CONFIG_HOME");
    const char *home = getenv("HOME");
    if (xdg && *xdg)        snprintf(out, cap, "%s/quran", xdg);
    else if (home && *home) snprintf(out, cap, "%s/.config/quran", home);
    else                    return false;
    if (!dir_only) {
        size_t n = strlen(out);
        if (n + 6 >= cap) return false;
        strcpy(out + n, "/last");
    }
    return true;
}

static void mkdir_p(const char *path) {
    char tmp[512];
    snprintf(tmp, sizeof tmp, "%s", path);
    for (char *p = tmp + 1; *p; ++p) {
        if (*p != '/') continue;
        *p = '\0';
        mkdir(tmp, 0755);
        *p = '/';
    }
    mkdir(tmp, 0755);
}

static int load_last(void) {
    char path[512];
    FILE *f;
    int p = 1;
    if (!config_path(path, sizeof path, false) || !(f = fopen(path, "r"))) return 0;
    if (fscanf(f, "%d", &p) != 1) p = 1;
    fclose(f);
    if (p < 1 || p > QURAN_PAGES) p = 1;
    return p - 1;
}

static void save_last(void) {
    char dir[512], path[512];
    FILE *f;
    if (!config_path(dir, sizeof dir, true) || !config_path(path, sizeof path, false)) return;
    mkdir_p(dir);
    if ((f = fopen(path, "w"))) {
        fprintf(f, "%d\n", S.page + 1); // counted from one
        fclose(f);
    }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

static void set_msg(const char *m) {
    snprintf(S.msg, sizeof S.msg, "%s", m);
}

static void goto_page(int p) {
    if (p < 0) p = 0;
    if (p >= QURAN_PAGES) p = QURAN_PAGES - 1;
    if (p != S.page) {
        S.page = p;
        S.scroll = 0;
        save_last();
    }
    S.view = V_PAGE;
}

static void entry_label(const quran_index_entry_t *e, wchar_t *out, size_t cap) {
    if (e->kind == QURAN_INDEX_SURA)
        swprintf(out, cap, L"%d. %ls", e->number + 1, quran.sura_names[e->number]);
    else
        swprintf(out, cap, L"الجزء %d", e->number + 1);
}

static void rebuild_filter(void) {
    S.nvis = 0;
    for (int i = 0; i < S.nidx; ++i) {
        wchar_t label[128];
        if (S.filter[0]) {
            entry_label(&S.idx[i], label, 128);
            if (!wcsstr(label, S.filter)) continue;
        }
        S.vis[S.nvis++] = i;
    }
}

static int list_len(void) {
    return S.view == V_INDEX ? S.nvis : S.nres;
}

static void list_fix(void) {
    int rows = S.H - 1 - BOTTOM_ROWS; // rows 2 .. H-2
    int n = list_len();
    if (rows < 1) rows = 1;
    if (S.sel >= n) S.sel = n - 1;
    if (S.sel < 0)  S.sel = 0;
    if (S.sel < S.top) S.top = S.sel;
    if (S.sel >= S.top + rows) S.top = S.sel - rows + 1;
    if (S.top > n - rows) S.top = n - rows;
    if (S.top < 0) S.top = 0;
}

static void open_index(void) {
    int cur = QURAN_SURA(quran.pages[S.page]);
    S.filter[0] = L'\0';
    rebuild_filter();
    S.sel = 0;
    for (int i = 0; i < S.nvis; ++i) {
        const quran_index_entry_t *e = &S.idx[S.vis[i]];
        if (e->kind == QURAN_INDEX_SURA && e->number == cur) { S.sel = i; break; }
    }
    S.top = S.sel - (S.H - 1 - BOTTOM_ROWS) / 2; // roughly centered
    S.view = V_INDEX;
    list_fix();
}

static void open_selected(void) {
    int n = list_len();
    if (S.sel < 0 || S.sel >= n) return;
    if (S.view == V_INDEX) {
        goto_page(S.idx[S.vis[S.sel]].page);
    } else {
        quran_loc_t loc = S.res[S.sel];
        goto_page(quran_page_of(loc));
        snprintf(S.msg, sizeof S.msg, "Sura %d, aya %d",
                 QURAN_SURA(loc) + 1, QURAN_AYA(loc) + 1);
    }
}

static void do_search(void) {
    wchar_t q[QMAX];
    size_t n = 0;
    int count;

    for (int i = 0; i < S.plen; ++i) { // same folding the text is searched in
        wchar_t c = quran_simplify_char(S.pbuf[i]);
        if (c) q[n++] = c;
    }
    while (n > 0 && q[n - 1] == L' ') --n;
    q[n] = L'\0';
    if (n == 0) { set_msg("Nothing to search for"); return; }

    count = quran_search_locs(NULL, q, true);
    free(S.res);
    S.res  = NULL;
    S.nres = 0;
    if (count <= 0) { set_msg("No results"); return; }

    S.res = malloc((size_t) count * sizeof *S.res);
    if (!S.res) return;
    quran_search_locs(S.res, q, true);
    for (int i = 0; i < count; ++i) { // an aya matching twice is one result
        if (S.nres > 0 && S.res[S.nres - 1] == S.res[i]) continue;
        S.res[S.nres++] = S.res[i];
    }
    S.view = V_RESULTS;
    S.sel = S.top = 0;
    snprintf(S.msg, sizeof S.msg, "%d results", S.nres);
}

// "123" is a page, "2:255" is an aya of a sura
static void do_goto(void) {
    char s[QMAX];
    size_t n = 0;
    char *colon;

    for (int i = 0; i < S.plen && n < sizeof s - 1; ++i) {
        wchar_t c = S.pbuf[i];
        if (c >= 0x0660 && c <= 0x0669) c = L'0' + (c - 0x0660); // Arabic-Indic digits
        if ((c >= L'0' && c <= L'9') || c == L':') s[n++] = (char) c;
        else if (c != L' ') { set_msg("Use a page number or sura:aya"); return; }
    }
    s[n] = '\0';
    if (!n) return;

    if ((colon = strchr(s, ':'))) {
        int sura = atoi(s), aya = atoi(colon + 1);
        if (sura < 1 || sura > QURAN_SURAS) { set_msg("No such sura"); return; }
        if (aya < 1 || aya > quran_sura_ayas(sura - 1)) { set_msg("No such aya"); return; }
        goto_page(quran_aya_page(sura - 1, aya - 1));
        snprintf(S.msg, sizeof S.msg, "Sura %d, aya %d", sura, aya);
    } else {
        int p = atoi(s);
        if (p < 1 || p > QURAN_PAGES) { set_msg("Pages are 1 to 604"); return; }
        goto_page(p - 1);
    }
}

// ---------------------------------------------------------------------------
// Page view
// ---------------------------------------------------------------------------

typedef struct { const wchar_t *p; int n; bool banner; } span_t;

static bool is_banner(const wchar_t *s, size_t n) {
    for (size_t i = 0; i + 2 < n; ++i)
        if (s[i] == L'-' && s[i + 1] == L'-' && s[i + 2] == L'{') return true;
    return false;
}

static void draw_page_layout(buf_t *b) {
    wchar_t text[QURAN_PAGE_MAX_WCHARS];
    const wchar_t *p = text;
    int row = 1, x0, w;

    block_geom(&x0, &w);
    if (S.W < BLOCK_W || S.H < PAGE_ROWS + BOTTOM_ROWS) {
        char m[96];
        for (int r = 1; r <= S.H - BOTTOM_ROWS; ++r) row_start(b, r);
        snprintf(m, sizeof m, "Terminal too small: need %dx%d, have %dx%d",
                 BLOCK_W, PAGE_ROWS + BOTTOM_ROWS, S.W, S.H);
        put_centered_ascii(b, (S.H - BOTTOM_ROWS + 1) / 2, m);
        return;
    }

    swprint_page(text, S.page, S.simple, true);
    while (*p && row <= S.H - BOTTOM_ROWS) {
        const wchar_t *e = wcschr(p, L'\n');
        size_t n = e ? (size_t) (e - p) : wcslen(p);
        row_start(b, row);
        put_rtl(b, row, x0, w, p, n,
                row == 1 ? "\x1b[33m" : is_banner(p, n) ? "\x1b[1;33m" : NULL);
        ++row;
        p += n;
        if (*p == L'\n') ++p;
    }
    for (; row <= S.H - BOTTOM_ROWS; ++row) row_start(b, row);
}

// Aya-list mode: the page's ayas as running text wrapped to the terminal,
// like the CLI's -l but wrapped. Header line as in the page layout.
static void draw_page_list(buf_t *b) {
    static wchar_t text[QURAN_PAGE_MAX_WCHARS * 2];
    static span_t lines[MAX_LINES];
    wchar_t page_buf[QURAN_PAGE_MAX_WCHARS];
    wchar_t aya_buf[2048];
    size_t tn = 0;
    int nl = 0, x0, w, rows, width;
    quran_loc_t loc = quran.pages[S.page];
    quran_loc_t loc_next = S.page < QURAN_PAGES - 1 ? quran.pages[S.page + 1]
                                                     : QURAN_LOC_END;

    width = S.W - 2;
    if (width > 80) width = 80;
    if (width < 20) width = 20;
    x0 = (S.W - width) / 2;
    w  = width;

    // paragraphs separated by '\n': optional sura banner, then "{n} text"
    while (loc < loc_next && tn + 2600 < sizeof text / sizeof *text) {
        int sura = QURAN_SURA(loc), aya = QURAN_AYA(loc);
        size_t len = quran_read_wchar(sura, aya, aya_buf, 2047, S.simple);
        int k;
        if (aya == 0) {
            k = swprintf(text + tn, 200, L"--{ سورة %ls %d }--\n",
                         quran.sura_names[sura], sura + 1);
            if (k > 0) tn += (size_t) k;
        }
        k = swprintf(text + tn, 16, L"{%d} ", aya + 1);
        if (k > 0) tn += (size_t) k;
        wmemcpy(text + tn, aya_buf, len);
        tn += len;
        text[tn++] = L'\n';
        loc = QURAN_LOC_NEXT(loc);
    }
    text[tn] = L'\0';

    // greedy wrap at spaces, by display width
    for (wchar_t *para = text; *para && nl < MAX_LINES - 1; ) {
        wchar_t *e = wcschr(para, L'\n');
        wchar_t *end = e ? e : para + wcslen(para);
        bool banner = is_banner(para, (size_t) (end - para));
        wchar_t *line = para, *wp = para;
        int lw = 0;

        if (banner) {
            lines[nl++] = (span_t) { para, (int) (end - para), true };
        } else {
            while (wp < end) {
                wchar_t *we = wp;
                int ww = 0;
                while (we < end && *we != L' ') ww += cell_w(*we++);
                if (lw > 0 && lw + 1 + ww > width && nl < MAX_LINES - 1) {
                    lines[nl++] = (span_t) { line, (int) (wp - line) - 1, false };
                    line = wp;
                    lw = 0;
                }
                lw += (lw ? 1 : 0) + ww;
                wp = we < end ? we + 1 : we;
            }
            if (end > line && nl < MAX_LINES) lines[nl++] = (span_t) { line, (int) (end - line), false };
        }
        para = e ? e + 1 : end;
    }

    rows = S.H - 1 - BOTTOM_ROWS;
    S.scroll_max = nl > rows ? nl - rows : 0;
    if (S.scroll > S.scroll_max) S.scroll = S.scroll_max;
    if (S.scroll < 0) S.scroll = 0;

    // header: first line of the printed page
    swprint_page(page_buf, S.page, S.simple, true);
    {
        const wchar_t *e = wcschr(page_buf, L'\n');
        int hx, hw;
        block_geom(&hx, &hw);
        row_start(b, 1);
        put_rtl(b, 1, hx, hw, page_buf, e ? (size_t) (e - page_buf) : wcslen(page_buf),
                "\x1b[33m");
    }
    for (int r = 0; r < rows; ++r) {
        int i = S.scroll + r;
        row_start(b, 2 + r);
        if (i < nl)
            put_rtl(b, 2 + r, x0, w, lines[i].p, (size_t) lines[i].n,
                    lines[i].banner ? "\x1b[1;33m" : NULL);
    }
}

// ---------------------------------------------------------------------------
// Index and results views
// ---------------------------------------------------------------------------

static void draw_index(buf_t *b) {
    int x0, w, rows = S.H - 1 - BOTTOM_ROWS;
    char title[96];

    block_geom(&x0, &w);
    list_fix();
    row_start(b, 1);
    if (S.filter[0]) snprintf(title, sizeof title, "Index: %d of %d match the filter",
                              S.nvis, S.nidx);
    else             snprintf(title, sizeof title, "Index: %d suras, 30 juzus", QURAN_SURAS);
    at(b, 1, x0 + 1);
    b_printf(b, "\x1b[33m%s\x1b[0m", title);

    for (int r = 0; r < rows; ++r) {
        int i = S.top + r;
        row_start(b, 2 + r);
        if (i >= S.nvis) continue;
        {
            const quran_index_entry_t *e = &S.idx[S.vis[i]];
            wchar_t label[128];
            char left[32];
            entry_label(e, label, 128);
            snprintf(left, sizeof left, "p.%d", e->page + 1);
            put_split(b, 2 + r, x0, w, left, label, wcslen(label), i == S.sel,
                      e->kind == QURAN_INDEX_JUZU ? "\x1b[33m" : NULL);
        }
    }
    if (S.nvis == 0) put_centered_ascii(b, 3, "No match");
}

static void draw_results(buf_t *b) {
    int x0, w, rows = S.H - 1 - BOTTOM_ROWS;
    char title[96];

    block_geom(&x0, &w);
    list_fix();
    row_start(b, 1);
    snprintf(title, sizeof title, "Search: %d results", S.nres);
    at(b, 1, x0 + 1);
    b_printf(b, "\x1b[33m%s\x1b[0m", title);

    for (int r = 0; r < rows; ++r) {
        int i = S.top + r;
        row_start(b, 2 + r);
        if (i >= S.nres) continue;
        {
            quran_loc_t loc = S.res[i];
            int sura = QURAN_SURA(loc), aya = QURAN_AYA(loc);
            wchar_t line[QMAX * 4], aya_buf[2048];
            char left[32];
            size_t len, n = 0;
            int lw, room, used = 0;

            snprintf(left, sizeof left, "%d:%d p.%d", sura + 1, aya + 1,
                     quran_page_of(loc) + 1);
            lw = (int) strlen(left);
            room = w - lw - 2;

            len = quran_read_wchar(sura, aya, aya_buf, 2047, S.simple);
            for (size_t k = 0; k < len; ++k) { // cut to fit, marks stay with their letter
                int cw = cell_w(aya_buf[k]);
                if (cw > 0 && used + cw > room - 1) {
                    line[n++] = L'…';
                    break;
                }
                used += cw;
                if (n < sizeof line / sizeof *line - 2) line[n++] = aya_buf[k];
            }
            line[n] = L'\0';
            put_split(b, 2 + r, x0, w, left, line, n, i == S.sel, NULL);
        }
    }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

static const char *const HELP[] = {
    "Keys",
    "",
    "  Left / Right        next / previous page (the book turns right to left)",
    "  Down / Up, PgDn / PgUp   next / previous page (Up / Down scroll in list mode)",
    "  Home / End          first / last page",
    "  g, or digits        go to a page (123) or an aya (2:255)",
    "  i, Tab              index of suras and juzus",
    "  /                   search the text",
    "  s                   simple text, without tashkeel",
    "  l                   aya list instead of the page layout",
    "  b                   bidi through fribidi on / off",
    "  r                   random page",
    "  q, Ctrl-C           quit",
    "",
    "Lists (index, search results)",
    "  Up / Down, PgUp / PgDn, Home / End   move",
    "  Enter               open        Esc, q   back",
    "  /                   filter the index, or search again",
    "",
    "Mouse: click the left / right half of the page to turn it, use the wheel,",
    "click a button below or a row in a list.",
    "",
    "Press any key to close.",
};

static void draw_help(buf_t *b) {
    int n = (int) (sizeof HELP / sizeof *HELP);
    int top = (S.H - BOTTOM_ROWS - n) / 2;
    if (top < 0) top = 0;
    for (int r = 1; r <= S.H - BOTTOM_ROWS; ++r) {
        int i = r - 1 - top;
        row_start(b, r);
        if (i >= 0 && i < n) {
            at(b, r, 3);
            if (i == 0 || strncmp(HELP[i], "Lists", 5) == 0)  // the two headings
                b_printf(b, "\x1b[33m%.*s\x1b[0m", S.W - 3, HELP[i]);
            else
                b_printf(b, "%.*s", S.W - 3, HELP[i]);
        }
    }
}

// ---------------------------------------------------------------------------
// Bottom: message or prompt row, and the button row
// ---------------------------------------------------------------------------

typedef struct { const char *label; int key; bool active; } btn_t;

static void draw_buttons(buf_t *b, const btn_t *btns, int n) {
    int row = S.H, col = 1;
    row_start(b, row);
    at(b, row, 1);
    for (int i = 0; i < n; ++i) {
        int cells = 0;
        for (const char *s = btns[i].label; *s; ++s) // count characters, not bytes
            if (((unsigned char) *s & 0xC0) != 0x80) ++cells;
        if (col + cells > S.W) break;
        if (S.nhits < (int) (sizeof S.hits / sizeof *S.hits))
            S.hits[S.nhits++] = (hit_t) { row, col, col + cells, btns[i].key };
        if (btns[i].active) b_puts(b, "\x1b[7m");
        b_puts(b, btns[i].label);
        b_puts(b, "\x1b[0m");
        col += cells;
        if (col < S.W) { b_puts(b, " "); ++col; }
    }
}

static void draw_msgrow(buf_t *b) {
    int row = S.H - 1;
    static const char *const labels[] = { "", "go to (page or sura:aya) > ",
                                          "search > ", "filter > " };
    row_start(b, row);
    if (S.prompt == P_NONE) {
        if (S.msg[0]) {
            at(b, row, 2);
            b_printf(b, "\x1b[33m%.*s\x1b[0m", S.W - 2, S.msg);
        }
        return;
    }
    {
        wchar_t vis[BIDI_MAX];
        bool rtl;
        size_t vn = visual(S.pbuf, (size_t) S.plen, vis, false, &rtl);
        const char *label = labels[S.prompt];
        int lw = (int) strlen(label), vw = str_w(vis, vn);

        at(b, row, 1);
        b_printf(b, "\x1b[1m%s\x1b[0m", label);
        if (rtl && S.bidi) {          // typed text grows to the left, flush right
            b_spaces(b, S.W - lw - vw - 2);
            b_puts(b, "_");
            for (size_t i = 0; i < vn; ++i) b_putw(b, vis[i]);
        } else {
            for (size_t i = 0; i < vn; ++i) b_putw(b, vis[i]);
            b_puts(b, "_");
        }
    }
}

static void draw_bottom(buf_t *b) {
    draw_msgrow(b);
    if (S.view == V_PAGE) {
        btn_t btns[] = {
            { "\xE2\x86\x90next", K_LEFT, false }, { "\xE2\x86\x92prev", K_RIGHT, false },
            { "g:go", 'g', false }, { "i:index", 'i', false }, { "/:search", '/', false },
            { "s:simple", 's', S.simple }, { "l:list", 'l', S.list },
            { "b:bidi", 'b', S.bidi }, { "?:help", '?', false }, { "q:quit", 'q', false },
        };
        draw_buttons(b, btns, (int) (sizeof btns / sizeof *btns));
    } else if (S.view == V_HELP) {
        btn_t btns[] = { { "any key: close", K_ESC, false } };
        draw_buttons(b, btns, 1);
    } else {
        btn_t btns[] = {
            { "Enter:open", K_ENTER, false },
            { S.view == V_INDEX ? "/:filter" : "/:search", '/', false },
            { "Esc:back", K_ESC, false }, { "?:help", '?', false },
        };
        draw_buttons(b, btns, 4);
    }
}

static void draw(void) {
    buf_t b = { NULL, 0, 0 };
    S.nhits = 0;
    b_puts(&b, "\x1b[?25l");
    switch (S.view) {
    case V_PAGE:    if (S.list) draw_page_list(&b); else draw_page_layout(&b); break;
    case V_INDEX:   draw_index(&b);   break;
    case V_RESULTS: draw_results(&b); break;
    case V_HELP:    draw_help(&b);    break;
    }
    draw_bottom(&b);
    out_write(b.p, b.n);
    free(b.p);
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

static void prompt_open(prompt_t kind) {
    S.prompt = kind;
    S.plen = 0;
    S.pbuf[0] = L'\0';
    S.msg[0] = '\0';
}

static void prompt_key(int k) {
    if (k == K_ESC || k == K_CTRL_C) {
        S.prompt = P_NONE;
    } else if (k == K_ENTER) {
        prompt_t kind = S.prompt;
        S.pbuf[S.plen] = L'\0';
        S.prompt = P_NONE;
        if (kind == P_GOTO)   do_goto();
        if (kind == P_SEARCH) do_search();
        if (kind == P_FILTER) {
            wcscpy(S.filter, S.pbuf);
            rebuild_filter();
            S.sel = S.top = 0;
        }
    } else if (k == K_BS) {
        if (S.plen > 0) S.pbuf[--S.plen] = L'\0';
    } else if (k == K_CTRL_U) {
        S.plen = 0;
        S.pbuf[0] = L'\0';
    } else if (k >= 32 && k < K_ENTER && S.plen < QMAX - 1) {
        S.pbuf[S.plen++] = (wchar_t) k;
        S.pbuf[S.plen] = L'\0';
    }
}

static void toggle_bidi(void) {
    if (!HAVE_BIDI) { set_msg("Built without fribidi"); return; }
    S.bidi = !S.bidi;
    set_msg(S.bidi ? "bidi: on (fribidi)" : "bidi: off, left to the terminal");
}

static void key_page(int k) {
    switch (k) {
    case K_LEFT:  case ' ': case 'n': case 'j': goto_page(S.page + 1); break;
    case K_RIGHT: case K_BS: case 'p': case 'k': goto_page(S.page - 1); break;
    case K_DOWN: case K_PGDN:
        if (k == K_DOWN && S.list) S.scroll++; else goto_page(S.page + 1);
        break;
    case K_UP: case K_PGUP:
        if (k == K_UP && S.list) S.scroll--; else goto_page(S.page - 1);
        break;
    case K_HOME: goto_page(0); break;
    case K_END:  goto_page(QURAN_PAGES - 1); break;
    case 'g': case ':': prompt_open(P_GOTO); break;
    case 'i': case K_TAB: open_index(); break;
    case '/': prompt_open(P_SEARCH); break;
    case 's': S.simple = !S.simple; break;
    case 'l': S.list = !S.list; S.scroll = 0; break;
    case 'b': toggle_bidi(); break;
    case 'r': goto_page(rand() % QURAN_PAGES); break;
    case '?': case 'h': S.view = V_HELP; break;
    case 'q': case K_CTRL_C: S.quit = true; break;
    default:
        if (k >= '0' && k <= '9') { // typing a number goes straight to the prompt
            prompt_open(P_GOTO);
            prompt_key(k);
        }
    }
}

static void key_list(int k) {
    int rows = S.H - 1 - BOTTOM_ROWS;
    switch (k) {
    case K_UP:   case 'k': S.sel--; break;
    case K_DOWN: case 'j': S.sel++; break;
    case K_PGUP: S.sel -= rows; break;
    case K_PGDN: S.sel += rows; break;
    case K_HOME: S.sel = 0; break;
    case K_END:  S.sel = list_len() - 1; break;
    case K_ENTER: open_selected(); break;
    case '/':
        prompt_open(S.view == V_INDEX ? P_FILTER : P_SEARCH);
        break;
    case K_ESC: case 'q': case 'i': case K_TAB:
        if (S.view == V_INDEX && S.filter[0] && k == K_ESC) { // first Esc clears the filter
            S.filter[0] = L'\0';
            rebuild_filter();
            S.sel = S.top = 0;
        } else {
            S.view = V_PAGE;
        }
        break;
    case '?': S.view = V_HELP; break;
    case K_CTRL_C: S.quit = true; break;
    }
    if (S.view == V_INDEX || S.view == V_RESULTS) list_fix();
}

static void handle_key(int k) {
    if (S.prompt != P_NONE) { prompt_key(k); return; }
    S.msg[0] = '\0';
    if (S.view == V_HELP) { S.view = V_PAGE; return; }
    if (S.view == V_PAGE) key_page(k);
    else                  key_list(k);
}

static void handle_mouse(const ev_t *e) {
    if (S.prompt != P_NONE || (e->wheel == 0 && e->button != 0)) return;

    if (e->wheel == 0 && e->y == S.H) { // button row
        for (int i = 0; i < S.nhits; ++i)
            if (e->x >= S.hits[i].x0 && e->x < S.hits[i].x1) {
                int key = S.hits[i].key;
                if (S.view == V_HELP) S.view = V_PAGE;
                else                  handle_key(key);
                return;
            }
        return;
    }

    S.msg[0] = '\0';
    switch (S.view) {
    case V_HELP:
        if (e->wheel == 0) S.view = V_PAGE;
        break;
    case V_PAGE:
        if (e->wheel < 0)      goto_page(S.page - 1);
        else if (e->wheel > 0) goto_page(S.page + 1);
        else if (e->y >= 1 && e->y <= S.H - BOTTOM_ROWS) {
            // the book turns right to left: left half is forward
            goto_page(e->x <= S.W / 2 ? S.page + 1 : S.page - 1);
        }
        break;
    case V_INDEX: case V_RESULTS:
        if (e->wheel) {
            S.sel += 3 * e->wheel;
            list_fix();
        } else if (e->y >= 2 && e->y <= S.H - BOTTOM_ROWS) {
            int i = S.top + (e->y - 2);
            if (i < list_len()) { S.sel = i; open_selected(); }
        }
        break;
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

int tui_run(const tui_opts_t *o) {
    if (!isatty(STDIN_FILENO) || !isatty(STDOUT_FILENO)) {
        fprintf(stderr, "quran: the interactive reader needs a terminal\n");
        return 1;
    }

    memset(&S, 0, sizeof S);
    S.simple = o->simple;
    S.list   = o->list;
    S.bidi   = o->bidi && HAVE_BIDI;
    S.nidx   = (int) quran_index(S.idx, MAX_INDEX);
    S.page   = o->page >= 0 && o->page < QURAN_PAGES ? o->page : load_last();
    S.view   = V_PAGE;
    if (o->bidi && !HAVE_BIDI) set_msg("Built without fribidi: text is left to the terminal");

    srand((unsigned) getpid());
    update_size();
    install_signals();
    term_raw();

    while (!S.quit) {
        ev_t e;
        draw();
        e = next_event();
        switch (e.type) {
        case EV_KEY:    handle_key(e.key); break;
        case EV_MOUSE:  handle_mouse(&e);  break;
        case EV_RESIZE: update_size();     break;
        case EV_QUIT:   S.quit = true;     break;
        case EV_NONE:   break;
        }
    }

    term_restore();
    save_last();
    free(S.res);
    return 0;
}
