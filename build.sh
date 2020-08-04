#!/bin/sh

#USE_ESBUILD=1
USE_ESBUILD=

mkdir -p dist
{
    echo 'const QURAN = '
    cat quran.json
    echo ';'
    cat main.js
} > ./dist/quran.js

if [ "$1" != '-q' ]; then
    if [ "$USE_ESBUILD" ] && [ -f ./node_modules/esbuild/bin/esbuild ]; then
        ./node_modules/esbuild/bin/esbuild --bundle ./dist/quran.js --outfile=./dist/min.js --minify --platform=node
        mv ./dist/min.js ./dist/quran.js
    else
        command -v tsc >/dev/null &&
            command -v uglifyjs >/dev/null &&
            tsc ./dist/quran.js --allowJs --target es5 -outFile ./dist/es5.js &&
            uglifyjs ./dist/es5.js > ./dist/min.js &&
            mv ./dist/min.js ./dist/quran.js &&
            rm ./dist/es5.js
    fi
fi
