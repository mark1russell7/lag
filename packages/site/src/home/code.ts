/**
 * The code of the home page. The usage example is the quick start of the
 * README of the package, thus the home page and npm show the same code.
 */
import readme from "../../../lag/README.md?raw";

export const INSTALL_COMMAND = "npm install @mark1russell7/lag";

/** This function gives the first TypeScript block after the heading "Quick start" of a Markdown text. */
export function quickStartCode(markdown : string) : string | undefined {
    const section = markdown.split(/^## Quick start\s*$/m)[1];
    if (section === undefined) return undefined;
    const match = /^```ts\n([\s\S]*?)^```/m.exec(section.replace(/\r\n/g, "\n"));
    return match?.[1]?.trimEnd();
}

export const USAGE_CODE : string = quickStartCode(readme) ?? "";

export type CodeTokenKind = "comment" | "string" | "keyword" | "number" | "call" | "plain";

export type CodeToken = { readonly text : string; readonly kind : CodeTokenKind };

const KEYWORDS = "import|from|const|let|new|if|else|return|void|await|async|function|export|of|for|typeof|as";
const TOKEN = new RegExp(
    [
        "(\\/\\/[^\\n]*)",
        "(\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)",
        `\\b(${KEYWORDS})\\b`,
        "\\b(\\d[\\d_.]*)\\b",
        "([A-Za-z_$][\\w$]*)(?=\\s*\\()",
    ].join("|"),
    "g",
);

/** A small highlighter for TypeScript: comments, strings, keywords, numbers and function names. The other text is plain. */
export function highlight(code : string) : CodeToken[] {
    const tokens : CodeToken[] = [];
    let index = 0;
    for (const match of code.matchAll(TOKEN)) {
        if (match.index > index) tokens.push({ text : code.slice(index, match.index), kind : "plain" });
        const kind : CodeTokenKind = match[1] ? "comment" : match[2] ? "string" : match[3] ? "keyword" : match[4] ? "number" : "call";
        tokens.push({ text : match[0], kind });
        index = match.index + match[0].length;
    }
    if (index < code.length) tokens.push({ text : code.slice(index), kind : "plain" });
    return tokens;
}
