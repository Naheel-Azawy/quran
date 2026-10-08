#ifndef TUI_H_
#define TUI_H_

#include <stdbool.h>

typedef struct {
    bool simple; // start with simple text (no tashkeel)
    bool list;   // start in aya-list mode instead of the page layout
    bool bidi;   // reorder and shape through libfribidi (when built in)
    int  page;   // zero-based page to open, or -1 for the last viewed one
} tui_opts_t;

// Runs the full-screen reader until the user quits. Needs a terminal on
// stdin and stdout. Returns a process exit code.
int tui_run(const tui_opts_t *opts);

#endif // TUI_H_
