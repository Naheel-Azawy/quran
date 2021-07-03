all: node_modules dist

dist:
	npm run build

node_modules:
	npm install

install:
	cp ./dist/cli.bundle.js /usr/bin/quran
	chmod +x /usr/bin/quran

uninstall:
	rm -f /bin/quran
	rm -f /usr/bin/quran

clean:
	rm -rf dist node_modules package-lock.json

.PHONY: install uninstall clean
