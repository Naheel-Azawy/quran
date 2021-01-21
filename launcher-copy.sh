#!/bin/sh
':' //; N=$(command -v node || command -v nodejs)
':' //; [ "$1" = -n ] && exec "$N" "$0" "$@"
':' //; W=$(tput cols); W=$((W-1))
':' //; "$N" main.js -w "$W" "$@" | fribidi --nobreak -w "$W" | less -F
':' //; exit

