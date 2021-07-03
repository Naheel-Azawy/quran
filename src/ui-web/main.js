import {
    q, loc, locAya, locNext, locPrev, replaceArDigits,
    searchPrint, pagePrint, ayaPrint, listAllPrint,
    props, tafseerList, tafseerAt
} from "../core";

import {
    $get, $div, $br, $input, $button,
    $select, $option, $hr
} from "elemobj";

import "./styles.css";

let touchStartX;
let popupLoc;
let isMovingPage = false;
let stopPlayer = false;

const defaultConf = {
    arg:     "1",
    theme:   "b",
    tafseer: "en.sahih"
};

function setConf(key, val) {
    if (window.localStorage) {
        localStorage.setItem(key, val);
    }
}

function getConf(key) {
    if (window.localStorage) {
        let res = localStorage.getItem(key);
        if (res == null) {
            res = defaultConf[key];
        } else if (typeof defaultConf[key] == "boolean") {
            res = res == "true";
        } else if (typeof defaultConf[key] == "number") {
            res = Number(res);
        }
        return res;
    } else {
        return defaultConf[key];
    }
}

async function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

function insertAfter(elem, newElem) {
    elem.parentNode.insertBefore(newElem, elem.nextSibling);
}

function setTheme(color) {
    if (color == undefined) {
        color = getConf("theme");
    }
    switch (color) {
    case "b":
        document.body.classList.remove("yellow");
        document.body.classList.remove("white");
        break;
    case "y":
        document.body.classList.remove("white");
        document.body.classList.add("yellow");
        break;
    case "w":
        document.body.classList.remove("yellow");
        document.body.classList.add("white");
        break;
    default:
        return;
    }
    setConf("theme", color);
}

function isPage(num) {
    if (typeof num != "number") {
        try {
            num = Number(num);
        } catch (e) {
            return false;
        }
    }
    if (num < 1 || num > 604) {
        return false;
    }
    return true;
}

function updateCon(arg, check) {
    if (arg == undefined) {
        arg = getConf("arg");
    }
    arg = replaceArDigits(arg);
    if (!arg) arg = "";
    $get("#q").value = arg;
    setConf("arg", arg);
    let {res, resPrint} = searchPrint(arg);
    if (res.length == 1 && !check) {
        resPrint = pagePrint(res[0].page);
    }
    $get("#con").innerHTML = resPrint;
    if (!isNaN(Number(arg)) && arg >= 3 && arg <= 604) {
        fixSpacing();
    }
}

async function moveDir(dir) {
    if (isMovingPage || modalShown()) {
        return;
    }
    isMovingPage = true;

    if (!ayaPopupShown()) {
        // move page
        let v = getConf("arg");
        if (isNaN(Number(v))) {
            return;
        }

        let num = Number(v) + dir;
        if (isPage(num)) {
            let gap = 150;
            let first  = dir == +1 ? "right" : "left";
            let second = dir == +1 ? "left"  : "right";
            let con = $get("#con");
            con.style.transition = "none";
            con.classList.add(`animate-${first}-out`);
            await sleep(gap);
            updateCon(num);
            con.classList.remove(`animate-${first}-out`);
            con.classList.add(`animate-${second}-in`);
            await sleep(gap);
            con.classList.remove(`animate-${second}-in`);
            await sleep(gap);
            con.style.transition = "100ms";
        }
    } else if (popupLoc) {
        // move aya
        let newLoc = dir == +1 ? locNext(popupLoc) : locPrev(popupLoc);
        ayaClick(newLoc.id);
    }

    isMovingPage = false;
}

function next() {
    moveDir(+1);
}

function prev() {
    moveDir(-1);
}

function play(l) {
    l = l.toString().padStart(6, '0');
    let url = "https://everyayah.com/data/Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net/" +
        l + ".mp3";
    console.log(url);

    return new Promise(res => {
        let a = new Audio(url);
        a.play();
        a.onended = res;
    });
}

async function playAll(l) {
    stopPlayer = false;
    while (!stopPlayer) {
        await play(l);
        l = locNext(l).id;
    }
}

function modalView() {
    return $div({
        id: "modal-main",
        className: "modal",
        onclick: event => {
            if (event.target == $get("#modal-main")) {
                hideModal();
            }
        }
    }, $div({className: "modal-content"}, [
        $div({id: "modal-main-content"}),
        $br(),
        $button({
            style: {margin: "10px"},
            onclick: hideModal
        }, "CLOSE"),
        $br()
    ]));
}

function showModal(content) {
    let e = $get("#modal-main-content");
    e.innerHTML = "";
    e.appendChild($div(content));
    $get("#modal-main").style.display = "block";
}

function hideModal() {
    $get("#modal-main-content").innerHTML = "";
    $get("#modal-main").style.display = "none";
}

function modalShown() {
    return $get("#modal-main").style.display == "block";
}

async function loadTafseer(tafseer) {
    if (!tafseer) {
        tafseer = getConf("tafseer");
    }

    let stored = getConf("tafseer-" + tafseer);
    if (stored) {
        props.tafseer = JSON.parse(stored);
    } else {
        console.log(`Downloading ${tafseerList[tafseer].name}...`);
        let res = await fetch(tafseerList[tafseer].link);
        res = await res.text();
        res = res.split("\n");
        let arr = [];
        for (let i in res) {
            res[i] = res[i].split("|");
            if (res[i].length == 3) {
                arr.push(res[i][2]);
            }
        }
        setConf("tafseer-" + tafseer, JSON.stringify(arr));
        console.log(`Saved ${tafseerList[tafseer].name}`);
        props.tafseer = arr;
    }
}

function moreView() {
    return $div({style: {textAlign: "center"}}, [
        $input({
            id: "q", value: getConf("arg"),
            style: {
                textAlign: "center",
                width:     "90%"
            },
            onkeydown: e => {
                if (e.key == "Enter") {
                    e.preventDefault();
                    updateCon(undefined, true);
                }
            }
        }),
        $button({
            onclick: () => {
                let e = $get("#more-items");
                if (e.style.display == "block") {
                    e.style.display = "none";
                } else {
                    e.style.display = "block";
                }
            }
        }, "..."),
        $div({
            id: "more-items",
            style: {display: "none"}
        }, [
            $div([
                $button({
                    className: "theme-btn",
                    style: {background: "black"},
                    onclick: () => {setConf("theme", "b");setTheme();}
                }),
                $button({
                    className: "theme-btn",
                    style: {background: "#fbfb95"},
                    onclick: () => {setConf("theme", "y");setTheme();}
                }),
                $button({
                    className: "theme-btn",
                    style: {background: "white"},
                    onclick: () => {setConf("theme", "w");setTheme();}
                }),
            ]),
            $br(),

            $div({
                contenteditable: true,
                style: {
                    height:       "50vh",
                    padding:      "10px",
                    overflowWrap: "normal",
                    overflowX:    "auto"
                }
            }, listAllPrint())
        ])
    ]);
}

function mainView() {
    return $div({id: "main"}, [
        moreView(),
        $div({id: "con", className: "quran-page"}),
        $br(),
        modalView()
    ]);
}

function ayaPopupTafseerView(l) {
    return tafseerAt(l);
}

function ayaPopupView(l) {
    popupLoc = l;
    let align = getConf("tafseer").startsWith("ar") ? "right" : "left";
    let opt;
    let res = $div({id: "aya-popup"}, [
        $hr(),
        $div({
            id: "aya-popup-text",
            style: {
                maxHeight:     "50vh",
                padding:       "5px",
                overflowWrap:  "normal",
                overflowX:     "auto",
                wordSpacing:   "0px",
                textAlign:     align,
                textAlignLast: align
            }
        }, ayaPopupTafseerView(l)),
        $br(),
        $div([
            $button({onclick: () => ayaClick(l)}, "X"),
            opt = $select({
                id: "tafseer-select",
                style: {width: "70%"},
                onchange: async () => {
                    let tafseer = $get("#tafseer-select").value;
                    await loadTafseer(tafseer);
                    setConf("tafseer", tafseer);
                    ayaClick(l);
                    ayaClick(l);
                }
            }),
            $br(),
            $button({onclick: () => stopPlayer = true}, "STOP"),
            $button({onclick: () => playAll(l)}, "PLAY ALL"),
            $button({onclick: () => play(l)}, "PLAY")
        ]),
        $hr(), $br()
    ]);

    let i = 0;
    for (let t in tafseerList) {
        opt.appendChild($option({value: t}, tafseerList[t].name));
        if (t == getConf("tafseer")) {
            opt.selectedIndex = i;
        }
        ++i;
    }

    res.l = l;

    return res;
}

function ayaPopupShown() {
    return $get("#aya-popup");
}

async function ayaClick(l) {
    let popupElem = $get("#aya-popup");
    let popupLoc = undefined;
    if (popupElem) {
        popupLoc = popupElem.l;
        popupElem.remove();
    }
    if (l != undefined && popupLoc != l) {
        let e = $get("#aya-" + l);
        if (e) {
            insertAfter(e, ayaPopupView(l));
            await sleep(300);
            e.scrollIntoView({block: "start", behavior: "smooth"});
        }
    }
}

async function searchClick(l) {
    hideModal();
    updateCon(locAya(loc(l)).page);
    let e = $get("#aya-" + l);
    e.classList.add("highlighted");
    await sleep(3000);
    e.classList.remove("highlighted");
}

function getStyle(elem, key) {
    return document.defaultView.getComputedStyle(elem, null)
        .getPropertyValue(key);
}

function countPageLines() {
    let e = $get(".quran-page-content")[0];
    return (e.offsetHeight /
            parseInt(getStyle(e, "line-height"))) | 0;
}

function changeSpacing(diff) {
    let s = getSpacing();
    s += diff;
    for (let e of $get(".quran-content")) {
        e.style.wordSpacing = s + "px";
    }
}

function getSpacing() {
    let e = $get(".quran-content")[0];
    return parseInt(getStyle(e, "word-spacing"));
}

function fixSpacing() {
    const target = 15;
    const maxTries = 20;
    let l;
    for (let t = 0; t < maxTries; ++t) {
        l = countPageLines();
        if (l >= (target + 1)) break;
        changeSpacing(+1);
    }
    for (let t = 0; t < maxTries; ++t) {
        changeSpacing(-1);
        l = countPageLines();
        if (l <= target) break;
    }
}

async function main() {
    if ("serviceWorker" in navigator) {
        try {
            let reg = await navigator.serviceWorker.register("sw.bundle.js");
            console.log("SW registered: ", reg);
        } catch (e) {
            console.log("SW registration failed: ", e);
        }
    }

    setTheme();
    document.title = "Quran";
    document.body.innerHTML = "";
    document.body.appendChild(mainView());

    window.addEventListener("keydown", event => {
        switch (event.key) {
        case "ArrowLeft":  next(); break;
        case "ArrowRight": prev(); break;
        case "Escape":
            if (ayaPopupShown()) {
                ayaClick();
            }
            hideModal();
            break;
        }
    });

    window.addEventListener("touchstart", event => {
        touchStartX = event.changedTouches[0].screenX;
    });

    window.addEventListener("touchend", event => {
        const threshold = 70;
        let touchEndX = event.changedTouches[0].screenX;
        let diff = touchEndX - touchStartX;
        if (diff > +threshold) next();
        if (diff < -threshold) prev();
    });

    updateCon(
        new URL(window.location.href).searchParams.get("q")
    );

    loadTafseer();

    window.quran = {
        q, loc, locAya, locNext,
        setTheme, ayaClick, searchClick,
        countPageLines, changeSpacing, getSpacing
    };
}

window.addEventListener("load", main);
