import { describe, expect, it } from "vitest";
import readme from "../../../lag/README.md?raw";
import { highlight, quickStartCode, USAGE_CODE } from "./code";

describe("the usage example", () => {
    it("is the quick start of the README of the package", () => {
        expect(USAGE_CODE).toBe(quickStartCode(readme));
        expect(USAGE_CODE).toContain("setupAllMonitors(createBrowserDeps(window");
        expect(USAGE_CODE).toContain("createLagWorker()");
    });

    // The first import transforms the source of the package: on a busy machine it takes more than 5 s
    it("uses only exports of the package", async () => {
        const lag = await import("@mark1russell7/lag");
        const worker = await import("@mark1russell7/lag/worker");
        const imports = [...USAGE_CODE.matchAll(/import \{([^}]+)\} from "(@mark1russell7\/lag[^"]*)"/g)];
        expect(imports.length).toBe(2);
        for (const [, names, from] of imports) {
            const module : Record<string, unknown> = from === "@mark1russell7/lag" ? lag : worker;
            for (const name of names!.split(",").map(part => part.trim())) expect(module[name], `${name} of ${from}`).toBeTypeOf("function");
        }
    }, 30_000);

    it("gives undefined for a text without a quick start", () => {
        expect(quickStartCode("# Title\n\n```ts\nconst a = 1;\n```\n")).toBeUndefined();
        expect(quickStartCode("## Quick start\r\n\r\nText.\r\n\r\n```ts\r\nconst a = 1;\r\n```\r\n")).toBe("const a = 1;");
    });
});

describe("highlight", () => {
    it("gives the same text, in tokens", () => {
        const code = "import { a } from \"b\"; // c\nconst x = f(42, 'y');";
        const tokens = highlight(code);
        expect(tokens.map(token => token.text).join("")).toBe(code);
        expect(tokens.filter(token => token.kind !== "plain")).toEqual([
            { text : "import", kind : "keyword" },
            { text : "from", kind : "keyword" },
            { text : "\"b\"", kind : "string" },
            { text : "// c", kind : "comment" },
            { text : "const", kind : "keyword" },
            { text : "f", kind : "call" },
            { text : "42", kind : "number" },
            { text : "'y'", kind : "string" },
        ]);
    });

    it("does not find a comment or a keyword in a string", () => {
        const tokens = highlight("u(\"https://example.com/v1/metrics import\")");
        expect(tokens).toEqual([
            { text : "u", kind : "call" },
            { text : "(", kind : "plain" },
            { text : "\"https://example.com/v1/metrics import\"", kind : "string" },
            { text : ")", kind : "plain" },
        ]);
    });
});
