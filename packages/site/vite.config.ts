import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { normalizeBase } from "./build/base";
import { mdxFrontmatterPlugin } from "./build/frontmatter-plugin";
import { mdxPlugin } from "./build/mdx-plugin";
import { spaFallbackPlugin } from "./build/spa-fallback-plugin";

const siteDir = fileURLToPath(new URL(".", import.meta.url));

/** The `src` folder of a workspace package, so the site always uses the current source. */
function sourceOf(packageDir : string) : string {
    return path.resolve(siteDir, "..", packageDir, "src");
}

export default defineConfig({
    // Set SITE_BASE to deploy below a path, as GitHub Pages does: SITE_BASE=lag
    // gives /lag/. (Git Bash on Windows changes "/lag" into a Windows path, so
    // there use the form without slashes.)
    base : normalizeBase(process.env["SITE_BASE"]),
    plugins : [
        mdxFrontmatterPlugin(),
        mdxPlugin(),
        react({ include : /\.(mdx|js|jsx|ts|tsx)$/ }),
        spaFallbackPlugin(),
    ],
    resolve : {
        alias : {
            // The export "./worker" first: the alias of the package also matches its subpaths
            "@mark1russell7/lag/worker" : path.join(sourceOf("lag"), "worker", "index.ts"),
            "@mark1russell7/lag" : sourceOf("lag"),
            "@lag/load" : sourceOf("load"),
            "@lag/report" : sourceOf("report"),
        },
    },
    worker : {
        format : "es",
    },
    optimizeDeps : {
        // Pre-bundle the large libraries that load lazily, so the dev server
        // (and Vitest browser mode) does not reload the page when they load.
        include : [
            "react",
            "react-dom",
            "react-dom/client",
            "react-router",
            "react-router/dom",
            "@observablehq/plot",
            "@xyflow/react",
            "mermaid",
            // A dependency of @mark1russell7/lag, which the site imports as source
            "@mark1russell7/lag > page-lifecycle-tracker",
        ],
    },
    build : {
        target : "es2022",
        // Mermaid is large; it loads only on pages that show a diagram.
        chunkSizeWarningLimit : 1500,
    },
});
