const fs = require("fs");
const { spawnSync } = require( 'child_process' );
const print  = s => console.log(s);
const printj = s => console.log(JSON.stringify(s, null, 2));

let q = JSON.parse(fs.readFileSync("./quran.json"));

let suras_names = {};
for (let i = 0; i < q.suras.length; ++i) {
    suras_names[q.suras[i].name] = i + 1;
    suras_names[q.suras[i].name_en] = i + 1;
    suras_names[q.suras[i].name_tr] = i + 1;
    suras_names[q.suras[i].name_en.replace(/[^0-9a-z]/gi, '')
                .toLocaleLowerCase()] = i + 1;
}

function fuzzy(str, s) {
    var hay = str.toLowerCase(), i = 0, n = -1, l;
    s = s.toLowerCase();
    for (; l = s[i++] ;) if (!~(n = hay.indexOf(l, n + 1))) return false;
    return true;
}

function get_sura(target) {
    let res = suras_names[target];
    if (!res) {
        for (let s of Object.keys(suras_names)) {
            if (fuzzy(s, target)) {
                res = suras_names[s];
                break;
            }
        }
    }
    return res;
}

function loc(s, a) {
    s = Number(s); a = Number(a);
    if (!Number.isInteger(s) || (a && !Number.isInteger(a)))
        return undefined;
    let res;
    if (a) {
        res = {
            id: s * 1000 + a,
            sura: s,
            aya: a
        };
    } else { // loc id given as s
        res = {
            id: s,
            sura: (s / 1000) | 0,
            aya: s % 1000
        };
    }

    if (res.sura < 1 || res.sura > q.suras.length)
        return undefined;
    if (res.aya < 1 || res.aya > q.suras[res.sura - 1].ayas.length)
        return undefined;

    return res;
}

function loc_aya(l) {
    return q.suras[l.sura - 1].ayas[l.aya - 1];
}

function search(target) {
    let list = [];
    if (target.startsWith("و ")) target = "و" + target.substring(2);
    target = target.replace(" و ", "و ")
        .replace("ة", "ه")
        .replace(/\s+/g, ' ').trim();
    if (target.length != 0) {
        let sp = target.split(' ');
        let l;
        if (sp.length == 2 && (l = loc(sp[0], sp[1]))) { // sura# aya#
            list.push(loc_aya(l));
        } else if (sp.length == 1 && (l = loc(sp[0], 1))) { // sura#
            list.push(loc_aya(l));
        } else {
            if (sp.length == 2 && Number.isInteger(Number(sp[1]))) { // jump
                let arg = Number(sp[1]);
                switch (sp[0]) {
                case "sura":
                case "سوره":
                    l = loc(get_sura(arg), 1);
                    if (l) list.push(loc_aya(l));
                    break;
                case "juzu":
                case "جزء":
                case "الجزء":
                    if (arg >= 1 && arg <= 30) {
                        l = loc(q.juzus[arg - 1]);
                        if (l) list.push(loc_aya(l));
                    }
                    break;
                case "hizb":
                case "hizib":
                case "حزب":
                case "الحجب":
                    if (arg >= 1 && arg <= q.hizibs.length) {
                        l = loc(q.hizibs[arg - 1]);
                        if (l) list.push(loc_aya(l));
                    }
                    break;
                case "page":
                case "صفحه":
                case "الصفحه":
                    if (arg >= 1 && arg <= q.pages.length) {
                        l = loc(q.pages[arg - 1]);
                        if (l) list.push(loc_aya(l));
                    }
                    break;
                }
            } else { // sura_name
                l = loc(get_sura(sp[0]), 1);
                if (l) list.push(loc_aya(l));
            }
            for (let sura of q.suras) { // full_search
                for (let aya of sura.ayas) {
                    if (aya.text_simple
                        .replace(/[أإآ]/g, 'ا')
                        .includes(target) &&
                        (!l || aya.loc != l.id)) {
                        list.push(aya);
                    }
                }
            }
        }
    }
    return list;
}

function test_search() {
    let arr = [
        "انه من سليمان",
        "16 1",
        "page 20",
        "juzu 30",
        "الكهف"
    ];

    for (let t of arr) {
        print(`SEARCHING FOR '${t}'`);
        print(search(t));
        print('');
    }
}

// UI --------------------------------------------------------

let default_tcols = process.stdout.columns ||
      Number(spawnSync("tput", [ "cols" ]).stdout.toString());

function wrap(s) {
    if (default_tcols == -1) return s;
    let w = process.stdout.columns || default_tcols;
    return s.replace(
        new RegExp(`(?![^\\n]{1,${w}}$)([^\\n]{1,${w}})\\s`, 'g'), '$1\n'
    );
}

function printw(s) {
    print(wrap(s));
}

function print_name(s) {
    printw(`--{ سورة ${q.suras[s - 1].name} }--`);
    print('');
}

function print_bismilah(s) {
    if (s != 1 && s != 9) {
        printw(q.suras[0].ayas[0].text_simple);
    }
}

function print_sura(s) {
    print_name(s);
    print_bismilah(s);
    let t = "";
    for (let a of q.suras[s - 1].ayas) {
        t += a.text_simple + ` {${loc(a.loc).aya}} `;
    }
    printw(t);
}

function print_sura_with_tafseer(s, t) {
    print_name(s);
    print_bismilah(s);
    print('');
    for (let a of q.suras[s - 1].ayas) {
        printw(a.text_simple + ` {${loc(a.loc).aya}}`);
        printw(q.tafseer[t][a.index]);
        print('');
    }
}

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;;
}

function main() {
    const opts = require("stdio").getopt({
        "_meta_":       { maxArgs: 1 },
        "tafseer":      { key: "t", args: 1, description: "Show tafseer"                 },
        "search":       { key: "s", args: 1, description: "Search Quran"                 },
        "list-suras":   { key: "l",          description: "List sura names"              },
        "list-tafseer": { key: "b",          description: "List available tafseer books" },
        "no-wrap":      { key: "w",          description: "Disable line wrapping"        }
    });

    if (opts["no-wrap"]) {
        default_tcols = -1;
    }

    if (opts["list-suras"]) {
        for (let s of q.suras) {
            print(`${s.name} - ${s.name_en}`);
        }
    } else if (opts["list-tafseer"]) {
        for (let s of Object.keys(q.tafseer)) {
            print(s);
        }
    } else if (opts.search) {
        let res = search(opts.search);
        print(`[${res.length}]`);
        print('');
        let l;
        for (let aya of res) {
            l = loc(aya.loc);
            printw(`${q.suras[l.sura - 1].name} {${l.aya}}:`);
            printw(aya.text_simple);
            print('');
        }
    } else if (opts.tafseer) {
        if (!q.tafseer[opts.tafseer]) {
            for (let t of Object.keys(q.tafseer)) {
                if (t.includes(opts.tafseer)) {
                    opts.tafseer = t;
                    break;
                }
            }
        }
        print_sura_with_tafseer(get_sura(opts.args[0]), opts.tafseer);
    } else if (opts.args && opts.args.length != 0) {
        print_sura(get_sura(opts.args[0]));
    } else {
        print_sura(rand(1, q.suras.length));
    }
}

main();
