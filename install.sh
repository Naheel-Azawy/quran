#!/bin/sh
[ -d /usr/lib/node_modules/stdio ] || sudo npm install -g stdio@0.2.7
./build.sh
sudo cp quran /bin/
