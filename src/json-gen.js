const fs   = require("fs");
const path = require("path");
const xml  = require("xml2json");

function locgen(sura, aya) {
    return Number(sura) * 1000 + Number(aya);
}

function lineparse(line) {
    let a = line.split('|');
    return {
        sura: Number(a[0]),
        aya:  Number(a[1]),
        text: a[2]
    };
}

function open(f) {
    return fs.readFileSync(path.resolve(__dirname, f))
        .toString()
        .replace(/\r/g, "")
        .split("\n");
}

function openXml(f) {
    return JSON.parse(
        xml.toJson(fs.readFileSync(path.resolve(__dirname, f))));
}

function gen() {
    const LEN = 6236;

    let meta      = openXml("../data/quran-data.xml");
    let uthmani   = open("../data/quran-uthmani.txt");
    let simple    = open("../data/quran-simple-clean.txt");

    let tafseerAr = open("../data/ar.muyassar.txt");
    let tafseerEn = open("../data/en.sahih.txt");
    let tafseerRu = open("../../quran-exp/translations/ru.krachkovsky");
    let ierab     = open("../../quran-exp/i3rab/aleman/ar.ierab");

    // TODO: build downloader and remove all tafseers

    let tanzilCopyright = uthmani.slice(LEN + 2, uthmani.length).join("\n");

    uthmani   = uthmani.slice(0, LEN);
    simple    = simple.slice(0, LEN);

    tafseerAr = tafseerAr.slice(0, LEN);
    tafseerEn = tafseerEn.slice(0, LEN);
    tafseerRu = tafseerRu.slice(0, LEN);
    ierab     = ierab.slice(0, LEN);

    let out = {
        tanzilCopyright: tanzilCopyright,
        suras:       [],
        juzus:       [],
        hizbs:       [],
        manzils:     [],
        rukus:       [],
        pages:       [],
        sajdas:      [],
        sajdasTypes: []
    };

    for (let s of meta.quran.suras.sura) {
        out.suras.push({
            index:  Number(s.index),
            ayas:   [],
            start:  Number(s.start),
            name:   s.name,
            nameEn: s.tname,
            nameTr: s.ename,
            type:   s.type.toLowerCase(),
            order:  Number(s.order),
            rukus:  Number(s.rukus)
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
        out.sajdasTypes.push(e.type);
    }

    out.tafseer = {
        arMuyassar: [],
        enSahih:    [],
        ruSahih:    [],
        ierab:      []
    };

    for (let i = 0; i < uthmani.length; ++i) {
        let a = lineparse(uthmani[i]);
        let s = lineparse(simple[i]);

        let t = lineparse(tafseerAr[i]);
        let e = lineparse(tafseerEn[i]);
        let r = lineparse(tafseerRu[i]);
        let ie = lineparse(ierab[i]);

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
            a.text = a.text.replace("بِّسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ", "");
            a.text = a.text.replace("بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ", "");
            s.text = s.text.replace("بسم الله الرحمن الرحيم ", "");
        }
        out.suras[a.sura - 1].ayas[a.aya - 1] = {
            index:      i,
            page:       p,
            loc:        l,
            juzu:       j,
            text:       a.text,
            textSimple: s.text
        };

        /*out.tafseer.arMuyassar[i] = t.text;
        out.tafseer.enSahih[i]    = e.text;
        out.tafseer.ruSahih[i]    = r.text;
        out.tafseer.ierab[i]      = ie.text;*/
    }

    return out;
}

function main(production) {
    let o = gen();
    fs.writeFileSync(
        path.resolve(__dirname, "../data/quran.json"),
        JSON.stringify(o, null, production ? 0 : 4));
}

// module.exports = main;
main(false);
