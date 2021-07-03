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

main() {
    mkdir -p dist
    build_normal
}

main "$@"
