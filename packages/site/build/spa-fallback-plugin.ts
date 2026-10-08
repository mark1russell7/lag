import { copyFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * This plugin copies `index.html` to `404.html` after the build. GitHub
 * Pages serves `404.html` for an unknown path, so a deep link opens the
 * single-page app and the client router shows the correct page.
 */
export function spaFallbackPlugin() : Plugin {
    let outDir = "";
    return {
        name : "lag-site:spa-fallback",
        apply : "build",
        configResolved(config) {
            outDir = path.resolve(config.root, config.build.outDir);
        },
        async writeBundle() {
            await copyFile(path.join(outDir, "index.html"), path.join(outDir, "404.html"));
        },
    };
}
