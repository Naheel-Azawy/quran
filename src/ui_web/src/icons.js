// All the small chrome icons (nav arrows, close buttons, menu glyphs,
// audio transport, etc.) live here instead of as inline <svg> in
// index.html. Each entry is looked up by the data-icon attribute of the
// element it belongs to and injected as innerHTML by injectIcons().
//
// A couple of icons need more than one visual state in the same button
// (e.g. play/pause): those entries simply contain two sibling <svg>s,
// distinguished by class, and the existing CSS (.icon-play/.icon-pause)
// takes care of showing only the right one.

export const ICONS = {
    // chevron pointing "back" (mirrored via CSS where it needs to point
    // forward, see .nav-prev svg in style.css)
    "chevron-back": `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <polyline points="15,5 8,12 15,19" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    "chevron-down": `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <polyline points="7,9 12,14 17,9" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    close: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    dots: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="5"  cy="12" r="2" fill="currentColor"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
        <circle cx="19" cy="12" r="2" fill="currentColor"/>
    </svg>`,

    plus: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    "menu-index": `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <line x1="4" y1="6"  x2="20" y2="6"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="4" y1="18" x2="14" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    "menu-page": `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="9" y1="8"  x2="15" y2="8"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="16" x2="12" y2="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,

    "menu-search": `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    "menu-audio": `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M4 15v-3a8 8 0 0 1 16 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <rect x="2" y="14" width="5" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>
        <rect x="17" y="14" width="5" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    "menu-tafsir": `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M4 5.5c2.2-1 5-1 7 .3v13.7c-2-1.3-4.8-1.3-7-.3V5.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M20 5.5c-2.2-1-5-1-7 .3v13.7c2-1.3 4.8-1.3 7-.3V5.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`,

    // used both at 20px (menu) and 18px (aya panel) -- see "settings-sm"
    settings: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <line x1="4" y1="7"  x2="20" y2="7"  stroke="currentColor" stroke-width="2"/>
        <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2"/>
        <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" stroke-width="2"/>
        <circle cx="8"  cy="7"  r="2" fill="var(--bg)" stroke="currentColor" stroke-width="2"/>
        <circle cx="16" cy="12" r="2" fill="var(--bg)" stroke="currentColor" stroke-width="2"/>
        <circle cx="10" cy="17" r="2" fill="var(--bg)" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    "settings-sm": `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <line x1="4" y1="7"  x2="20" y2="7"  stroke="currentColor" stroke-width="2"/>
        <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2"/>
        <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" stroke-width="2"/>
        <circle cx="8"  cy="7"  r="2" fill="var(--bg)" stroke="currentColor" stroke-width="2"/>
        <circle cx="16" cy="12" r="2" fill="var(--bg)" stroke="currentColor" stroke-width="2"/>
        <circle cx="10" cy="17" r="2" fill="var(--bg)" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    "stop-sm": `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" fill="currentColor"/>
    </svg>`,

    stop: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" fill="currentColor"/>
    </svg>`,

    "play-sm": `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <polygon points="6,4 20,12 6,20" fill="currentColor"/>
    </svg>`,

    "play-pause-sm": `<svg class="icon-play" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <polygon points="6,4 20,12 6,20" fill="currentColor"/>
    </svg>
    <svg class="icon-pause" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="5" y="4" width="5" height="16" fill="currentColor"/>
        <rect x="14" y="4" width="5" height="16" fill="currentColor"/>
    </svg>`,

    "play-pause-lg": `<svg class="icon-play" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <polygon points="6,4 20,12 6,20" fill="currentColor"/>
    </svg>
    <svg class="icon-pause" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="5" y="4" width="5" height="16" fill="currentColor"/>
        <rect x="14" y="4" width="5" height="16" fill="currentColor"/>
    </svg>`,

    "audio-prev": `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <polyline points="17,5 9,12 17,19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="6" y1="5" x2="6" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    "audio-next": `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <polyline points="7,5 15,12 7,19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="18" y1="5" x2="18" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
};

// Fills every element carrying a data-icon attribute with its markup.
// Safe to call more than once (e.g. after injecting new panel markup),
// and silently skips unknown names instead of throwing.
export function injectIcons(root = document) {
    for (const el of root.querySelectorAll("[data-icon]")) {
        const svg = ICONS[el.dataset.icon];
        if (svg) el.innerHTML = svg;
    }
}
