import {
    q, getSura, pagePrint, props,
    surasListPrint, booksListPrint, searchPrint
} from "../core";

import {getopt} from "./getopt";

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;;
}

function run(args) {
    if (typeof(args) == 'string') {
        if (args == "") {
            args = [];
        } else {
            const matches = {
                "tafseer": "--tafseer ar",
                "تفسير": "--tafseer ar",
                "translation": "--tafseer en",
                "ترجمة": "--tafseer en",
                "translate": "--tafseer en",
                "search": "--search",
                "بحث": "--search",
                "suras": "--list-suras",
                "السور": "--list-suras"
            };
            args = args.trim().split(' ');
            let newArgs = [];
            for (let i = 0; i < args.length; ++i) {
                if (args[i] in matches) {
                    let match = matches[args[i]];
                    newArgs = newArgs.concat(match.split(" "));
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
                        newArgs.push(rest.join(" "));
                    }
                    break;
                } else {
                    newArgs.push(args[i]);
                }
            }
            args = newArgs;
        }
    }

    const opts = getopt({
        "_meta_":       { maxArgs: 1 },
        "page":         { key: "p", args: 1, description: "Print only one page"          },
        "tafseer":      { key: "t", args: 1, description: "Show tafseer"                 },
        "json":         { key: "j", args: 1, description: "Access Quran JSON directly"   },
        "list-suras":   { key: "l",          description: "List sura names"              },
        "list-tafseer": { key: "b",          description: "List available tafseer books" },
        "width":        { key: "w", args: 1, description: "Terminal width"               },
        "no-wrap":      { key: "n",          description: "Disable line wrapping"        }
    }, args);

    if (opts["no-wrap"]) {
        props.defaultTcols = -1;
    } else if (opts.width && opts.width > 0) {
        props.defaultTcols = opts.width - 1;
    }

    if (opts["list-suras"]) {
        return surasListPrint();
    } else if (opts["list-tafseer"]) {
        return booksListPrint();
    } else if (opts.json != undefined) {
        if (opts.json == ".") {
            return q;
        } else {
            return eval(`q${opts.json}`);
        }
    } else {
        let page, tafseer;
        if (opts.tafseer) {
            if (!q.tafseer[opts.tafseer]) {
                for (let t of Object.keys(q.tafseer)) {
                    if (t.includes(opts.tafseer)) {
                        opts.tafseer = t;
                        break;
                    }
                }
            }
            tafseer = opts.tafseer;
        }

        if (opts.args && opts.args.length != 0) {
            let {res, resPrint} = searchPrint(opts.args[0], tafseer);
            if (res.length == 1) {
                page = res[0].page;
            } else {
                return resPrint;
            }
        } else {
            page = rand(1, q.pages.length);
        }
        return pagePrint(page, tafseer);
    }
}

function main() {
    try {
        let argv;
        if (typeof Deno != "undefined") {
            argv = Deno.args;
        } else {
            argv = process.argv;
        }
        let res = run(argv);
        if (typeof res == "object") {
            res = JSON.stringify(res, null, 4);
        }
        console.log(res);
    } catch (e) {
        console.error(e.toString());
        throw e;
    }
}

main();
