#!/bin/sh

BIN=./build/main
SELF=$(realpath "$0")
W=75 H=17
CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/quran"

exists() {
    command -v "$1" >/dev/null
}

isint() {
    [ "$1" -eq "$1" ] 2>/dev/null
}

q_valid_page() {
    p=$1
    # NOTE: count from one
    if ! isint "$p"; then
        return
    elif [ "$p" -lt 1 ]; then
        echo 1
    elif [ "$p" -gt 604 ]; then
        echo 604
    else
        echo "$p"
    fi
}

q_pv() {
    p="$1"
    #p=$(echo "$p" | sed -rn 's/.+ ([0-9]+)/\1/p')
    p=$(q_valid_page "$p")
    $BIN -p "$p" | fribidi -w $W

    mkdir -p "$CFG_DIR"
    echo "$p" > "$CFG_DIR/last"
}

q_page() {
    p="$1"
    if [ -z "$p" ] && [ -f "$CFG_DIR/last" ]; then
        p=$(cat "$CFG_DIR/last")
    fi
    p=$(q_valid_page "$p")
    r=1

    while [ "$r" = 1 ]; do
        opts=
        opts="$opts --preview '$SELF pv {}'"
        tw=$(tput cols)
        th=$(tput lines)
        if [ $((tw / 3)) -gt $((th)) ]; then
            opts="$opts --preview-window=right,$W"
        else
            opts="$opts --preview-window=up,$H"
        fi
        opts="$opts --bind 'resize:accept'"
        opts="$opts --height=100% --info=hidden"
        opts="$opts --layout=reverse"
        opts="$opts --no-clear"
        opts="$opts --print-query"
        opts="$opts --sync --bind 'start:pos($p)'"
        opts="$opts --bind 'left:down' --bind 'right:up'"
        opts="$opts --bind 'ctrl-r:change-query(rand)+accept'"
        export FZF_DEFAULT_OPTS="$opts"

        out=$(seq 1 604 | fzf)
        #out=$($BIN -i | fribidi -w 25 | fzf)
        out1=$(echo "$out" | head -n1)
        out2=$(echo "$out" | tail -n1)
        if [ -n "$out1" ]; then out=$out1; else out=$out2; fi
        case "$out" in
            /*|\\*)
                q=$(echo "$out" | tail -c+2) &&
                    p=$(q_find "$q") ;;
            rand)
                p=$(shuf -i 1-604 -n1) ;;
            q|'')
                r=0 ;;
            *)
                num=$(echo "$out" | cut -d' ' -f1)
                #num=$(echo "$out" | sed -rn 's/.+ ([0-9]+)/\1/p')
                if q_valid_page "$num"; then
                    p="$num"
                else
                    r=0
                fi ;;
        esac
    done
    tput rmcup
}

q_find() {
    $BIN -f "$@" | cut -c-120 | fribidi -w $W |
        fzf --reverse | sed -rn 's/.+\{([0-9]+).+/\1/p'
}

main() {
    if ! exists fribidi || ! exists fzf; then
        exec $BIN "$@"
    fi

    case "$1" in
        pv) shift; q_pv   "$@" ;;
        '')        q_page "$@" ;;
        *)         $BIN   "$@" | fribidi -w $W
    esac
}

main "$@"
