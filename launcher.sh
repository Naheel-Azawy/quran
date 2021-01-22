#!/bin/sh
':' //; N=$(command -v node || command -v nodejs)
':' //; Q="$0"; [ -f ./main.js ] && [ -f ./quran.json ] && Q=./main.js
':' //; W=$(tput cols); W=$((W-1))
':' //; bidi() { fribidi --nobreak -w "$W"; }
':' //; pager() { less -F; }
':' //; [ "$1" = -n ] && shift && bidi() { cat; } && pager() { cat; }
':' //; command -v fribidi >/dev/null || bidi() { cat; }
':' //; "$N" "$Q" -w "$W" "$@" | bidi | pager
':' //; exit

