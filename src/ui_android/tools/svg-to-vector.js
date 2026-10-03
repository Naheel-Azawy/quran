// SVG -> Android VectorDrawable, used by the Makefile's vector-icon path.
//
// Why this exists instead of calling the `s2v` command line tool: the CLI
// converts the SVG exactly as written, whereas svg2vectordrawable's
// library entry point first runs svgo over it. Without that step <circle>
// and <ellipse> elements are silently *dropped* (they have no equivalent
// VectorDrawable element and only svgo's convertShapeToPath turns them into
// paths), so an icon built from them came out incomplete or blank, and
// the build still reported success. An extra svgo pass resolves <style>
// blocks / class="..." fills into plain attributes, which the converter
// also ignores otherwise.
//
// Fails the build (non-zero exit) when the result contains no <path> at
// all, and warns about SVG features the VectorDrawable format cannot
// express, instead of quietly shipping a wrong icon.
//
// Usage: node svg-to-vector.js <input.svg> <output.xml>
// Resolves svg2vectordrawable and svgo through NODE_PATH (the Makefile
// installs them under build/android/s2v/node_modules).
const fs = require("fs");
const path = require("path");
const { optimize } = require("svgo");
const svg2vectordrawable = require("svg2vectordrawable");

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
    console.error("Usage: node svg-to-vector.js <input.svg> <output.xml>");
    process.exit(1);
}

// Constructs the converter cannot represent. Matched on the *source* SVG so
// the warning appears even if svgo later removes the element.
const UNSUPPORTED = [
    [/<clipPath\b|\bclip-path=/,  "clip paths (the clipping is dropped, the art is drawn unclipped)"],
    [/<mask\b/,                   "masks"],
    [/<filter\b|\bfilter=/,       "filters (blur, shadows...)"],
    [/<image\b/,                  "embedded images"],
    [/<text\b/,                   "text (convert it to outlines first)"],
    [/<pattern\b/,                "patterns"],
];

(async () => {
    const source = fs.readFileSync(inPath, "utf8");

    for (const [re, what] of UNSUPPORTED) {
        if (re.test(source)) console.warn(`warning: ${path.basename(inPath)} uses ${what}; VectorDrawable cannot represent this.`);
    }

    const prepared = optimize(source, {
        plugins: [
            "mergeStyles",
            { name: "inlineStyles", params: { onlyMatchedOnce: false } },
            "convertStyleToAttrs",
        ],
    }).data;

    const xml = await svg2vectordrawable(prepared, { floatPrecision: 2, xmlTag: true });

    if (!/<path\b/.test(xml)) {
        throw new Error(`conversion of ${inPath} produced a vector with no <path> elements (blank icon)`);
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, xml);
    console.log(`${inPath} -> ${outPath} (${(xml.match(/<path\b/g) || []).length} paths)`);
})().catch(e => {
    console.error("svg-to-vector failed:", e.message || e);
    process.exit(1);
});
