#!/bin/sh
':' //; N=$(command -v node || command -v nodejs)
':' //; [ "$1" = -n ] && exec "$N" "$0" "$@"
':' //; W=$(tput cols)
':' //; "$N" "$0" -w "$W" "$@" | fribidi --nobreak -w "$W" | less -F
':' //; exit

