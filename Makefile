PREFIX    = /usr/local
BINPREFIX = $(DESTDIR)$(PREFIX)/bin
VERSION   = 0.0.3
SERVER    = me@naheel.xyz

all: tty web
tty: build/main
web: build/web/index.html

FLAGS_COMMON = -O3
#FLAGS_COMMON = -g
#FLAGS_COMMON += -fbounds-check
FLAGS = -Wall $(FLAGS_COMMON)
EMCC_FLAGS = -Wall $(FLAGS_COMMON) -DUNDER_WASM -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS="['_swprint_page', '_quran_read', '_quran_read_wchar', '_quran_search_locs', '_malloc', '_free', '_quran_printer_init']" -s EXPORTED_RUNTIME_METHODS=[] --no-entry

# DATA ################################################

node_modules/xml2json:
	npm i xml2json
	npm install-scripts approve node-expat
	npm rebuild node-expat

build/quran.json: data/gen-json.js data/quran-uthmani.txt \
		data/quran-simple-clean.txt data/quran-data.xml node_modules/xml2json
	mkdir -p build
	node data/gen-json.js

build/lut.h build/data.h build/lut.c build/data.c: \
		data/gen-c.js build/quran.json data/line_breaks_per_page.txt
	node data/gen-c.js

build/lut.o: build/lut.c
	gcc $(FLAGS) -c $< -o build/lut.o

build/data.o: build/data.c
	gcc $(FLAGS) -c $< -o build/data.o

# TTY #################################################

build/version.h:
	mkdir -p build
	printf '#define QURAN_VERSION "%s"\n' $(VERSION) > build/version.h

build/main: src/quran_defs.h src/quran_core.h src/quran_core.c \
		src/quran_printer.h src/quran_printer.c build/version.h \
		build/lut.o build/data.o src/ui_tty/main.c
	gcc $(FLAGS) src/quran_core.c src/quran_printer.c \
		build/lut.o build/data.o src/ui_tty/main.c \
		-o build/main
	strip build/main

install: build/main
	mkdir -p $(BINPREFIX)
	cp -f build/main $(BINPREFIX)/quran_base
	sed 's#./build/main#quran_base#' src/ui_tty/main.sh > $(BINPREFIX)/quran
	chmod +x $(BINPREFIX)/quran

uninstall:
	rm -f $(BINPREFIX)/quran_base $(BINPREFIX)/quran

# WEB #################################################

# The wasm binary is built straight into build/web/ independently of the
# webpack build below; the two share that output directory but neither
# manages the other's files (webpack's `clean` is off for exactly this
# reason -- see src/ui_web/webpack.config.js).
build/web/quran.wasm: src/quran_defs.h src/quran_core.h src/quran_core.c \
	src/quran_printer.h src/quran_printer.c build/lut.c build/data.c
	mkdir -p build/web
	emcc $(EMCC_FLAGS) src/quran_core.c src/quran_printer.c \
		build/lut.c build/data.c \
		-o build/web/quran.wasm

src/ui_web/node_modules: src/ui_web/package.json
	cd src/ui_web && npm install
	touch src/ui_web/node_modules

# webpack builds the rest of the web UI (JS bundle, HTML, CSS, manifest,
# icons, fonts, service worker, and a fresh version marker for it) and
# writes it all directly into build/web/, alongside quran.wasm above.
build/web/index.html: build/web/quran.wasm src/ui_web/node_modules \
		src/ui_web/webpack.config.js \
		$(shell find src/ui_web/src src/ui_web/public -type f)
	cd src/ui_web && npm run build

web-serve: web
	cd build/web && python3 -m http.server 9000

web-push: web
	cd build/web && rsync --progress -r ./* $(SERVER):/srv/http/quran/

# OTHERS ##############################################

clean-not-node:
	rm -rf build

clean: clean-not-node
	rm -rf node_modules package.json package-lock.json
	rm -rf src/ui_web/node_modules src/ui_web/package-lock.json

.PHONY: clean clean-not-node install uninstall tty web web-serve web-push
