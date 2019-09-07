#!/bin/sh
W=$(tput cols)
node main.js "$@" | fribidi --nobreak -w "$W" | less -F
