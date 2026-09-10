import { ensureServerConsent } from "./consent.js";
import { openPanel } from "./panels.js";

// Mirrors of the same spa5k/tafsir_api repo -- only the base URL differs,
// editions/slugs are identical across all of them.
export const TAFSIR_SERVERS = {
    jsdelivr: {
        name: "jsDelivr (cdn.jsdelivr.net)",
        base: "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir",
    },
    githack: {
        name: "GitHack (rawcdn.githack.com)",
        base: "https://rawcdn.githack.com/spa5k/tafsir_api/bf42646e16973c59a0789b7a3ad065ff6ad6b0bf/tafsir",
    },
    statically: {
        name: "Statically (cdn.statically.io)",
        base: "https://cdn.statically.io/gh/spa5k/tafsir_api/main/tafsir",
    },
    githubusercontent: {
        name: "GitHub (raw.githubusercontent.com)",
        base: "https://raw.githubusercontent.com/spa5k/tafsir_api/main/tafsir",
    },
    gitloaf: {
        name: "Gitloaf (gitloaf.com)",
        base: "https://gitloaf.com/cdn/spa5k/tafsir_api/main/tafsir",
    },
};

function tafsirServerStorageKey() { return "quran-tafsir-server"; }
function tafsirEditionStorageKey() { return "quran-tafsir-edition"; }
function tafsirCustomServersStorageKey() { return "quran-tafsir-custom-servers"; }

function loadCustomTafsirServers() {
    try {
        const list = JSON.parse(localStorage[tafsirCustomServersStorageKey()] || "[]");
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function saveCustomTafsirServers(list) {
    localStorage[tafsirCustomServersStorageKey()] = JSON.stringify(list);
}

// Merges the built-in mirrors with any servers the user has added; custom
// entries are keyed by their own URL so re-adding the same server later
// reuses the same consent decision instead of asking again.
export function allTafsirServers() {
    const map = {};
    for (const key of Object.keys(TAFSIR_SERVERS)) map[key] = TAFSIR_SERVERS[key];
    for (const c of loadCustomTafsirServers()) map[c.id] = { name: c.name, base: c.base, custom: true };
    return map;
}

const initTafsirServers = allTafsirServers();
const initTafsirServerKey = (localStorage[tafsirServerStorageKey()] in initTafsirServers)
    ? localStorage[tafsirServerStorageKey()] : Object.keys(TAFSIR_SERVERS)[0];

export const tafsirState = {
    server: initTafsirServerKey,
    // left empty until the edition list is fetched; initTafsirEditionDefault()
    // fills this in with the first available edition if nothing was saved before
    edition: localStorage[tafsirEditionStorageKey()] || "",
};

function tafsirTextToPlain(html) {
    if (!html) return "";
    return String(html)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .trim();
}

// Fetches the tafsir/translation text for one ayah, gated behind the
// user's consent for whichever server is currently selected. Takes an
// explicit edition (rather than always reading tafsirState.edition) so
// the aya panel's own quick picker can differ from the settings default.
export async function fetchTafsirFor(sura, aya, edition) {
    const servers = allTafsirServers();
    const serverInfo = servers[tafsirState.server];
    if (!serverInfo) return { error: "لم يتم اختيار خادم للتفسير." };

    const allowed = await ensureServerConsent(
        "tafsir", tafsirState.server, serverInfo.name, serverInfo.base);
    if (!allowed) return { denied: true };

    const url = `${serverInfo.base}/${edition}/${sura + 1}/${aya + 1}.json`;
    try {
        const res = await fetch(url);
        if (res.status === 404) return { text: "" };
        if (!res.ok) return { error: `تعذر جلب التفسير (${res.status}).` };
        const data = await res.json();
        const raw = data?.text ?? data?.tafsir ?? data?.content ?? "";
        return { text: tafsirTextToPlain(raw) };
    } catch (e) {
        console.warn("Tafsir fetch failed:", e);
        return { error: "تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت." };
    }
}

// The edition list (slug/name/lang) is self-hosted alongside the app --
// a shrunk copy of the upstream tafsir_api's own /editions.json, with
// Arabic-language entries' names pre-translated into Arabic. Being
// same-origin, listing available tafsirs/translations never needs the
// external-server consent flow; only fetching a specific ayah's actual
// tafsir text (from whichever mirror is picked above) does.
let tafsirEditionsPromise = null;

function fetchTafsirEditions() {
    if (!tafsirEditionsPromise) {
        tafsirEditionsPromise = fetch("res/editions.json")
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(list => Array.isArray(list) ? list : [])
            .catch(e => {
                console.warn("Tafsir editions fetch failed:", e);
                tafsirEditionsPromise = null; // allow a retry later
                throw e;
            });
    }
    return tafsirEditionsPromise;
}

let tafsirEditionsList = null; // null = not yet loaded, [] = loaded but empty/failed
let tafsirEditionsLoadPromise = null;

function ensureTafsirEditionsLoaded() {
    if (tafsirEditionsList) return Promise.resolve(tafsirEditionsList);
    if (!tafsirEditionsLoadPromise) {
        tafsirEditionsLoadPromise = fetchTafsirEditions()
            .then(list => { tafsirEditionsList = list; return list; })
            .catch(() => { tafsirEditionsList = []; return []; });
    }
    return tafsirEditionsLoadPromise;
}

function findEdition(slug) {
    return (tafsirEditionsList || []).find(ed => ed.slug === slug) || null;
}

function capitalizeLang(lang) {
    return lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : lang;
}

function editionFieldLabel(slug) {
    if (!slug) return "الآية فقط";
    const ed = findEdition(slug);
    return ed ? ed.name : slug;
}

function updateSettingsEditionFieldLabel() {
    document.querySelector("#tafsir-edition-select .edition-field-label").textContent =
        tafsirState.edition ? editionFieldLabel(tafsirState.edition) : "اختر إصدارًا";
}

export function updateAyaEditionFieldLabel() {
    document.querySelector("#aya-tafsir-edition .edition-field-label").textContent =
        editionFieldLabel(ayaEditionChoice);
}

// Loads the edition list (if needed) and makes sure tafsirState.edition
// points at something real -- falling back to the first available
// edition the first time the app runs, or if a previously-saved slug no
// longer exists in the list.
export async function initTafsirEditionDefault() {
    const list = await ensureTafsirEditionsLoaded();
    if (list.length && (!tafsirState.edition || !list.some(ed => ed.slug === tafsirState.edition))) {
        tafsirState.edition = list[0].slug;
        localStorage[tafsirEditionStorageKey()] = tafsirState.edition;
    }
    updateSettingsEditionFieldLabel();
    updateAyaEditionFieldLabel();
}

// Small persistent memory of the last few editions actually used, shown
// pinned at the top of the picker (most recent first) so a frequently-read
// tafsir/translation doesn't need re-hunting through the full
// language-grouped list every time.
const RECENT_EDITIONS_KEY = "quran-tafsir-recent-editions";
const MAX_RECENT_EDITIONS = 5;

function loadRecentEditions() {
    try {
        const list = JSON.parse(localStorage[RECENT_EDITIONS_KEY] || "[]");
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function rememberEditionUse(slug) {
    if (!slug) return; // "aya only" isn't a real edition -- nothing to remember
    const list = loadRecentEditions().filter(s => s !== slug);
    list.unshift(slug);
    localStorage[RECENT_EDITIONS_KEY] = JSON.stringify(list.slice(0, MAX_RECENT_EDITIONS));
}

// ---------- aya panel edition state ----------

let ayaEditionChoice = ""; // "" = aya text only; otherwise the edition slug currently shown below it
let tafsirRequestSeq = 0;  // guards against a stale response landing after the user navigated on

// app.js provides this so tafsir.js can find out which {sura, aya} is
// currently open in the aya panel, without the two modules needing to
// share that state directly.
let ayaProvider = () => null;
export function setAyaProvider(fn) { ayaProvider = fn; }

export function hasAyaEditionChoice() {
    return !!ayaEditionChoice;
}

// every fresh tap on a new ayah starts from the aya text alone -- any
// tafsir/translation shown before is a deliberate per-view choice, not
// something that should silently carry over
export function resetAyaEditionChoice() {
    ayaEditionChoice = "";
    updateAyaEditionFieldLabel();
}

export async function loadTafsirForShown() {
    const shown = ayaProvider();
    if (!shown || !ayaEditionChoice) return;
    const { sura, aya } = shown;
    const edition = ayaEditionChoice;
    const seq = ++tafsirRequestSeq;

    const section   = document.getElementById("aya-tafsir-section");
    const contentEl = document.getElementById("tafsir-content");
    section.hidden = false;
    contentEl.textContent = "جارٍ التحميل...";
    contentEl.classList.add("tafsir-loading");

    const result = await fetchTafsirFor(sura, aya, edition);
    // the user may have navigated to a different ayah, switched back to
    // "aya only", or picked another edition while this was in flight --
    // drop a response that no longer matches the request
    if (seq !== tafsirRequestSeq) return;

    contentEl.classList.remove("tafsir-loading");
    if (result.denied) {
        contentEl.textContent = "لم تتم الموافقة على الاتصال بالخادم، لذا تعذر عرض التفسير.";
    } else if (result.error) {
        contentEl.textContent = result.error;
    } else {
        contentEl.textContent = result.text || "لا يوجد تفسير لهذه الآية في هذا الإصدار.";
    }
}

// ---------- edition picker panel (categorized by language + recents) ----------

let editionPickerContext = null; // "settings" | "aya" -- which field opened it

function editionPickerReturnPanel() {
    return editionPickerContext === "aya" ? "panel-aya" : "panel-tafsir";
}

function isCurrentPickerSelection(slug) {
    return editionPickerContext === "aya" ? ayaEditionChoice === slug : tafsirState.edition === slug;
}

function makeEditionSectionHeader(text) {
    const h = document.createElement("div");
    h.className = "edition-section-header";
    h.textContent = text;
    return h;
}

function makeEditionItem(ed, { showLang = false } = {}) {
    const active = isCurrentPickerSelection(ed.slug);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "edition-item" + (active ? " active" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(active));

    const nameEl = document.createElement("span");
    nameEl.className = "edition-item-name";
    nameEl.textContent = ed.name;
    item.appendChild(nameEl);

    if (showLang && ed.lang) {
        const langEl = document.createElement("span");
        langEl.className = "edition-item-lang";
        langEl.textContent = capitalizeLang(ed.lang);
        item.appendChild(langEl);
    }

    item.addEventListener("click", () => selectEditionFromPicker(ed.slug));
    return item;
}

function editionMatchesFilter(ed, q) {
    if (!q) return true;
    return `${ed.name} ${ed.lang}`.toLowerCase().includes(q);
}

function groupEditionsByLanguage(editions) {
    const groups = new Map();
    for (const ed of editions) {
        const lang = ed.lang || "";
        if (!groups.has(lang)) groups.set(lang, []);
        groups.get(lang).push(ed);
    }
    const keys = [...groups.keys()].sort((a, b) => {
        if (a === "arabic") return -1;
        if (b === "arabic") return 1;
        return a.localeCompare(b);
    });
    return keys.map(lang => ({ lang, editions: groups.get(lang) }));
}

export function renderEditionPickerList(filterText) {
    const container = document.getElementById("edition-picker-list");
    container.innerHTML = "";

    if (!tafsirEditionsList) {
        const status = document.createElement("p");
        status.className = "edition-picker-status";
        status.textContent = "جارٍ تحميل قائمة الإصدارات...";
        container.appendChild(status);
        ensureTafsirEditionsLoaded().then(() => {
            // only re-render if the picker is still open
            if (!document.getElementById("panel-edition-picker").hidden) {
                renderEditionPickerList(document.getElementById("edition-filter").value);
            }
        });
        return;
    }

    if (!tafsirEditionsList.length) {
        const status = document.createElement("p");
        status.className = "edition-picker-status";
        status.textContent = "تعذر تحميل قائمة الإصدارات.";
        container.appendChild(status);
        return;
    }

    const q = (filterText || "").trim().toLowerCase();
    let anyShown = false;

    // "aya only" is pinned at the very top in the aya panel's context,
    // regardless of any filter text -- it's always a valid choice there
    if (editionPickerContext === "aya" && !q) {
        container.appendChild(makeEditionItem({ slug: "", name: "الآية فقط", lang: "" }));
        anyShown = true;
    }

    if (!q) {
        const recents = loadRecentEditions()
            .map(findEdition)
            .filter(Boolean);
        if (recents.length) {
            container.appendChild(makeEditionSectionHeader("المستخدم مؤخرًا"));
            for (const ed of recents) container.appendChild(makeEditionItem(ed, { showLang: true }));
            anyShown = true;
        }
    }

    const filtered = tafsirEditionsList.filter(ed => editionMatchesFilter(ed, q));
    for (const { lang, editions } of groupEditionsByLanguage(filtered)) {
        container.appendChild(makeEditionSectionHeader(capitalizeLang(lang)));
        for (const ed of editions) container.appendChild(makeEditionItem(ed));
        anyShown = true;
    }

    if (!anyShown) {
        const status = document.createElement("p");
        status.className = "edition-picker-status";
        status.textContent = "لا توجد نتائج.";
        container.appendChild(status);
    }
}

export function openEditionPicker(context) {
    editionPickerContext = context;
    const filterInput = document.getElementById("edition-filter");
    filterInput.value = "";
    renderEditionPickerList("");
    openPanel("panel-edition-picker");
    requestAnimationFrame(() => filterInput.focus());
}

function selectEditionFromPicker(slug) {
    rememberEditionUse(slug);

    if (editionPickerContext === "settings") {
        tafsirState.edition = slug;
        localStorage[tafsirEditionStorageKey()] = tafsirState.edition;
        updateSettingsEditionFieldLabel();
    } else {
        ayaEditionChoice = slug;
        updateAyaEditionFieldLabel();
        if (ayaEditionChoice) {
            tafsirState.edition = ayaEditionChoice;
            localStorage[tafsirEditionStorageKey()] = tafsirState.edition;
            updateSettingsEditionFieldLabel();
            loadTafsirForShown();
        } else {
            document.getElementById("aya-tafsir-section").hidden = true;
        }
    }

    openPanel(editionPickerReturnPanel());
}

export function populateTafsirServerSelect() {
    const servers = allTafsirServers();
    const sel = document.getElementById("tafsir-server-select");
    sel.innerHTML = "";
    for (const key of Object.keys(servers)) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = servers[key].name;
        sel.appendChild(opt);
    }
    sel.value = tafsirState.server;
    document.getElementById("tafsir-remove-server-group").hidden = !servers[tafsirState.server]?.custom;
}

// ---------- wiring ----------

export function bindTafsirUI() {
    document.getElementById("tafsir-server-select").addEventListener("change", e => {
        tafsirState.server = e.target.value;
        localStorage[tafsirServerStorageKey()] = tafsirState.server;
        document.getElementById("tafsir-remove-server-group").hidden =
            !allTafsirServers()[tafsirState.server]?.custom;
        loadTafsirForShown();
    });

    // Both edition "fields" are buttons that open the shared, categorized
    // picker panel rather than a native <select> dropdown.
    document.getElementById("tafsir-edition-select").addEventListener("click", () => openEditionPicker("settings"));
    document.getElementById("aya-tafsir-edition").addEventListener("click", () => openEditionPicker("aya"));

    document.getElementById("btn-edition-picker-back").addEventListener("click", () => {
        openPanel(editionPickerReturnPanel());
    });

    document.getElementById("edition-filter").addEventListener("input", e => {
        renderEditionPickerList(e.target.value);
    });

    const tafsirAddServerForm  = document.getElementById("tafsir-add-server-form");
    const tafsirServerNameInput = document.getElementById("tafsir-server-name");
    const tafsirServerUrlInput  = document.getElementById("tafsir-server-url");

    document.getElementById("btn-tafsir-add-server").addEventListener("click", () => {
        tafsirAddServerForm.hidden = !tafsirAddServerForm.hidden;
        if (!tafsirAddServerForm.hidden) tafsirServerUrlInput.focus();
    });

    function closeTafsirAddServerForm() {
        tafsirAddServerForm.hidden = true;
        tafsirServerNameInput.value = "";
        tafsirServerUrlInput.value = "";
    }

    document.getElementById("btn-tafsir-server-cancel").addEventListener("click", closeTafsirAddServerForm);

    document.getElementById("btn-tafsir-server-save").addEventListener("click", () => {
        const url = tafsirServerUrlInput.value.trim().replace(/\/+$/, "");
        if (!/^https?:\/\/.+/i.test(url)) {
            tafsirServerUrlInput.focus();
            return;
        }

        let hostname = url;
        try { hostname = new URL(url).hostname; } catch (e) {}
        const name = tafsirServerNameInput.value.trim() || hostname;

        const list = loadCustomTafsirServers();
        const id = `custom:${url}`;
        if (!list.some(s => s.id === id)) {
            list.push({ id, name, base: url });
            saveCustomTafsirServers(list);
        }

        tafsirState.server = id;
        localStorage[tafsirServerStorageKey()] = tafsirState.server;
        populateTafsirServerSelect();
        closeTafsirAddServerForm();
        loadTafsirForShown();
    });

    document.getElementById("btn-tafsir-remove-server").addEventListener("click", () => {
        const list = loadCustomTafsirServers().filter(s => s.id !== tafsirState.server);
        saveCustomTafsirServers(list);
        tafsirState.server = Object.keys(TAFSIR_SERVERS)[0];
        localStorage[tafsirServerStorageKey()] = tafsirState.server;
        populateTafsirServerSelect();
        loadTafsirForShown();
    });

    document.getElementById("btn-tafsir-settings").addEventListener("click", () => openPanel("panel-tafsir"));
}
