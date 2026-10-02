import { storage } from "./native-bridge.js";
import { toArabicDigits } from "./text-utils.js";

// ---------- dictionaries ----------
//
// Flat, dot-namespaced keys rather than nested objects -- keeps t() a
// one-line lookup and makes "is this key translated in both languages"
// a trivial visual diff between the two objects below.
//
// IMPORTANT: every key here -- both the dynamic JS strings and the
// "STATIC HTML TEXT" section -- has been verified against the app's
// actual source (index.html included), so these are exact matches for
// what was already shown, not translations-by-guess. If index.html
// changes later, keep this file's `ar` values and index.html's
// data-i18n-tagged elements in sync with each other by hand.
export const STRINGS = {
    ar: {
        // ---- app.js ----
        "app.loading":        "تحميل...",
        "app.buildingIndex":  "تجهيز الفهرس...",

        // ---- audio.js ----
        "audio.nowPlaying.idle": "لم يبدأ التشغيل",
        "audio.action.pause":    "إيقاف مؤقت",
        "audio.action.play":     "تشغيل",

        // reciter names, shared by both audio servers' reader lists
        "reciter.ajamy":              "أحمد بن علي العجمي",
        "reciter.alafasy":            "مشاري راشد العفاسي",
        "reciter.abdulbasitmurattal": "عبد الباسط عبد الصمد (مرتل)",
        "reciter.abdurrahmaansudais": "عبد الرحمن السديس",
        "reciter.husary":             "محمود خليل الحصري",
        "reciter.minshawi":           "محمد صديق المنشاوي",
        "reciter.hudhaify":           "علي بن عبد الرحمن الحذيفي",
        "reciter.shaatree":           "أبو بكر الشاطري",
        "reciter.mahermuaiqly":       "ماهر المعيقلي",

        // ---- tafsir.js ----
        "tafsir.error.noServer":     "لم يتم اختيار خادم للتفسير.",
        "tafsir.error.fetchFailed":  "تعذر جلب التفسير ({status}).",
        "tafsir.error.network":     "تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.",
        "tafsir.ayaOnly":            "الآية فقط",
        "tafsir.chooseEdition":      "اختر إصدارًا",
        "tafsir.loading":            "جارٍ التحميل...",
        "tafsir.error.consentDenied": "لم تتم الموافقة على الاتصال بالخادم، لذا تعذر عرض التفسير.",
        "tafsir.empty":              "لا يوجد تفسير لهذه الآية في هذا الإصدار.",
        "tafsir.editionsLoading":    "جارٍ تحميل قائمة الإصدارات...",
        "tafsir.editionsFailed":     "تعذر تحميل قائمة الإصدارات.",
        "tafsir.recentlyUsed":       "المستخدم مؤخرًا",
        "tafsir.noResults":          "لا توجد نتائج.",

        // ---- consent.js ----
        "consent.message.audio":  "لتشغيل الصوت، يحتاج التطبيق إلى الاتصال بالخادم التالي. هل توافق على ذلك؟",
        "consent.message.tafsir": "لعرض التفسير/الترجمة، يحتاج التطبيق إلى الاتصال بالخادم التالي. هل توافق على ذلك؟",

        // ---- navigation.js ----
        "navigation.noResults":               "لا توجد نتائج",
        "navigation.searchResultsTruncated":  "أول {shown} من {total} نتيجة",
        "navigation.searchResultsCount":      "{count} نتيجة",
        "navigation.ayaCount":                "{count} آية",

        // ============ STATIC HTML TEXT ============
        // Verified against the real index.html -- these are the exact
        // Arabic strings already in the markup, now also reachable via
        // data-i18n (see applyTranslations() below) rather than only
        // living in the HTML.
        "app.title":       "القرآن الكريم",
        "nav.prevPage":    "الصفحة السابقة",
        "nav.nextPage":    "الصفحة التالية",
        "menu.title":      "القائمة",
        "consent.title":   "الاتصال بخادم خارجي",
        "consent.no":      "لا",
        "consent.yes":     "نعم",
        "consent.remember": "نعم، وتذكر",
        "common.close":    "إغلاق",
        "common.back":     "رجوع",
        "common.cancel":   "إلغاء",
        "common.add":      "إضافة",
        "menu.suras":      "الفهرس",
        "menu.page":       "الانتقال إلى صفحة",
        "menu.search":     "بحث",
        "menu.audio":      "الاستماع",
        "audio.stop":      "إيقاف",
        "menu.tafsir":     "التفسير والترجمة",
        "menu.settings":   "الإعدادات",
        "suras.filterPlaceholder": "ابحث عن سورة…",
        "suras.ariaLabel":         "السور",
        "page.label":      "رقم الصفحة (١ - ٦٠٤)",
        "page.ariaLabel":  "اذهب إلى صفحة",
        "page.go":         "اذهب",
        "search.placeholder": "ابحث في القرآن…",
        "settings.theme":  "المظهر",
        "theme.black":     "أسود",
        "theme.white":     "أبيض",
        "theme.yellow":    "أصفر",
        "settings.font":   "الخط",
        "settings.hideDiacritics": "إخفاء التشكيل",
        "settings.server": "الخادم",
        "audio.reader":    "القارئ",
        "audio.autoAdvance": "الانتقال التلقائي للآية التالية",
        "aya.prev":        "الآية السابقة",
        "aya.next":        "الآية التالية",
        "tafsir.addServer":         "إضافة خادم مخصص",
        "tafsir.serverNameLabel":   "اسم الخادم (اختياري)",
        "tafsir.serverNamePlaceholder": "مثال: خادمي الخاص",
        "tafsir.serverUrlLabel":    "رابط الخادم",
        "tafsir.customServerNote": "هذا خادم مخصص",
        "tafsir.removeServer":     "حذف الخادم",
        "tafsir.editionLabel":     "الإصدار (تفسير / ترجمة)",
        "tafsir.hint": "سيُطلب منك تأكيد الاتصال بالخادم قبل أول طلب لعرض التفسير.",
        "tafsir.editionFilterPlaceholder": "ابحث عن تفسير أو لغة…",
        "tafsir.editionsAriaLabel":        "الإصدارات",
        "tafsir.settingsButton":   "إعدادات التفسير",
        "aya.playFromHere": "تشغيل من هنا",
        "settings.language": "اللغة",
        "language.system":   "لغة النظام",
        "language.ar":       "العربية",
        "language.en":       "English",
        "menu.searchPlaceholder": "ابحث في القرآن أو عن سورة أو صفحة…",
        "navigation.gotoPage":    "الانتقال إلى الصفحة {page}",
        "audio.playFromPage":     "استمع من هذه الصفحة",
        "audio.settings":         "إعدادات الصوت",
        "audio.mini.jump":        "الانتقال إلى الآية الجارية",
        "menu.pageSlider":        "الصفحة",
    },

    en: {
        // ---- app.js ----
        "app.loading":        "Loading...",
        "app.buildingIndex":  "Preparing index...",

        // ---- audio.js ----
        "audio.nowPlaying.idle": "Nothing playing",
        "audio.action.pause":    "Pause",
        "audio.action.play":     "Play",

        "reciter.ajamy":              "Ahmed ibn Ali al-Ajamy",
        "reciter.alafasy":            "Mishary Rashid al-Afasy",
        "reciter.abdulbasitmurattal": "Abdul Basit Abdus Samad (Murattal)",
        "reciter.abdurrahmaansudais": "Abdur-Rahman As-Sudais",
        "reciter.husary":             "Mahmoud Khalil Al-Husary",
        "reciter.minshawi":           "Mohamed Siddiq Al-Minshawi",
        "reciter.hudhaify":           "Ali Al-Hudhaify",
        "reciter.shaatree":           "Abu Bakr Al-Shaatree",
        "reciter.mahermuaiqly":       "Maher Al Muaiqly",

        // ---- tafsir.js ----
        "tafsir.error.noServer":     "No tafsir server selected.",
        "tafsir.error.fetchFailed":  "Couldn't fetch the tafsir ({status}).",
        "tafsir.error.network":     "Couldn't reach the server. Check your internet connection.",
        "tafsir.ayaOnly":            "Aya only",
        "tafsir.chooseEdition":      "Choose an edition",
        "tafsir.loading":            "Loading...",
        "tafsir.error.consentDenied": "The server connection wasn't approved, so the tafsir couldn't be shown.",
        "tafsir.empty":              "No tafsir for this aya in this edition.",
        "tafsir.editionsLoading":    "Loading the edition list...",
        "tafsir.editionsFailed":     "Couldn't load the edition list.",
        "tafsir.recentlyUsed":       "Recently used",
        "tafsir.noResults":          "No results.",

        // ---- consent.js ----
        "consent.message.audio":  "To play audio, the app needs to connect to the following server. Do you agree?",
        "consent.message.tafsir": "To show the tafsir/translation, the app needs to connect to the following server. Do you agree?",

        // ---- navigation.js ----
        "navigation.noResults":               "No results",
        "navigation.searchResultsTruncated":  "First {shown} of {total} results",
        "navigation.searchResultsCount":      "{count} results",
        "navigation.ayaCount":                "{count} verses",

        // ============ STATIC HTML TEXT ============
        "app.title":       "The Noble Quran",
        "nav.prevPage":    "Previous page",
        "nav.nextPage":    "Next page",
        "menu.title":      "Menu",
        "consent.title":   "External server connection",
        "consent.no":      "No",
        "consent.yes":     "Yes",
        "consent.remember": "Yes, and remember",
        "common.close":    "Close",
        "common.back":     "Back",
        "common.cancel":   "Cancel",
        "common.add":      "Add",
        "menu.suras":      "Index",
        "menu.page":       "Go to page",
        "menu.search":     "Search",
        "menu.audio":      "Listen",
        "audio.stop":      "Stop",
        "menu.tafsir":     "Tafsir & Translation",
        "menu.settings":   "Settings",
        "suras.filterPlaceholder": "Search for a sura…",
        "suras.ariaLabel":         "Suras",
        "page.label":      "Page number (1 - 604)",
        "page.ariaLabel":  "Go to page",
        "page.go":         "Go",
        "search.placeholder": "Search the Quran…",
        "settings.theme":  "Theme",
        "theme.black":     "Black",
        "theme.white":     "White",
        "theme.yellow":    "Yellow",
        "settings.font":   "Font",
        "settings.hideDiacritics": "Hide diacritics",
        "settings.server": "Server",
        "audio.reader":    "Reciter",
        "audio.autoAdvance": "Automatically advance to the next aya",
        "aya.prev":        "Previous aya",
        "aya.next":        "Next aya",
        "tafsir.addServer":         "Add a custom server",
        "tafsir.serverNameLabel":   "Server name (optional)",
        "tafsir.serverNamePlaceholder": "e.g. My private server",
        "tafsir.serverUrlLabel":    "Server URL",
        "tafsir.customServerNote": "This is a custom server",
        "tafsir.removeServer":     "Remove server",
        "tafsir.editionLabel":     "Edition (tafsir / translation)",
        "tafsir.hint": "You'll be asked to confirm the server connection before the first tafsir request.",
        "tafsir.editionFilterPlaceholder": "Search for a tafsir or language…",
        "tafsir.editionsAriaLabel":        "Editions",
        "tafsir.settingsButton":   "Tafsir settings",
        "aya.playFromHere": "Play from here",
        "settings.language": "Language",
        "language.system":   "System language",
        "language.ar":       "العربية",
        "language.en":       "English",
        "menu.searchPlaceholder": "Search the Quran, a sura, or a page…",
        "navigation.gotoPage":    "Go to page {page}",
        "audio.playFromPage":     "Listen from this page",
        "audio.settings":         "Audio settings",
        "audio.mini.jump":        "Go to the playing aya",
        "menu.pageSlider":        "Page",
    },
};

const SUPPORTED_LANGS = ["ar", "en"];
const LANG_STORAGE_KEY = "quran-lang";

// "system" is stored as-is (meaning "keep following the device"), rather
// than resolved once and forgotten, so a later OS-level language change
// keeps being picked up on the next launch instead of sticking to
// whatever happened to be detected the first time.
function systemLanguage() {
    const raw = (navigator.language || navigator.languages?.[0] || "en").toLowerCase();
    return raw.startsWith("ar") ? "ar" : "en";
}

function resolveLanguage(pref) {
    return SUPPORTED_LANGS.includes(pref) ? pref : systemLanguage();
}

let currentLang = resolveLanguage(storage.getItem(LANG_STORAGE_KEY) || "system");

export function getLanguage() {
    return currentLang;
}

// "system" is a valid value here too (see systemLanguage() above) --
// pass it to go back to following the device's own language.
export function getLanguagePreference() {
    return storage.getItem(LANG_STORAGE_KEY) || "system";
}

// Persists the choice and reloads the page. A live, in-place re-layout
// would also need to be correct for: text direction (menus/labels are
// authored RTL-first; the Quran reading area itself stays RTL regardless
// of UI language and is unaffected either way), ViewPager's swipe
// direction, and every already-rendered dynamic label -- a reload is far
// more likely to be *actually* correct than trying to patch all of that
// live, at the cost of one page load, which only happens right after the
// user deliberately changes this setting.
export function setLanguage(pref) {
    storage.setItem(LANG_STORAGE_KEY, pref);
    location.reload();
}

// Call once at startup, before anything reads document direction (e.g.
// before ViewPager is constructed) -- note this only ever affects the
// *chrome* (menus, panels, labels); the Quran reading area keeps its own
// fixed dir="rtl" regardless of UI language, same as before this existed.
export function applyDocumentLanguage() {
    document.documentElement.lang = currentLang;
    const dir = currentLang === "ar" ? "rtl" : "ltr";
    document.documentElement.dir = dir;

    // Setting <html>'s dir alone doesn't reach panel/menu text: this
    // app's chrome was authored back when it was Arabic-only, with an
    // explicit `direction: rtl` in style.css on the overlay panels/menu
    // rather than relying on inherited direction -- an author stylesheet
    // rule like that beats the UA's own `[dir]`-attribute default, so
    // toggling the *attribute* alone has no visual effect. Setting it
    // inline here wins over any non-!important stylesheet rule, which is
    // what actually flips it. Elements that must stay RTL regardless of
    // UI language (Quran text, the aya panel's own title -- see
    // index.html's dir="rtl" on #aya-title/#aya-text) still win over
    // this, since an element's own explicit dir/style always beats
    // whatever its ancestor panel is set to here.
    for (const el of document.querySelectorAll(
            ".overlay-panel, #panel-consent, #btn-menu, #overlay-backdrop")) {
        el.dir = dir;
        el.style.direction = dir;
    }

    // The "back" chevron (icons.js's "chevron-back") is drawn pointing
    // right, matching "back" in RTL/Arabic reading; in LTR/English,
    // "back" reads as pointing left, so every .icon-back button needs
    // mirroring specifically when the UI is LTR. Scoped to .icon-back
    // only -- .nav-prev/.nav-next (the page-turn arrows) reuse the same
    // base icon but have their own separate mirroring in style.css for
    // page-turn direction, which has nothing to do with UI language and
    // must not be touched here.
    for (const el of document.querySelectorAll(".icon-back")) {
        el.style.transform = dir === "ltr" ? "scaleX(-1)" : "";
    }
}

// t("tafsir.error.fetchFailed", { status: 404 }) -> "Couldn't fetch the
// tafsir (404)." Falls back to English, then to the raw key itself, so a
// missing translation degrades to *something* visible rather than
// throwing or rendering blank.
export function t(key, vars) {
    const dict = STRINGS[currentLang] || STRINGS.en;
    let str = dict[key] ?? STRINGS.en[key] ?? key;
    if (vars) {
        for (const k of Object.keys(vars)) {
            str = str.replaceAll(`{${k}}`, vars[k]);
        }
    }
    return str;
}

// Renders a number using the UI language's own convention -- Arabic-Indic
// digits for Arabic, plain Latin digits otherwise. Deliberately separate
// from however page/aya numbers elsewhere in the app are rendered (see
// text-utils.js's toArabicDigits, used directly and unconditionally for
// those): those are part of the Quran-reading experience itself and stay
// Arabic-Indic regardless of UI language, same as the Quran text is
// always Arabic regardless of it; this is only for numbers embedded in
// *translated UI strings* (e.g. a search-results count).
export function localizeNumber(n) {
    return currentLang === "ar" ? toArabicDigits(n) : String(n);
}

// Applies data-i18n[-attr]="key" markup anywhere under `root`:
//   <span data-i18n="menu.suras">...</span>            -- textContent
//   <input data-i18n-placeholder="search.placeholder">  -- placeholder
//   <button data-i18n-aria-label="menu.close">          -- aria-label
//   <button data-i18n-title="menu.close">               -- title
// Safe to call more than once (e.g. after injecting new panel markup, or
// never at all if index.html hasn't been annotated with these yet -- it
// simply finds nothing to do).
export function applyTranslations(root = document) {
    for (const el of root.querySelectorAll("[data-i18n]")) {
        el.textContent = t(el.dataset.i18n);
    }
    for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    }
    for (const el of root.querySelectorAll("[data-i18n-aria-label]")) {
        el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
    }
    for (const el of root.querySelectorAll("[data-i18n-title]")) {
        el.title = t(el.dataset.i18nTitle);
    }
}
