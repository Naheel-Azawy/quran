export function parseHeaderLine(line) {
    return line.split(/  +/).map(s => s.trim()).filter(Boolean);
}

// Reads "سورة <name> <num>" whether it comes from the top-of-page header
// or a mid-page "--{ ... }--" marker; both use this exact shape.
export function parseSuraLabel(text) {
    const m = text.trim().match(/سورة\s+(.+) (\d+)$/);
    return { name: m[1], sura: Number(m[2]) - 1 };
}

export function toArabicDigits(str) {
    return [...String(str)]
        .map(d => String.fromCharCode(d.charCodeAt(0) + 0x0660 - 0x0030))
        .join("");
}

export function escapeHtml(s) {
    return String(s).replace(/&(?!nbsp;)/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
}

// Anything fetched and inlined into page markup has to survive render(),
// which splits the body on newlines and appends a <br> to every line. A
// <br> inside SVG is foreign content the HTML parser cannot accept, so it
// breaks out and closes the <svg> early, spilling the rest of the artwork
// into the page as text. Flattening to a single line avoids that entirely.
// Comments and <metadata> go too: the former are pure documentation, the
// latter is provenance data some tools inject into .svg files, and
// neither renders.
export function inlineSvg(text) {
    return text
        .replace(/<\?xml[\s\S]*?\?>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, "")
        .replace(/\s+xmlns:c2pa="[^"]*"/g, "")
        .replace(/\s*\n\s*/g, " ")
        .trim();
}
