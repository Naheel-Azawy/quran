#!/bin/sh
cat launcher.sh main.js |
    sed -e '/undefined \/\*QURAN_JSON_HERE\*\// {' \
        -e 'r ./quran.json' -e 'd' -e '}' > quran
chmod +x quran
