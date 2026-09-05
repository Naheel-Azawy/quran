const fs = require("fs");

const JSON_DATA = "build/quran.json";
const JSON_BREAKS = "data/line_breaks_per_page.txt";

const text_type = "text";
//const text_type = "textSimple";

function mk_lut(q) {
    let counter = {};
    let lut = {};

    for (let sura of q.suras) {
        for (let aya of sura.ayas) {
            for (let char of aya.text) {
                if (char in counter) {
                    ++counter[char];
                } else {
                    counter[char] = 1;
                }
            }
        }
    }

    // not important, but why not sort by frequency
    let count_list = [];
    for (let c in counter) {
        if (c == ' ') continue; // space is far in the table; special case
        count_list.push([c, counter[c]]);
    }
    count_list = count_list.sort((a, b) => b[1] - a[1]);

    for (let [i, v] of count_list.entries()) {
        // 0: undefined
        // 1: space
        lut[v[0]] = i + 2;
    }
    return lut;
}

function hex(c, w=4) {
    if (typeof c == "string") {
        if (c.length != 1) {
            throw new Error(`only one char is allowed, got ${c.length}`);
        }
        c = c.charCodeAt(0);
    }
    let h = c.toString(16);
    if (h.length < w) {
        h = "0".repeat(w - h.length) + h;
    }
    return "0x" + h;
}

function mk_lut_big(lut) {
    let chars = Object.keys(lut);
    chars = chars.sort();
    const min = chars[0].charCodeAt(0);
    const max = chars[chars.length - 1].charCodeAt(0);
    let lut_big = [];
    for (let i = min; i <= max; ++i) {
        let num = lut[String.fromCharCode(i)];
        if (num == undefined) num = 0;
        lut_big.push([hex(i), num]);
    }
    // NOTE: space is not included here
    return lut_big;
}

function mk_c(lut, lut_big) {
    const tab = " ".repeat(4);
    let h = '#include "../src/quran_defs.h"\n\n';
    let c = `${h}`;

    h += `${h}#define QURAN_TXT_MIN ${lut_big[0][0]}
#define QURAN_TXT_MAX ${lut_big[lut_big.length - 1][0]}

`;

    let elems = [];
    for (let [chr, num] of lut_big) {
        elems.push(tab + `${hex(num, 2)}, // ${chr}`);
    }
    elems = elems.join("\n");

    let elems_rev = [];
    elems_rev.push(tab + `${hex('?')}, // 0x00`);
    elems_rev.push(tab + `${hex(' ')}, // 0x01`);
    for (let chr in lut) {
        elems_rev.push(tab + `${hex(chr)}, // ${hex(lut[chr], 2)}`);
    }
    elems_rev = elems_rev.join("\n");

    h += `extern quran_chr_t quran_txt_lut[];\n`;
    c += `quran_chr_t quran_txt_lut[] = {\n`;
    c += elems;
    c += `\n};\n\n`;

    h += `extern quran_chr_utf16_t quran_txt_lut_rev[];\n`;
    c += `quran_chr_utf16_t quran_txt_lut_rev[] = {\n`;
    c += elems_rev;
    c += `\n};\n`;

    return [c, h];
}

function mk_json(lut) {
    let ret = {lut: structuredClone(lut), lut_rev: {}};
    ret.lut[' '] = 1;
    for (let chr in ret.lut) {
        ret.lut_rev[ret.lut[chr]] = chr;
    }
    ret.lut_rev[0] = '?';
    return JSON.stringify(ret, null, 4);
}

function loc(s, a) {
    return s * 1000 + a;
}

function mk_c_data(q, lut) {
    const tab = " ".repeat(4);

    function quran_txt_enc(chr) {
        const chr_c = chr.charCodeAt(0);
        if (chr == ' ') {
            return 1;
        } else if (!(chr in lut)) {
            return 0;
        } else {
            return lut[chr];
        }
    }

    function quran_is_stop_sign(c) {
        if (c == undefined) {
            return false;
        }
        if (typeof c != "number") {
            c = c.charCodeAt(0);
        }
        return (c >= 0x06D6 && c <= 0x06DC);
    }

    let data = [];
    let endings_s = [];
    let endings_a = [];
    let i = 0, j = 0;
    for (let [s, sura] of q.suras.entries()) {
        for (let [a, aya] of sura.ayas.entries()) {
            for (let char_n = 0; char_n < aya[text_type].length; ++char_n) {
                let char = aya[text_type][char_n];
                if (char == ' ' &&
                    quran_is_stop_sign(aya[text_type][char_n + 1])) {
                    // remove spaces before stop signs
                    continue;
                }
                data.push(hex(quran_txt_enc(char), 2) + ",");
                ++i;
            }
            endings_a.push(i);
            ++j;
        }
        endings_s.push(j);
    }

    const mkloc = loc => `QURAN_LOC(${(loc / 1000 |0) - 1}, ${(loc % 1000) - 1})`;

    let h = '#include "../src/quran_defs.h"\n\n';
    let c = `${h}`;

    c += "quran_t quran = {\n\n";

    c += `.tanzil_copyright = ${JSON.stringify(q.tanzilCopyright)},\n\n`;

    c += ".sura_names = {\n";
    for (let [s, sura] of q.suras.entries()) {
        c += `L"${sura.name}", // ${s}\n`;
    }
    c += "},\n\n";

    c += ".pages = {\n";
    for (let [page, loc] of q.pages.entries()) {
        c += `${mkloc(loc)}, // ${page}\n`;
    }
    c += "},\n\n";

    c += ".juzus = {\n";
    for (let [juzus, loc] of q.juzus.entries()) {
        c += `${mkloc(loc)}, // ${juzus}\n`;
    }
    c += "},\n\n";

    // TODO: add hizbs, manzils, etc...

    const breaks = fs.readFileSync(JSON_BREAKS);
    c += `.breaks = {\n${breaks}},\n\n`;

    c += ".sura_ayas = {\n";
    for (let [s, sura] of q.suras.entries()) {
        c += `${sura.ayas.length}, // ${s}\n`;
    }
    c += "},\n\n";

    c += ".endings_s = {\n";
    for (let j = 0; j < endings_s.length; ++j) {
        c += `${endings_s[j]}, // ${j}\n`;
    }
    c += "},\n\n";

    h += `#define QURAN_AYAS_LEN ${endings_a.length}\n`;
    c += ".endings_a = {\n";
    for (let j = 0; j < endings_a.length; ++j) {
        c += `${endings_a[j]}, // ${j}\n`;
    }
    c += "},\n\n";

    h += `#define QURAN_TEXT_LEN ${data.length}\n`;
    c += ".text = {\n";
    for (let j = 0; j < data.length; ++j) {
        c += data[j];
        if ((j + 1) % 10 == 0) {
            c += "\n";
        } else {
            c += " ";
        }
    }
    c += "},\n";

    c += "};\n";

    return [c, h];
}

function main() {
    const q = JSON.parse(fs.readFileSync(JSON_DATA));
    const lut = mk_lut(q);
    const lut_big = mk_lut_big(lut);
    const [c, h] = mk_c(lut, lut_big);
    const j = mk_json(lut);
    const [c_data, h_data] = mk_c_data(q, lut);
    // console.log(lut);
    // console.log(lut_big);
    // console.log(c);
    fs.writeFileSync("build/lut.json", j);
    fs.writeFileSync("build/lut.c", c);
    fs.writeFileSync("build/lut.h", h);
    fs.writeFileSync("build/data.c", c_data);
    fs.writeFileSync("build/data.h", h_data);
}

main();
