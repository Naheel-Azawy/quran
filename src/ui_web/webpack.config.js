const path              = require("path");
const webpack           = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const pkg               = require("./package.json");

// A fresh, unique value on every build. The service worker (sw.js) fetches
// the "version" file this gets written to (bypassing the HTTP cache, see
// sw.js) and compares it against the cache it currently holds; a mismatch
// means "the app changed since this cache was built" and triggers a full
// re-cache. Basing this on the package version *and* the build time means
// forgetting to bump the version number in package.json can never cause a
// stale build to be served indefinitely.
const VERSION = `${pkg.version}-${Date.now()}`;

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

// The project's top-level Makefile drives the whole build (tty + web);
// this config only handles the JS/static-asset half of it and writes
// straight into the same build/web/ directory the Makefile's emcc rule
// builds quran.wasm into (see ../../Makefile's `build/web/quran.wasm`
// target). The two are independent build steps sharing one output
// directory, so `clean` is off here -- webpack must never delete a file
// it didn't put there itself.
const BUILD_WEB_DIR = path.resolve(__dirname, "../../build/web");

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

        // Everything the app needs that isn't authored as a JS module and
        // isn't quran.wasm (built separately, see above): style.css sits
        // at the site root next to index.html; the manifest, icons,
        // fonts and the self-hosted tafsir edition list live under
        // public/res and are copied verbatim into build/web/res. sw.js
        // runs in its own worker scope and is loaded directly by the
        // browser from the site root, so it's copied there too.
        new CopyWebpackPlugin({
            patterns: [
                { from: "public/style.css" },
                { from: "public/res", to: "res" },
                {
                    from: "public/sw.js",
                    transform(content) {
                        return content.toString().replace(/__CACHE_NAME__/g, VERSION);
                    },
                },
            ],
        }),

        new WriteVersionFilePlugin(),
    ],

    devtool: "source-map",
};
