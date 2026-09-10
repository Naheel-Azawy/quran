const PANEL_TRANSITION_MS = 180; // must match .overlay-panel's transition duration in style.css

// Granted-for-this-session decisions (cleared on reload); persisted
// ("remember") decisions live in localStorage instead. Keyed by
// "<kind>:<id>" so audio and tafsir servers never collide even if they
// happened to share an id string.
const sessionServerConsent = new Set();

function consentStorageKey(kind, id) {
    return `quran-consent-${kind}-${id}`;
}

let consentBackdrop, consentPanel, consentMessageEl, consentServerEl, consentUrlEl;
let consentResolve = null;

function consentMessageFor(kind) {
    return kind === "audio"
        ? "لتشغيل الصوت، يحتاج التطبيق إلى الاتصال بالخادم التالي. هل توافق على ذلك؟"
        : "لعرض التفسير/الترجمة، يحتاج التطبيق إلى الاتصال بالخادم التالي. هل توافق على ذلك؟";
}

// Shows the consent dialog and resolves with "yes" | "remember" | "no".
// Deliberately independent of panels.js's openPanel()/closeAllPanels(): it
// must be able to float above whatever overlay panel (audio, aya,
// tafsir...) is already open, rather than closing it.
function showConsentDialog(kind, label, url) {
    return new Promise(resolve => {
        consentResolve = resolve;
        consentMessageEl.textContent = consentMessageFor(kind);
        consentServerEl.textContent  = label;
        consentUrlEl.textContent     = url;

        consentBackdrop.hidden = false;
        consentPanel.hidden = false;
        void consentPanel.offsetWidth;
        requestAnimationFrame(() => {
            consentBackdrop.classList.add("open");
            consentPanel.classList.add("open");
        });
        document.getElementById("consent-btn-no").focus();
    });
}

function hideConsentDialog(choice) {
    consentBackdrop.classList.remove("open");
    consentPanel.classList.remove("open");
    setTimeout(() => {
        consentBackdrop.hidden = true;
        consentPanel.hidden = true;
    }, PANEL_TRANSITION_MS);
    const resolve = consentResolve;
    consentResolve = null;
    resolve?.(choice);
}

export function initConsentDialog() {
    consentBackdrop  = document.getElementById("consent-backdrop");
    consentPanel     = document.getElementById("panel-consent");
    consentMessageEl = document.getElementById("consent-message");
    consentServerEl  = document.getElementById("consent-server-name");
    consentUrlEl     = document.getElementById("consent-url");

    document.getElementById("consent-btn-no").addEventListener("click", () => hideConsentDialog("no"));
    document.getElementById("consent-btn-yes").addEventListener("click", () => hideConsentDialog("yes"));
    document.getElementById("consent-btn-remember").addEventListener("click", () => hideConsentDialog("remember"));
    consentBackdrop.addEventListener("click", () => hideConsentDialog("no"));
}

export function isConsentDialogOpen() {
    return !!consentPanel && !consentPanel.hidden;
}

export function dismissConsentDialog() {
    hideConsentDialog("no");
}

// Checks (and if needed, asks for) permission to contact a given
// external server. Resolves instantly if already granted this session or
// remembered from a previous one.
export async function ensureServerConsent(kind, id, label, url) {
    if (localStorage[consentStorageKey(kind, id)] === "granted") return true;

    const sessionKey = `${kind}:${id}`;
    if (sessionServerConsent.has(sessionKey)) return true;

    const choice = await showConsentDialog(kind, label, url);
    if (choice === "remember") {
        localStorage[consentStorageKey(kind, id)] = "granted";
        sessionServerConsent.add(sessionKey);
        return true;
    }
    if (choice === "yes") {
        sessionServerConsent.add(sessionKey);
        return true;
    }
    return false;
}
