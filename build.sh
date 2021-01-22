#!/bin/sh

min() {
    [ -d ./node_modules/esbuild ] ||
        npm i esbuild
    ./node_modules/esbuild/bin/esbuild \
        --bundle ./dist/"$1".js \
        --outfile=./dist/"$1".min.js \
        --minify-whitespace \
        --minify-syntax \
        --platform=node
    mv ./dist/"$1".min.js ./dist/"$1".js
}

build_normal() {
    {
        echo 'const QURAN = '
        cat quran.json
        echo ';'
        cat main.js
    } > ./dist/quran.js
    min quran
}

build_compressed() {
    [ -d ./node_modules/lz-string ] ||
        npm i lz-string

    node -e '
const fs = require("fs");
const lz = require("lz-string");
let s = fs.readFileSync("./quran.json").toString();
let z = lz.compressToBase64(s);
fs.writeFileSync("./dist/quran.lz", z);'

    {
        cat ./node_modules/lz-string/libs/lz-string.min.js
        printf 'const QURAN = JSON.parse(LZString.decompressFromBase64("'
        cat ./dist/quran.lz
        echo '"));'
        cat main.js
    } > ./dist/quran-compressed.js

    min quran-compressed
    rm -f ./dist/quran.lz
}

main() {
    mkdir -p dist
    if [ "$1" = -c ]; then
        build_compressed
    else
        build_normal
    fi
}

main "$@"
