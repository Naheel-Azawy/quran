const path                 = require("path");
const fs                   = require("fs");
const webpack              = require("webpack");
const HtmlWebpackPlugin    = require("html-webpack-plugin");
const WebpackPwaManifest   = require("webpack-pwa-manifest");
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const {compress}           = require("compress-json");

function buildString() {
    let d = new Date();
    let ret = d.getFullYear() +
        d.getMonth().toString().padStart(2, '0') +
        d.getDate().toString().padStart(2, '0') +
        "-" +
        d.getHours().toString().padStart(2, '0') +
        d.getMinutes().toString().padStart(2, '0');
    return JSON.stringify(ret);
}

function quranJson() {
    return JSON.stringify(compress(JSON.parse(fs.readFileSync(
        "./data/quran.json"
    ).toString())));
}

module.exports = env => {
    return {
        target:  "node",
        mode:    env.production ? "production" : "development",
        devtool: env.production ? undefined : "inline-source-map",

        entry: {
            index: "./src/ui-web/main.js",
            sw:    "./src/ui-web/sw.js",
            cli:   "./src/ui-cli/main.js"
        },

        output: {
            path:     path.resolve(__dirname, "dist"),
            filename: "[name].bundle.js",
            clean:    false
        },

        resolve: {
            extensions: [".js"],
        },

        module: {
            rules: [
                {test: /\.css$/, use: ["style-loader", "css-loader"]},
                { test: /\.ttf$/, loader: "url-loader"}
            ]
        },

        plugins: [
            new webpack.DefinePlugin({
                BUILD:      buildString(),
                QURAN_JSON: quranJson(),
                TAFSEER:    fs.readFileSync("./data/tafseer-list.json").toString()
            }),

            /*{apply: compiler => compiler.hooks.compile.tap("json-gen", () => {
                jsonGen(env.production);
                console.log("quran.json generated");
            })},*/
            
            new HtmlWebpackPlugin({
                template: "./src/ui-web/index.html",
                chunks:   ["index"]
            }),

            new WebpackPwaManifest({
                name:             "Quran",
                short_name:       "Quran",
                description:      "The holy Quran, by Naheel",
                background_color: "black",
                display:          "standalone",
                orientation:      "omit",
                fingerprints:     false,
                icons: [
                    {
                        src: path.resolve("./src/ui-web/icon.png"),
                        sizes: [96, 128, 192, 256, 384, 512]
                    },
                    {
                        src: path.resolve("./src/ui-web/icon.png"),
                        size: "512x512",
                        purpose: "maskable"
                    }
                ]
            }),

            new webpack.BannerPlugin({
                banner:  fs.readFileSync("./src/ui-cli/launcher.sh").toString(),
                include: "cli",
                raw:     true
            }),

            //new BundleAnalyzerPlugin()
        ]
    };
};
