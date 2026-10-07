import mdx from "@mdx-js/rollup";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import type { Plugin } from "vite";
import { isFrontmatterRequest } from "./frontmatter";
import { rehypeExportToc } from "./rehype-export-toc";
import { remarkMermaid } from "./remark-mermaid";

/**
 * This plugin compiles `.mdx` pages. Each page module exports:
 * - `default`: the page component
 * - `frontmatter`: the YAML frontmatter
 * - `toc`: the `h2` and `h3` headings
 *
 * The wrapper skips `page.mdx?frontmatter` requests, which
 * `mdxFrontmatterPlugin` serves.
 */
export function mdxPlugin() : Plugin {
    const inner = mdx({
        remarkPlugins : [
            remarkFrontmatter,
            [remarkMdxFrontmatter, { name : "frontmatter" }],
            remarkGfm,
            remarkMermaid,
        ],
        rehypePlugins : [
            rehypeSlug,
            rehypeExportToc,
            [rehypeAutolinkHeadings, { behavior : "wrap", properties : { className : ["heading-anchor"] } }],
        ],
    });

    return {
        name : "lag-site:mdx",
        enforce : "pre",
        config(config, env) {
            inner.config(config, env);
        },
        async transform(code, id) {
            if (isFrontmatterRequest(id)) return undefined;
            return await inner.transform(code, id);
        },
    };
}
