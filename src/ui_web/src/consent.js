import { storage } from "./native-bridge.js";
import { pushOverlayState, popOverlayState } from "./panels.js";
import { t } from "./strings.js";
const PANEL_TRANSITION_MS = 180; // must match .overlay-panel's transition duration in style.css

// Granted-for-this-session decisions (cleared on reload); persisted
// ("remember") decisions live in storage instead (SharedPreferences on
// Android, localStorage on the web). Keyed by "<kind>:<id>" so audio and
// tafsir servers never collide even if they happened to share an id string.
const sessionServerConsent = new Set();

function consentStorageKey(kind, id) {
    return `quran-consent-${kind}-${id}`;
}

let consentBackdrop, consentPanel, consentMessageEl, consentServerEl, consentUrlEl;
let consentResolve = null;

function consentMessageFor(kind) {
    return kind === "audio" ? t("consent.message.audio") : t("consent.message.tafsir");
}

// Shows the consent dialog and resolves with "yes" | "remember" | "no".
// Deliberately independent of panels.js's openPanel()/closeAllPanels(): it
// must be able to float above whatever overlay panel (audio, aya,
// tafsir...) is already open, rather than closing it. It still pushes
// its own history snapshot via panels.js's shared push/pop helpers,
// though, so a hardware/browser back press dismisses this before doing
// anything else, same as a panel -- see panels.js's back-button section
// for the full design.
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

        pushOverlayState();
    });
}

function hideConsentDialog(choice) {
    consentBackdrop.classList.remove("open");
    consentPanel.classList.remove("open");
    setTimeout(() => {
        consentBackdrop.hidden = true;
        consentPanel.hidden = true;
    }, PANEL_TRANSITION_MS);
    popOverlayState();
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

// Based on the pending promise rather than the panel's [hidden] flag: the
// panel stays un-hidden for the length of its close fade, which would make
// a dialog that was just answered look still open to history snapshots.
export function isConsentDialogOpen() {
    return consentResolve !== null;
}

export function dismissConsentDialog() {
    hideConsentDialog("no");
}

// Checks (and if needed, asks for) permission to contact a given
// external server. Resolves instantly if already granted this session or
// remembered from a previous one.
export async function ensureServerConsent(kind, id, label, url) {
    if (storage.getItem(consentStorageKey(kind, id)) === "granted") return true;

    const sessionKey = `${kind}:${id}`;
    if (sessionServerConsent.has(sessionKey)) return true;

    const choice = await showConsentDialog(kind, label, url);
    if (choice === "remember") {
        storage.setItem(consentStorageKey(kind, id), "granted");
        sessionServerConsent.add(sessionKey);
        return true;
    }
    if (choice === "yes") {
        sessionServerConsent.add(sessionKey);
        return true;
    }
    return false;
}
