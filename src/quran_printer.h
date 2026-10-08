#ifndef QURAN_PRINTER_H_
#define QURAN_PRINTER_H_

#include <stdio.h>

#include "quran_core.h"

QURAN_API void   quran_printer_init(void);

QURAN_API size_t swprint_page(wchar_t *buf, int page, bool simple, bool just);
size_t fwprint_page(FILE *f, int page, bool simple, bool just);

size_t swprint_sura(wchar_t *out, int sura, bool simple, bool just);
size_t fwprint_sura(FILE *f, int sura, bool simple, bool just);
size_t wprint_index(wchar_t *out, size_t size);
size_t fwprint_index(FILE *f);
size_t fwprint_all(const char *dir, bool simple, bool just);

#endif // QURAN_PRINTER_H_
