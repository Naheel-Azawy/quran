./dist/quran.js: main.js quran.json build.sh
	./build.sh
	./build.sh -c

install: ./dist/quran.js
	cat launcher.sh ./dist/quran.js > ./dist/quran
	chmod +x ./dist/quran
	mv ./dist/quran /bin/ || mv ./dist/quran /usr/local/bin/

uninstall:
	rm -f /bin/quran
	rm -f /usr/local/bin/quran

clean:
	rm -rf dist

.PHONY: install uninstall clean
