const q = typeof(QURAN) != 'undefined' ? QURAN :
      JSON.parse(require("fs").readFileSync("./quran.json"));

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
    if (target.startsWith("سورة")) {
        target = target.replace("سورة", "");
    }
    target = target.trim();
    let res = suras_names[target];
    if (!res) {
        for (let s of Object.keys(suras_names)) {
            if (fuzzy(s, target)) {
                res = suras_names[s];
                break;
            }
        }
    }
    if (!res) {
        throw new Error(`No sura names '${target}' found`);
    } else {
        return res;
    }
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
                try {
                    l = loc(get_sura(sp[0]), 1);
                    if (l) list.push(loc_aya(l));
                } catch (err) {}
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

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;;
}

function getopt(opts, args) {
    let res = {};

    if (!args) {
        return res;
    }

    let bin = "quran";
    if (typeof(process) != 'undefined' && args[0].includes("node")) {
        bin = args[1];
        bin = bin.substring(bin.lastIndexOf("/") + 1);
        args = args.slice(2);
    }

    res.printHelp = function() {
        console.log(`USAGE: ${bin} [OPTIONS]... args...`);
        console.log("The following options are supported:");
        for (let o in opts) {
            if (o == "_meta_") continue;
            let s = opts[o].key;
            if (s) {
                s = '-' + s + ',';
            } else {
                s = "   ";
            }
            console.log(`  ${s} --${o} ${opts[o].args==1?"<ARG>":""}\t${opts[o].description}`);
        }
        console.log("      --help      \tDisplay this help and exit");
    };

    let err = function(msg) {
        console.log(msg);
        res.printHelp();
        exit(1);
        return {};
    };

    // map of keys
    let keys_map = {};
    for (let o in opts) {
        if (opts[o].key) {
            keys_map[opts[o].key] = o;
        }
    }

    for (let i in args) {
        if (args[i] == undefined) continue;
        i = Number(i);
        // replace keys with full names
        if (args[i].startsWith("-") && args[i].length == 2) {
            if (args[i].charAt(1) in keys_map) {
                args[i] = "--" + keys_map[args[i].charAt(1)];
            } else {
                return err("Unknown option " + args[i]);
            }
        }
        // handle options
        if (args[i].startsWith("--")) {
            let o = args[i].substring(2);
            if (o == "help") {
                res.printHelp();
                args[i] = undefined;
                exit();
            } else if (o in opts) {
                if (opts[o].args == 1) {
                    if (i + 1 < args.length) {
                        res[o] = args[i + 1];
                        if (!isNaN(Number(res[o]))) {
                            res[o] = Number(res[o]);
                        }
                        args[i + 1] = undefined;
                    } else {
                        return err(`A value is needed for ${args[i]} ${Number(i)+1} ${args.length}`);
                    }
                    args[i] = undefined;
                } else if (opts[o].args == undefined) {
                    res[o] = true;
                    args[i] = undefined;
                } else {
                    return err("Unsupported args != 1");
                }
            } else {
                return err("Unknown option " + args[i]);
            }
        }
    }

    // add extra args
    res.args = [];
    for (let a of args) {
        if (a != undefined) {
            res.args.push(a);
            let max = opts["_meta_"].maxArgs;
            if (res.args.length > max) {
                return err(`Only ${max} arguments allowed`);
            }
        }
    }
    return res;
}

function exit(code) {
    if (typeof(process) != 'undefined') {
        process.exit(code);
    }
}

function quran(args) {
    let res_str = "";
    const print = s => res_str += s + "\n";
    const printj = s => res_str += JSON.stringify(s, null, 2) + "\n";

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

    let default_tcols = typeof(process) != 'undefined' ?
        process.stdout.columns : -1;

    function wrap(s) {
        if (default_tcols == -1) return s;
        let w = default_tcols;
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
            printw("> " + q.tafseer[t][a.index]);
            print('');
        }
    }

    if (typeof(args) == 'string') {
        const matches = {
            "tafseer": "--tafseer ar",
            "تفسير": "--tafseer ar",
            "translation": "--tafseer en",
            "ترجمة": "--tafseer en",
            "translation": "--tafseer en",
            "search": "--search",
            "بحث": "--search",
            "suras": "--list-suras",
            "السور": "--list-suras"
        };
        args = args.split(' ');
        let new_args = [];
        for (let i = 0; i < args.length; ++i) {
            if (args[i] in matches) {
                let match = matches[args[i]];
                new_args = new_args.concat(match.split(" "));
                if (match == "--search" &&
                    i + 1 < args.length &&
                    (args[i + 1] == "for" || args[i + 1] == "عن")) {
                    i += 1;
                }
                let rest = [];
                for (let j = i + 1; j < args.length; ++j) {
                    rest.push(args[j]);
                }
                if (rest.length != 0) {
                    new_args.push(rest.join(" "));
                }
                break;
            } else {
                new_args.push(args[i]);
            }
        }
        args = new_args;
    }

    const opts = getopt({
        "_meta_":       { maxArgs: 1 },
        "tafseer":      { key: "t", args: 1, description: "Show tafseer"                 },
        "search":       { key: "s", args: 1, description: "Search Quran"                 },
        "list-suras":   { key: "l",          description: "List sura names"              },
        "list-tafseer": { key: "b",          description: "List available tafseer books" },
        "width":        { key: "w", args: 1, description: "Terminal width"               },
        "no-wrap":      { key: "n",          description: "Disable line wrapping"        }
    }, args);

    if (opts["no-wrap"]) {
        default_tcols = -1;
    } else if (opts.width && opts.width > 0) {
        default_tcols = opts.width - 1;
    }

    if (opts["list-suras"]) {
        let count = 1;
        for (let s of q.suras) {
            print(`${count++}. ${s.name} - ${s.name_en}`);
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

    return res_str;
}

if (typeof(process) != 'undefined') {
    console.log(quran(process.argv));
}
