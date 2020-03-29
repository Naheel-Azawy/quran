#!/bin/sh

mkdir -p dist
{
    echo 'const QURAN = '
    cat quran.json
    echo ';'
    cat main.js
} > ./dist/quran.js

[ "$1" != '-q' ] &&
    command -v tsc >/dev/null &&
    command -v uglifyjs >/dev/null &&
    tsc ./dist/quran.js --allowJs --target es5 -outFile ./dist/es5.js &&
    uglifyjs ./dist/es5.js > ./dist/min.js &&
    mv ./dist/min.js ./dist/quran.js &&
    rm ./dist/es5.js

