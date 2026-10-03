// Wraps an s2v-generated (svg2vectordrawable) foreground-only vector
// drawable -- just the icon's own <path>/<group> content, no background
// -- with an opaque black background rect, producing one self-contained
// <vector> usable directly as res/mipmap-anydpi-v21/ic_launcher.xml.
//
// Pre-Android-8 (API < 26) devices don't understand <adaptive-icon>'s
// separate background/foreground layers (see
// res/mipmap-anydpi-v26/ic_launcher.xml for those), so they need one
// flat vector with the background baked in instead; this is the only
// reason this file exists rather than just reusing
// ic_launcher_foreground.xml directly for both.
//
// Usage: node gen-legacy-icon.js <foreground.xml> <output.xml> [#rrggbb background]
const fs = require("fs");

const [, , inPath, outPath, bgColor = "#000000"] = process.argv;
if (!inPath || !outPath) {
    console.error("Usage: node gen-legacy-icon.js <foreground.xml> <output.xml> [#rrggbb background]");
    process.exit(1);
}

const xml = fs.readFileSync(inPath, "utf8");

const w = xml.match(/android:viewportWidth="([\d.]+)"/)?.[1];
const h = xml.match(/android:viewportHeight="([\d.]+)"/)?.[1];
if (!w || !h) {
    throw new Error(`Could not read android:viewportWidth/Height from ${inPath}`);
}

// Everything from the end of the opening <vector ...> tag onward is the
// icon's own content (paths/groups); reused as-is inside the wrapper.
const openTagEnd = xml.indexOf(">", xml.indexOf("<vector")) + 1;
const openTag = xml.slice(xml.indexOf("<vector"), openTagEnd);

// The converter declares extra namespaces on the root tag when the art uses
// them -- notably xmlns:aapt for gradient fills (<aapt:attr>). The wrapper
// below is a new root, so every declaration has to be carried over or the
// reused content references an unbound prefix and aapt2 rejects the file.
const namespaces = [...openTag.matchAll(/xmlns:(\w+)="([^"]*)"/g)]
    .filter(([, prefix]) => prefix !== "android")
    .map(([, prefix, uri]) => `\n    xmlns:${prefix}="${uri}"`)
    .join("");
const innerContent = xml.slice(openTagEnd, xml.lastIndexOf("</vector>"));

const background =
    `    <path android:fillColor="${bgColor}" ` +
    `android:pathData="M0,0h${w}v${h}h-${w}z"/>\n`;

if (!/<(path|group)\b/.test(innerContent)) {
    throw new Error(`${inPath} contains no <path>/<group> content (blank icon)`);
}

const out =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"${namespaces}\n` +
    `    android:width="${w}dp" android:height="${h}dp"\n` +
    `    android:viewportWidth="${w}" android:viewportHeight="${h}">\n` +
    background +
    innerContent +
    `</vector>\n`;

fs.writeFileSync(outPath, out);
