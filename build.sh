#!/bin/sh

mkdir -p dist

{
    echo 'const QURAN = '
    cat quran.json
    echo ';'
    cat main.js
} > ./dist/quran.js

{
    cat launcher.sh
    cat ./dist/quran.js
} > ./dist/quran

chmod +x ./dist/quran
