const fs                = require("fs");
const path              = require("path");
const webpack           = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const child_process     = require('child_process');

// The Makefile's VERSION is the single source of truth. `make web` passes
// it in as QURAN_VERSION; when webpack is run by hand (npm run build /
// watch) it is read straight out of the Makefile instead, so both paths
// always agree. (package.json's own "version" is kept in sync below.)
function readMakefileVersion() {
    const makefile = fs.readFileSync(path.resolve(__dirname, "../../Makefile"), "utf8");
    const m = /^VERSION\s*[:?]?=\s*(\S+)/m.exec(makefile);
    if (!m) throw new Error("VERSION not found in the top-level Makefile");
    return m[1];
}

const BASE_VERSION = process.env.QURAN_VERSION || readMakefileVersion();

// Rewrites package.json's "version" when it differs from the Makefile's.
// The file's mtime is set back to node_modules' afterwards: the Makefile
// treats package.json as the input of `npm ci`, so a version-only edit
// must not look like a dependency change and force a reinstall.
function syncPackageVersion(version) {
    const file = path.resolve(__dirname, "package.json");
    const pkg  = JSON.parse(fs.readFileSync(file, "utf8"));
    if (pkg.version === version) return;
    pkg.version = version;
    const nm = path.resolve(__dirname, "node_modules");
    const st = fs.existsSync(nm) ? fs.statSync(nm) : null;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    if (st) fs.utimesSync(file, st.atime, st.mtime);
}

syncPackageVersion(BASE_VERSION);

// Cache identity for the service worker (sw.js): the Makefile version plus
// the build time, so a rebuild that forgot to bump VERSION still gets
// treated as new by the service worker's cache check. Static asset URLs
// (see VersionAssetUrlsPlugin) use the plain Makefile version.
const VERSION = `${BASE_VERSION}-${Date.now()}`;

// Writes the plain-text "version" file read by sw.js. Kept as a tiny
// inline plugin rather than a static asset because its content has to be
// generated fresh on every build, not copied from disk.
class WriteVersionFilePlugin {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap("WriteVersionFilePlugin", compilation => {
            compilation.hooks.processAssets.tap(
                { name: "WriteVersionFilePlugin", stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
                () => {
                    compilation.emitAsset("version", new webpack.sources.RawSource(VERSION));
                }
            );
        });
    }
}

// Appends ?v=<Makefile version> to every local .js/.css URL in the emitted
// index.html (bundle.js, style.css), so a release can never be served from
// a browser's or CDN's stale cached copy. Runs on the final HTML, so it
// covers both the script tag webpack injects and the stylesheet link
// authored in public/index.html, with no per-file bookkeeping. Absolute
// URLs and ones that already carry a query are left alone.
class VersionAssetUrlsPlugin {
    apply(compiler) {
        compiler.hooks.compilation.tap("VersionAssetUrlsPlugin", compilation => {
            HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
                "VersionAssetUrlsPlugin",
                (data, cb) => {
                    data.html = data.html.replace(
                        /\b(src|href)="([^"?#:]+\.(?:js|css))"/g,
                        (_, attr, url) => `${attr}="${url}?v=${encodeURIComponent(BASE_VERSION)}"`);
                    cb(null, data);
                });
        });
    }
}

// Helper to execute an external program. Arguments are passed as an array
// and no shell is involved, so paths containing spaces or shell
// metacharacters are handled correctly.
function run(cmd, args) {
    console.log("$", [cmd, ...args].join(" "));
    try {
        const out = child_process.execFileSync(cmd, args)
              .toString().trim();
        if (out) console.log(out);
    } catch (error) {
        console.error(error.message);
    }
}

// The project's top-level Makefile drives the whole build (tty + web);
// this config only handles the JS/static-asset half of it and writes
// straight into the same build/web/ directory the Makefile's emcc rule
// builds quran.wasm into (see ../../Makefile's `build/web/quran.wasm`
// target). The two are independent build steps sharing one output
// directory, so `clean` is off here -- webpack must never delete a file
// it didn't put there itself.
const BUILD_WEB_DIR = path.resolve(__dirname, "../../build/web");

// Renders any missing icon PNGs from ic_base.svg (via ImageMagick) and
// writes manifest.webmanifest into BUILD_WEB_DIR.
class PwaManifestPlugin {
    apply(compiler) {
        compiler.hooks.compile.tap("PwaManifestPlugin", () => this.write());
    }

    write() {
        const ic_base  = path.resolve(__dirname, "public/res/ic_base.svg");
        const sizes    = [32, 96, 128, 192, 256, 384, 512];
        const maskable = 512;

        const mkic = s => ({
            src: s === 32 ? `res/icon.png` : `res/icon_${s}x${s}.png`,
            sizes: `${s}x${s}`,
            type: "image/png"
        });

        const icons = sizes.map(mkic);

        fs.mkdirSync(path.join(BUILD_WEB_DIR, "res"), { recursive: true });

        for (const ic of icons) {
            const out = path.join(BUILD_WEB_DIR, ic.src);
            if (fs.existsSync(out)) continue;
            run("magick", [ic_base, "-scale", ic.sizes, out]);
        }

        icons.push({
            ...mkic(maskable),
            purpose: "maskable"
        });

        const manifest = {
            name:             "Quran",
            short_name:       "Quran",
            display:          "standalone",
            start_url:        ".",
            description:      "The holy Quran, by Naheel",
            background_color: "black",
            screenshots: [
                {
                    src: "res/screenshot.png",
                    sizes: "750x1334",
                    type: "image/png"
                }
            ],
            icons
        };

        fs.writeFileSync(path.join(BUILD_WEB_DIR, "manifest.webmanifest"),
                         JSON.stringify(manifest, null, 2));
    }
}

module.exports = {
    entry: "./src/app.js",

    output: {
        filename: "bundle.js",
        path: BUILD_WEB_DIR,
        clean: false,
    },

    plugins: [
        new webpack.DefinePlugin({
            APP_VERSION: JSON.stringify(VERSION),
        }),

        new HtmlWebpackPlugin({
            template: "./public/index.html",
            filename: "index.html",
            inject: "body",
            minify: false,
        }),

        new VersionAssetUrlsPlugin(),

        // Everything the app needs that isn't authored as a JS module and
        // isn't quran.wasm (built separately, see above) or the icon PNGs
        // (rendered by PwaManifestPlugin): style.css sits at the site
        // root next to index.html; the manifest, fonts, remaining SVG art
        // and the self-hosted tafsir edition list live under public/res
        // and are copied verbatim into build/web/res. sw.js runs in its
        // own worker scope and is loaded directly by the browser from the
        // site root, so it's copied there too.
        new CopyWebpackPlugin({
            patterns: [
                { from: "public/style.css" },
                {
                    from: "public/res",
                    to: "res",
                    // ic_base.svg is a build *input* (see PwaManifestPlugin),
                    // not a shipped asset -- everything else under
                    // public/res still copies through as-is.
                    globOptions: { ignore: ["**/ic_base.svg"] },
                },
                {
                    from: "public/sw.js",
                    transform(content) {
                        return content.toString().replace(/__CACHE_NAME__/g, VERSION);
                    },
                },
            ],
        }),

        new WriteVersionFilePlugin(),

        new PwaManifestPlugin(),
    ],

    devtool: "source-map",
};
