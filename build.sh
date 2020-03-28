#!/bin/sh
{
    cat launcher.sh
    echo 'const QURAN = '
    cat quran.json
    echo ';'
    cat main.js
} > quran
chmod +x quran
