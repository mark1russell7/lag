import { describe, expect, it } from "vitest";
import { isRawRequest } from "./mdx-plugin";

describe("isRawRequest", () => {
    it("finds the import of the text of a file", () => {
        expect(isRawRequest("/repo/packages/lag/README.md?raw")).toBe(true);
        expect(isRawRequest("/repo/a.md?import&raw")).toBe(true);
        expect(isRawRequest("/repo/a.md?raw&v=1")).toBe(true);
    });

    it("does not find a page or another query", () => {
        expect(isRawRequest("/repo/content/docs/index.mdx")).toBe(false);
        expect(isRawRequest("/repo/content/docs/index.mdx?frontmatter")).toBe(false);
        expect(isRawRequest("/repo/rawdata.mdx")).toBe(false);
        expect(isRawRequest("/repo/a.mdx?rawness")).toBe(false);
    });
});
