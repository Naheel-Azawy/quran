PREFIX    = /usr/local
BINPREFIX = $(DESTDIR)$(PREFIX)/bin
VERSION   = 0.0.5
SERVER    = me@naheel.xyz

all: tty web
tty: build/main
web: build/web/.stamp

# VERSION above is the single source of truth: it feeds the C header, the
# web build (JS/CSS ?v= tags, service-worker cache id, package.json) and
# the Android versionName. build/.version only changes on disk when VERSION
# does, so everything depending on it rebuilds on a version bump and never
# otherwise (FORCE makes the check run every time; the cmp keeps the mtime).
build/.version: FORCE
	@mkdir -p build
	@printf '%s\n' '$(VERSION)' | cmp -s - $@ || printf '%s\n' '$(VERSION)' > $@

FORCE:

FLAGS_COMMON = -O3
#FLAGS_COMMON = -g
#FLAGS_COMMON += -fbounds-check
FLAGS = -Wall $(FLAGS_COMMON)
EMCC_FLAGS = -Wall $(FLAGS_COMMON) -DUNDER_WASM -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS="['_swprint_page', '_quran_read', '_quran_read_wchar', '_quran_search_locs', '_malloc', '_free', '_quran_printer_init']" -s EXPORTED_RUNTIME_METHODS=[] --no-entry

# ICONS ###############################################

# Every icon (web/PWA manifest, Android launcher) is rendered straight
# from this one vector source rather than shipping separate hand-exported
# bitmaps -- see the WEB and ANDROID sections below for where each size
# actually gets produced. Requires rsvg-convert (Debian/Ubuntu:
# `apt install librsvg2-bin`; macOS: `brew install librsvg`). Swap the
# recipes below for ImageMagick (`convert -background ...`) or another
# renderer if you'd rather not depend on it.
ICON_SVG        = src/ui_web/public/res/ic_base.svg
ICON_BG         = black
# Same color as above, in the #rrggbb form Android XML needs (keep in sync).
ICON_BG_HEX     = \#000000
RSVG_CONVERT   ?= rsvg-convert

# DATA ################################################

node_modules/xml2json:
	npm i xml2json
	npm install-scripts approve node-expat
	npm rebuild node-expat

build/quran.json: data/gen-json.js data/quran-uthmani.txt \
		data/quran-simple-clean.txt data/quran-data.xml node_modules/xml2json
	mkdir -p build
	node data/gen-json.js

# A stamp file, touched last, is used here (rather than checking
# build/lut.c/data.c/etc directly) so a single gen-c.js run is never
# second-guessed by comparing four separately-written outputs against
# each other -- and so this is safe under `make -j` too.
build/.gen-c.stamp: data/gen-c.js build/quran.json data/line_breaks_per_page.txt
	node data/gen-c.js
	touch $@

build/lut.h build/data.h build/lut.c build/data.c: build/.gen-c.stamp

build/lut.o: build/lut.c
	gcc $(FLAGS) -c $< -o build/lut.o

build/data.o: build/data.c
	gcc $(FLAGS) -c $< -o build/data.o

# TTY #################################################

build/version.h: build/.version
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

src/ui_web/node_modules: src/ui_web/package.json $(wildcard src/ui_web/package-lock.json)
	cd src/ui_web && if [ -f package-lock.json ]; then npm ci; else npm install; fi
	touch src/ui_web/node_modules

# webpack builds the rest of the web UI (JS bundle, HTML, CSS, manifest,
# remaining res/ files, fonts, service worker, and a fresh version marker
# for it) and writes it all directly into build/web/, alongside
# quran.wasm above.
#
# Freshness is tracked via this stamp file -- touched strictly *after*
# `npm run build` returns -- rather than by comparing one particular
# emitted file (index.html) against the source tree directly. If
# webpack's own build ever touches something under src/ui_web/src or
# src/ui_web/public as a side effect (a version marker, a copy step,
# whatever), that would otherwise make the source look newer than the
# target on the very next invocation and force an endless rebuild; the
# stamp can't lose that race since it's always written last.
build/web/.stamp: build/web/quran.wasm build/.version \
		src/ui_web/node_modules src/ui_web/webpack.config.js \
		$(shell find src/ui_web/src src/ui_web/public -type f)
	cd src/ui_web && QURAN_VERSION=$(VERSION) npm run build
	touch $@

web-serve: web
	cd build/web && python3 -m http.server 9000

web-push: web
	cd build/web && rsync --progress -r ./* $(SERVER):/srv/http/quran/

# ANDROID #############################################

# Thin native wrapper (WebView + a JavascriptInterface bridge, see
# src/ui_android/README.md) around the same build/web/ output the browser
# gets -- no Gradle, no Kotlin. Built entirely with the command-line SDK
# tools below; only `make android` is needed once ANDROID_SDK_ROOT (and a
# platform + build-tools version) is installed.
android: build/android/quran.apk

android-install: build/android/quran.apk
	adb install -r $<

ANDROID_SDK_ROOT     ?= $(ANDROID_HOME)
ANDROID_PLATFORM     ?= $(notdir $(lastword $(sort $(wildcard $(ANDROID_SDK_ROOT)/platforms/*))))
ANDROID_MIN_SDK      ?= 21
ANDROID_BUILD_TOOLS  ?= $(notdir $(lastword $(sort $(wildcard $(ANDROID_SDK_ROOT)/build-tools/*))))
ANDROID_APP_ID        = xyz.naheel.quran

ANDROID_JAR      = $(ANDROID_SDK_ROOT)/platforms/$(ANDROID_PLATFORM)/android.jar
ANDROID_TOOLS    = $(ANDROID_SDK_ROOT)/build-tools/$(ANDROID_BUILD_TOOLS)
AAPT2            = $(ANDROID_TOOLS)/aapt2
D8               = $(ANDROID_TOOLS)/d8
ZIPALIGN         = $(ANDROID_TOOLS)/zipalign
APKSIGNER        = $(ANDROID_TOOLS)/apksigner

# Signing: a throwaway debug key is generated (once) and reused unless
# the caller points these at a real one, e.g.:
#   make android KEYSTORE=release.jks KEYSTORE_PASS=... KEY_ALIAS=... KEY_PASS=...
KEYSTORE       ?= build/android/debug.keystore
KEYSTORE_PASS  ?= android
KEY_ALIAS      ?= androiddebugkey
KEY_PASS       ?= android

# Set to 0 for a release build. This is a *separate* thing from which
# keystore signs the APK above -- signing with the debug key does NOT by
# itself make the app debuggable (that's the android:debuggable manifest
# attribute), which is what actually gates
# WebView.setWebContentsDebuggingEnabled() in MainActivity and therefore
# whether chrome://inspect can see it at all. aapt2 link's --debug-mode
# flag sets that attribute at build time, so nothing needs hand-editing
# AndroidManifest.xml for this. On (1) by default, matching this
# toolchain's debug-keystore-by-default stance above.
ANDROID_DEBUG ?= 1

ANDROID_OUT  = build/android
ANDROID_SRC := $(shell find src/ui_android/src -name '*.java' 2>/dev/null)
ANDROID_RES := $(shell find src/ui_android/res -type f 2>/dev/null)


build/android/debug.keystore:
	mkdir -p $(ANDROID_OUT)
	keytool -genkeypair -v -keystore $@ -storepass android -alias androiddebugkey \
		-keypass android -keyalg RSA -keysize 2048 -validity 10000 \
		-dname "CN=Android Debug,O=Android,C=US"

# assets/ = build/web/*, copied verbatim (quran.wasm, bundle.js, res/,
# style.css, sw.js, ...) -- gated on the web build's own stamp (see
# above), not on any one file inside it.
$(ANDROID_OUT)/assets/index.html: build/web/.stamp
	rm -rf $(ANDROID_OUT)/assets
	mkdir -p $(ANDROID_OUT)/assets
	cp -r build/web/. $(ANDROID_OUT)/assets/
	rm $(ANDROID_OUT)/assets/res/icon* \
		$(ANDROID_OUT)/assets/res/screenshot* \
		$(ANDROID_OUT)/assets/*.map

# Set to 1 to bring back flat raster PNG launcher icons (one bitmap per
# density bucket, rendered via rsvg-convert -- exactly what this project
# used before switching to XML vector/adaptive icons) instead of the
# vector-based ones below, e.g. if some target device/launcher doesn't
# render <adaptive-icon> the way you'd like. Off by default; the PNG
# code path is kept rather than deleted specifically so this stays a
# one-variable toggle instead of a revert.
ANDROID_PNG_ICONS ?= 0

# name:pixel-size pairs for each Android density bucket -- only used when
# ANDROID_PNG_ICONS=1.
ANDROID_ICON_SIZES = mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192

# SVG -> VectorDrawable converter, installed once into build/ (pinned to the
# version this was tested with) and driven by tools/svg-to-vector.js through
# NODE_PATH. Only needed when ANDROID_PNG_ICONS=0.
S2V_DIR   = $(ANDROID_OUT)/s2v
S2V_STAMP = $(S2V_DIR)/.stamp

$(S2V_STAMP):
	mkdir -p $(S2V_DIR)
	cd $(S2V_DIR) && npm init -y >/dev/null && \
		npm install svg2vectordrawable@2.9.1 --no-audit --no-fund --loglevel=error
	touch $@

# res-merged/ = src/ui_android/res, plus the launcher icon. By default
# (ANDROID_PNG_ICONS=1) flat PNGs are rendered per density. With
# ANDROID_PNG_ICONS=0 the icon is generated from ICON_SVG as vector XML
# instead:
#   - drawable/ic_launcher_foreground.xml: the converted art (see
#     tools/svg-to-vector.js for why the converter is driven from a script
#     rather than the s2v command line), used by the checked-in
#     res/mipmap-anydpi-v26/ic_launcher.xml <adaptive-icon> on API 26+.
#     That file is kept as-is here; it was previously deleted at this
#     point, which silently threw away the adaptive icon.
#   - mipmap-anydpi-v21/ic_launcher.xml: one flat vector with the
#     background baked in, for API 21-25 (no <adaptive-icon> support; see
#     tools/gen-legacy-icon.js).
#   - values/ic_launcher_background.xml, only if res/ does not already
#     define it, since the adaptive icon references @color/ic_launcher_background.
$(ANDROID_OUT)/res-merged/.stamp: $(ANDROID_RES) $(ICON_SVG) \
		src/ui_android/tools/gen-legacy-icon.js src/ui_android/tools/svg-to-vector.js \
		$(if $(filter 1,$(ANDROID_PNG_ICONS)),,$(S2V_STAMP))
	rm -rf $(ANDROID_OUT)/res-merged
	mkdir -p $(ANDROID_OUT)/res-merged
	cp -r src/ui_android/res/. $(ANDROID_OUT)/res-merged/
ifeq ($(ANDROID_PNG_ICONS),1)
	rm -f $(ANDROID_OUT)/res-merged/mipmap-anydpi-v26/ic_launcher.xml
	for pair in $(ANDROID_ICON_SIZES); do \
		density=$${pair%%:*}; size=$${pair##*:}; \
		mkdir -p $(ANDROID_OUT)/res-merged/mipmap-$$density; \
		$(RSVG_CONVERT) -w $$size -h $$size --background-color=$(ICON_BG) \
			-o $(ANDROID_OUT)/res-merged/mipmap-$$density/ic_launcher.png $(ICON_SVG); \
	done
else
	mkdir -p $(ANDROID_OUT)/res-merged/drawable $(ANDROID_OUT)/res-merged/mipmap-anydpi-v21
	NODE_PATH=$(abspath $(S2V_DIR))/node_modules node src/ui_android/tools/svg-to-vector.js \
		$(ICON_SVG) $(ANDROID_OUT)/res-merged/drawable/ic_launcher_foreground.xml
	node src/ui_android/tools/gen-legacy-icon.js \
		$(ANDROID_OUT)/res-merged/drawable/ic_launcher_foreground.xml \
		$(ANDROID_OUT)/res-merged/mipmap-anydpi-v21/ic_launcher.xml '$(ICON_BG_HEX)'
	test -f $(ANDROID_OUT)/res-merged/mipmap-anydpi-v26/ic_launcher.xml || \
		{ echo "missing res/mipmap-anydpi-v26/ic_launcher.xml (the adaptive icon)"; exit 1; }
	grep -rqs 'name="ic_launcher_background"' $(ANDROID_OUT)/res-merged/values || { \
		mkdir -p $(ANDROID_OUT)/res-merged/values; \
		printf '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">%s</color>\n</resources>\n' \
			'$(ICON_BG_HEX)' > $(ANDROID_OUT)/res-merged/values/ic_launcher_background.xml; }
endif
	touch $@

$(ANDROID_OUT)/res.zip: $(ANDROID_OUT)/res-merged/.stamp
	$(AAPT2) compile --dir $(ANDROID_OUT)/res-merged -o $@

# Compiles + links the manifest and resources into a base APK (resources,
# compiled manifest, assets/ -- everything except code) and emits R.java.
$(ANDROID_OUT)/base.apk: src/ui_android/AndroidManifest.xml $(ANDROID_OUT)/res.zip \
		$(ANDROID_OUT)/assets/index.html
	mkdir -p $(ANDROID_OUT)/gen
	$(AAPT2) link -o $@ -I $(ANDROID_JAR) \
		--manifest src/ui_android/AndroidManifest.xml \
		-A $(ANDROID_OUT)/assets \
		--java $(ANDROID_OUT)/gen \
		--version-name $(VERSION) --version-code 1 \
		--auto-add-overlay \
		$(if $(filter 1,$(ANDROID_DEBUG)),--debug-mode,) \
		$(ANDROID_OUT)/res.zip

# NOTE: no -bootclasspath here -- pointing javac's bootclasspath at
# android.jar (a stub jar with no real java.lang.invoke.LambdaMetafactory
# implementation) breaks lambda/method-reference desugaring. Leaving
# javac on the JDK's own bootclasspath and using android.jar only via
# -classpath (for resolving Android API symbols) is what Android's own
# tooling does too; d8 (below) still does the real dex-level lowering.
$(ANDROID_OUT)/classes.jar: $(ANDROID_OUT)/base.apk $(ANDROID_SRC)
	rm -rf $(ANDROID_OUT)/classes
	mkdir -p $(ANDROID_OUT)/classes
	javac -encoding UTF-8 -source 8 -target 8 -nowarn \
		-classpath $(ANDROID_JAR) \
		-d $(ANDROID_OUT)/classes \
		$(shell find $(ANDROID_OUT)/gen -name '*.java') $(ANDROID_SRC)
	cd $(ANDROID_OUT)/classes && jar cf ../classes.jar .

$(ANDROID_OUT)/classes.dex: $(ANDROID_OUT)/classes.jar
	$(D8) --release --min-api $(ANDROID_MIN_SDK) --lib $(ANDROID_JAR) \
		--output $(ANDROID_OUT) $(ANDROID_OUT)/classes.jar

$(ANDROID_OUT)/unsigned.apk: $(ANDROID_OUT)/base.apk $(ANDROID_OUT)/classes.dex
	cp -f $(ANDROID_OUT)/base.apk $@
	cd $(ANDROID_OUT) && zip -q unsigned.apk classes.dex

$(ANDROID_OUT)/aligned.apk: $(ANDROID_OUT)/unsigned.apk
	$(ZIPALIGN) -f -p 4 $< $@

build/android/quran.apk: $(ANDROID_OUT)/aligned.apk $(KEYSTORE)
	$(APKSIGNER) sign --ks $(KEYSTORE) --ks-pass pass:$(KEYSTORE_PASS) \
		--key-pass pass:$(KEY_PASS) --ks-key-alias $(KEY_ALIAS) \
		--out $@ $<
	$(APKSIGNER) verify $@

# OTHERS ##############################################

clean-not-node:
	rm -rf build

clean: clean-not-node
	rm -rf node_modules package.json package-lock.json
	rm -rf src/ui_web/node_modules

.PHONY: FORCE clean clean-not-node install uninstall tty web web-serve web-push android android-install
