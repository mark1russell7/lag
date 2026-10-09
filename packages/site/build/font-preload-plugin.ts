import type { Plugin } from "vite";

/** The font files that each page uses at the first paint: the Latin text font and the Latin code font. */
const PRELOAD = [/atkinson-hyperlegible-next-latin-wght-normal-[\w-]+\.woff2$/, /atkinson-hyperlegible-mono-latin-wght-normal-[\w-]+\.woff2$/];

/** The files of the bundle to preload, in the order of `PRELOAD`. */
export function preloadFiles(files : readonly string[]) : string[] {
    return PRELOAD.flatMap(pattern => files.filter(file => pattern.test(file)));
}

/**
 * This plugin adds `<link rel="preload">` for the two main font files to the
 * HTML of the build. Thus the browser loads the fonts with the CSS, and the
 * text of a prerendered page shows in its font earlier.
 */
export function fontPreloadPlugin() : Plugin {
    let base = "/";
    return {
        name : "lag-site:font-preload",
        apply : "build",
        configResolved(config) {
            base = config.base;
        },
        transformIndexHtml : {
            order : "post",
            handler(_html, context) {
                return preloadFiles(Object.keys(context.bundle ?? {})).map(file => ({
                    tag : "link",
                    attrs : { rel : "preload", as : "font", type : "font/woff2", crossorigin : "", href : `${base}${file}` },
                    injectTo : "head-prepend" as const,
                }));
            },
        },
    };
}
