const fs     = require("fs");
const xml    = require('xml2json');
const print  = s => console.log(s);
const printj = s => console.log(JSON.stringify(s, null, 4));

function locgen(sura, aya) {
    return Number(sura) * 1000 + Number(aya);
}

function lineparse(line) {
    let a = line.split('|');
    return {
        sura: Number(a[0]),
        aya: Number(a[1]),
        text: a[2]
    };
}

function open(path) {
    return fs.readFileSync(path).toString().replace(/\r/g, "").split("\n");
}

const LEN = 6236;

let meta       = JSON.parse(xml.toJson(fs.readFileSync("./data/quran-data.xml")));
let uthmani    = open("./data/quran-uthmani.txt");
let simple     = open("./data/quran-simple-clean.txt");
let tafseer_ar = open("./data/ar.muyassar.txt");
let tafseer_en = open("./data/en.sahih.txt");

let tanzil_copyright = uthmani.slice(LEN + 2, uthmani.length).join("\n");

uthmani    = uthmani.slice(0, LEN);
simple     = simple.slice(0, LEN);
tafseer_ar = tafseer_ar.slice(0, LEN);
tafseer_en = tafseer_en.slice(0, LEN);

let out = {
    tanzil_copyright: tanzil_copyright,
    suras: [],
    juzus: [],
    hizbs: [],
    manzils: [],
    rukus: [],
    pages: [],
    sajdas: [],
    sajdas_types: []
};

function main() {

    for (let s of meta.quran.suras.sura) {
        out.suras.push({
            index: Number(s.index),
            ayas: [],
            start: Number(s.start),
            name: s.name,
            name_en: s.tname,
            name_tr: s.ename,
            type: s.type.toLowerCase(),
            order: Number(s.order),
            rukus: Number(s.rukus)
        });
    }

    for (let e of meta.quran.juzs.juz) {
        out.juzus.push(locgen(e.sura, e.aya));
    }

    for (let e of meta.quran.hizbs.quarter) {
        out.hizbs.push(locgen(e.sura, e.aya));
    }

    for (let e of meta.quran.manzils.manzil) {
        out.manzils.push(locgen(e.sura, e.aya));
    }

    for (let e of meta.quran.rukus.ruku) {
        out.rukus.push(locgen(e.sura, e.aya));
    }

    for (let e of meta.quran.pages.page) {
        out.pages.push(locgen(e.sura, e.aya));
    }

    for (let e of meta.quran.sajdas.sajda) {
        out.sajdas.push(locgen(e.sura, e.aya));
    }

    for (let e of meta.quran.sajdas.sajda) {
        out.sajdas_types.push(e.type);
    }

    out.tafseer = {
        ar_muyassar: [],
        en_sahih: []
    };

    for (let i = 0; i < uthmani.length; ++i) {
        let a = lineparse(uthmani[i]);
        let s = lineparse(simple[i]);
        let t = lineparse(tafseer_ar[i]);
        let e = lineparse(tafseer_en[i]);
        let l = locgen(a.sura, a.aya);
        let j = 0;
        while (j < out.juzus.length) {
            if (l < out.juzus[j])
                break;
            ++j;
        }
        let p = 0;
        while (p < out.pages.length) {
            if (l < out.pages[p])
                break;
            ++p;
        }
        if (a.aya == 1) {
            a.text = a.text.replace("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ", "");
            s.text = s.text.replace("بسم الله الرحمن الرحيم ", "");
        }
        out.suras[a.sura - 1].ayas[a.aya - 1] = {
            index: i,
            page: p,
            loc: l,
            juzu: j,
            text: a.text,
            text_simple: s.text
        };

        out.tafseer.ar_muyassar[i] = t.text;
        out.tafseer.en_sahih[i] = e.text;
    }

    printj(out);

}

main();
