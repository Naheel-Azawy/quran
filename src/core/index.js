import {decompress} from "compress-json";
import {justify}    from "./justify";

export const q = decompress(QURAN_JSON);
export const tafseerList = TAFSEER;

export let props = {
    complex: typeof window  != "undefined",
    defaultTcols: typeof process != "undefined" ?
        process.stdout.columns : -1,
    tafseer: undefined
};

let surasNames = {};
for (let i = 0; i < q.suras.length; ++i) {
    surasNames[q.suras[i].name] =
        surasNames[q.suras[i].nameEn] =
        surasNames[q.suras[i].nameTr] =
        surasNames[q.suras[i].nameEn
                   .replace(/[^0-9a-z]/gi, '')
                   .toLocaleLowerCase()] = i + 1;
}

const complexBrPlaces = {
    1: [{sura: 1, aya: 2, word: 0, spacing: 10},
        {sura: 1, aya: 3, word: 0, spacing: 0 },
        {sura: 1, aya: 5, word: 0, spacing: 10},
        {sura: 1, aya: 6, word: 1, spacing: 0 },
        {sura: 1, aya: 7, word: 3, spacing: 0 },
        {sura: 1, aya: 7, word: 7, spacing: 0 }],

    2: [{sura: 2, aya: 2, word: 8, spacing: 0 },
        {sura: 2, aya: 3, word: 5, spacing: 0 },
        {sura: 2, aya: 4, word: 4, spacing: 0 },
        {sura: 2, aya: 5, word: 0, spacing: 5 },
        {sura: 2, aya: 5, word: 7, spacing: 0 }],

    604: [{sura: 114, aya: 6, word: 0, spacing: 0 }]
};

function fuzzy(str, s) {
    let hay = str.toLowerCase(), i = 0, n = -1, l;
    s = s.toLowerCase();
    for (; l = s[i++] ;) if (!~(n = hay.indexOf(l, n + 1))) return false;
    return true;
}

export function getSura(target) {
    target = target.trim();
    if (!target) {
        throw new Error(`Invalid sura name`);
    }
    if (target.startsWith("سورة")) {
        target = target.replace("سورة", "");
    }
    let res = surasNames[target];
    if (!res) {
        for (let s of Object.keys(surasNames)) {
            if (fuzzy(s, target)) {
                res = surasNames[s];
                break;
            }
        }
    }
    if (!res) {
        throw new Error(`No sura named '${target}' was found`);
    } else {
        return res;
    }
}

export function loc(s, a) {
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

export function locAya(l) {
    return q.suras[l.sura - 1].ayas[l.aya - 1];
}

export function locNext(l) {
    l = loc(l);
    ++l.aya;
    if (l.aya > q.suras[l.sura - 1].ayas.length) {
        ++l.sura;
        if (l.sura >= q.suras.length) {
            return undefined;
        }
        l.aya = 1;
    }
    l.id = l.sura * 1000 + l.aya;
    return l;
}

export function locPrev(l) {
    l = loc(l);
    --l.aya;
    if (l.aya < 1) {
        --l.sura;
        if (l.sura < 1) {
            return undefined;
        }
        l.aya = q.suras[l.sura - 1].ayas.length;
    }
    l.id = l.sura * 1000 + l.aya;
    return l;
}

function search(target) {
    try {
        // if target is a page number
        if (!isNaN(Number(target))) {
            if (target >= 1 && target <= q.pages.length) {
                return [locAya(loc(q.pages[target - 1]))];
            }
        }
        // if target is a loc id
        /*let l = loc(Number(target));
          if (l != undefined) {
          return [locAya(l)];
          }*/
    } catch (e) {}
    let list = [];
    if (target.startsWith("و ")) target = "و" + target.substring(2);
    target = target.replaceAll(" و ", "و ")
        .replaceAll("ة", "ه")
        .replace(/\s+/g, ' ').trim();
    if (target.length != 0) {
        let sp = target.split(' ');
        let l;
        if (sp.length == 2 && (l = loc(sp[0], sp[1]))) { // sura# aya#
            list.push(locAya(l));
        } else if (sp.length == 1 && (l = loc(sp[0], 1))) { // sura#
            list.push(locAya(l));
        } else {
            if (sp.length == 2 && Number.isInteger(Number(sp[1]))) { // jump
                let arg = Number(sp[1]);
                switch (sp[0]) {
                case "s":
                case "س":
                case "sura":
                case "سوره":
                    l = loc(getSura(arg), 1);
                    if (l) list.push(locAya(l));
                    break;
                case "j":
                case "ج":
                case "juzu":
                case "جزء":
                case "الجزء":
                    if (arg >= 1 && arg <= 30) {
                        l = loc(q.juzus[arg - 1]);
                        if (l) list.push(locAya(l));
                    }
                    break;
                case "hizb":
                case "hizib":
                case "حزب":
                case "الحجب":
                    if (arg >= 1 && arg <= q.hizibs.length) {
                        l = loc(q.hizibs[arg - 1]);
                        if (l) list.push(locAya(l));
                    }
                    break;
                case "p":
                case "ص":
                case "page":
                case "صفحه":
                case "الصفحه":
                    if (arg >= 1 && arg <= q.pages.length) {
                        l = loc(q.pages[arg - 1]);
                        if (l) list.push(locAya(l));
                    }
                    break;
                }
            } else { // suraName
                try {
                    l = loc(getSura(sp[0]), 1);
                    if (l) list.push(locAya(l));
                } catch (err) {}
            }
            for (let sura of q.suras) { // fullSearch
                for (let aya of sura.ayas) {
                    if (aya.textSimple
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

function wrap(s) {
    let w = props.defaultTcols;
    if (w == -1) return s;
    return s.replace(
        new RegExp(`(?![^\\n]{1,${w}}$)([^\\n]{1,${w}})\\s`, 'g'), '$1\n'
    ) + "\n";
}

function just(s) {
    let res = "";
    s = s.split("\n");
    for (let line of s) {
        res += justify(line, props.defaultTcols, false, true) + "\n";
    }
    return res;
}

function arNum(n) {
    const ar = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    n += "";
    let res = '';
    for (let i of n) {
        res += ar[Number(i)];
    }
    return res;
}

export function replaceArDigits(str) {
    str = str.toString();
    const ar = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
    for (let i in ar) {
        str = str.replace(ar[i], i);
    }
    return str;
}

function prevAya(a) {
    let l = locPrev(a.loc);
    if (l == undefined) {
        return undefined;
    } else {
        return q.suras[l.sura - 1].ayas[l.aya - 1];
    }
}

export function tafseerAt(aya) {
    if (!props.tafseer) {
        return undefined;
    }
    if (typeof aya == "number") {
        aya = locAya(loc(aya));
    }
    let res = props.tafseer[aya.index];
    if (res.startsWith("EQUAL ")) {
        let targetAya = res.split("EQUAL ")[1];
        let sura = loc(aya.loc).sura;
        aya = q.suras[sura - 1].ayas[targetAya - 1];
        res = props.tafseer[aya.index];
    }
    return res;
}

export function ayaPrint(aya, tafseer, centerComplex) {
    let a;
    let l;
    if (typeof aya == "number") { // index
        l = loc(aya);
        a = locAya(l);
    } else if (aya.text) { // aya object
        a = aya;
        l = loc(a.loc);
    } else { // loc object
        l = aya;
        a = locAya(l);
    }
    if (!props.tafseer ||
        props.tafseer.length == 0) {
        tafseer = undefined;
    }
    let res = "";

    if (props.complex) {
        let text = a.text;
        let centerSpacing = 0;
        if (centerComplex) {
            text = text.split(" ");
            if (complexBrPlaces[a.page]) {
                for (let place of complexBrPlaces[a.page]) {
                    if (l.aya == place.aya && l.sura == place.sura) {
                        text[place.word] = "<br>" + text[place.word];
                        centerSpacing = place.spacing;
                    }
                }
            }
            text = text.join(" ");
        }

        res += '<span class="quran-aya" ';
        if (centerSpacing) {
            res += `style="word-spacing: ${centerSpacing}" `;
        }
        res += `onclick="window.quran.ayaClick(${a.loc})" ` +
            `id="aya-${a.loc}">` +
            `${text} ﴿${arNum(l.aya)}﴾ </span>`;
        if (tafseer) {
            res += `\n<p><span class="quran-tafseer" dir=auto>` +
                `${tafseerAt(a)}</span></p>\n`;
        }

    } else {
        res += a.textSimple + ` {${l.aya}} `;
        if (tafseer) {
            res += `\n> ${tafseerAt(a)}\n\n`;
        }
    }
    return res;
}

function namePrint(s) {
    if (props.complex) {
        return `<span class="quran-sura">` +
            `{ سورة ${q.suras[s].name} } </span>`;
    } else {
        return `--{ سورة ${q.suras[s].name} }--\n`;
    }
}

function bismilahPrint(s) {
    ++s;
    if (s != 1 && s != 9) {
        if (props.complex) {
            return '<span class="quran-bismilah">' +
                q.suras[0].ayas[0].text + "</span>";
        } else {
            return wrap(q.suras[0].ayas[0].textSimple);
        }
    }
    return "";
}

function headerPrint(pageOrAya, simple=false) {
    let l, a;
    if (typeof pageOrAya == "number") {
        // we assume its a page
        l = loc(q.pages[pageOrAya - 1]);
        a = q.suras[l.sura - 1].ayas[l.aya - 1];
    } else {
        // we assume it's an aya object
        l = loc(pageOrAya.loc);
        a = pageOrAya;
    }
    let page = a.page;
    let sura = q.suras[l.sura - 1].name;
    let juzu = a.juzu;
    if (props.complex && !simple) {
        return '<div class="quran-header">' +
            `<span style="float:right">الجزء ${juzu}</span>` +
            `<span style="float:center">الصفحة ${page}</span>` +
            `<span style="float:left">سورة ${sura} ${l.sura}</span>` +
            '</div>';
    } else {
        return `\n(الصفحة ${page}, الجزء ${juzu}, سورة ${sura} ${l.sura})\n\n`;
    }
}

export function quranPrint(sura, tafseer, page) {
    let res = "";
    let startAya = 0, startSura = 0;
    let centerComplex = false;
    if (page) {
        let thisLoc = loc(q.pages[page - 1]);
        let locNext = loc(q.pages[page]);
        startSura = thisLoc.sura - 1;
        startAya = thisLoc.aya - 1;
        if (props.complex && Object.keys(complexBrPlaces)
            .includes(page.toString())) {
            centerComplex = true;
        }
    } else {
        startSura = sura - 1;
        startAya = 0;
    }

    surasLoop: for (let s = startSura; true; ++s) {
        if (s >= q.suras.length) {
            break;
        }
        let ayas = q.suras[s].ayas;
        let i = s == startSura ? startAya : 0;

        let first = true;
        for (; i < ayas.length; ++i) {
            let a = ayas[i];
            let l = loc(a.loc);
            if (page != undefined && a.page != page) {
                break surasLoop;
            }

            let prev = prevAya(a);
            if (prev == undefined || a.page != prev.page) {
                res += headerPrint(a.page);
                if (props.complex) {
                    res += '<div class="quran-page-content">\n';
                }
            }
            if (l.aya == 1) {
                res += namePrint(s) + bismilahPrint(s);
            }
            if (props.complex && first) {
                res += '<div class="quran-content';
                if (centerComplex) {
                    res += " quran-content-center";
                }
                res += '"';
                res += ">\n";
            }
            if (prev != undefined &&
                l.aya != 1 &&
                a.juzu != prev.juzu) {
                res += "* ";
            }
            res += ayaPrint(a, tafseer, centerComplex);
            first = false;
        }
        if (props.complex) {
            res += "\n</div>";
        }

        if (page == undefined) {
            break;
        }
        res += "\n\n";
    }
    if (props.complex) {
        res += "\n</div>";
    }

    if (props.complex) {
        return res;
    } else {
        return just(res).trim();
    }
}

export function pagePrint(page, tafseer) {
    return quranPrint(undefined, tafseer, page);
}

export function surasListPrint() {
    let res = [];
    for (let i in q.suras) {
        if (props.complex) {
            res.push(`<li onclick="window.quran.searchClick(${q.suras[i].ayas[0].loc})" ` +
                     `class="quran-list-item">` +
                     `${Number(i) + 1}. ${q.suras[i].name} - ${q.suras[i].nameEn}</li>`);
        } else {
            res.push(`${i + 1}. ${q.suras[i].name} - ${q.suras[i].nameEn}`);
        }
    }
    res = res.join("\n");
    if (props.complex) {
        res = `<ol>\n${res}\n</ol>`;
    }
    return res;
}

export function listAllPrint() {
    // TODO: add Juzus and whatever
    return surasListPrint();
}

export function booksListPrint() {
    if (props.complex) {
        let res = [];
        for (let t of Object.keys(tafseerList)) {
            res.push(`<li>${t}</li>`);
        }
        res = res.join("\n");
        res = `<ul>\n${res}\n</ul>`;
        return res;
    } else {
        return Object.keys(tafseerList).join("\n");
    }
}

export function searchPrint(target, tafseer) {
    let res = search(target);
    let resPrint = `[${res.length}]\n\n`;
    if (props.complex) {
        resPrint += "<ol>\n";
    }
    let l;
    for (let aya of res) {
        l = loc(aya.loc);
        if (props.complex) {
            resPrint += `<li class="search-item" onclick="window.quran.searchClick(${l.id})">`;
            resPrint += `${headerPrint(aya, true).trim()} {${l.aya}}:`;
            resPrint += `<p><span class="quran-aya">${aya.textSimple}` +
                "</span></p>";
            if (tafseer && props.tafseer) {
                resPrint += '<p><span class="quran-tafseer">' +
                    `${props.tafseer[aya.index]}</span></p>`;
            }
            resPrint += "</li>";
        } else {
            resPrint += wrap(`${headerPrint(aya).trim()} {${l.aya}}:`);
            resPrint += wrap(aya.textSimple) + "\n";
            if (tafseer && props.tafseer) {
                resPrint += wrap(`> ${props.tafseer[aya.index]}\n\n`);
            }
        }
    }
    if (props.complex) {
        resPrint += "</ol>";
    }
    return {res, resPrint};
}
