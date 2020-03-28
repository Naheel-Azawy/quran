quran: main.js launcher.sh quran.json
	./build.sh

install: quran
	cp ./dist/quran /bin/ || cp ./dist/quran /usr/local/bin/

uninstall:
	rm -f /bin/quran
	rm -f /usr/local/bin/quran

.PHONY: install uninstall
