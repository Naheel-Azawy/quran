./dist/quran.js: main.js launcher.sh quran.json build.sh
	./build.sh

install: ./dist/quran.js
	cat launcher.sh ./dist/quran.js > ./dist/quran
	chmod +x ./dist/quran
	mv ./dist/quran /bin/ || mv ./dist/quran /usr/local/bin/

uninstall:
	rm -f /bin/quran
	rm -f /usr/local/bin/quran

.PHONY: install uninstall
