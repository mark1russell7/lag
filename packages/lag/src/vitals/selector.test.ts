import { describe, it, expect } from "vitest";
import { describeNode } from "./selector.js";

type FakeNode = {
    nodeType : number;
    nodeName : string;
    id? : string;
    classList? : string[];
    parentNode? : FakeNode | null;
};

const documentNode : FakeNode = { nodeType : 9, nodeName : "#document" };

function element(nodeName : string, parentNode : FakeNode, options : { id? : string; classes? : string[] } = {}) : FakeNode {
    return { nodeType : 1, nodeName, parentNode, ...(options.id ? { id : options.id } : {}), classList : options.classes ?? [] };
}

describe("describeNode", () => {
    const html = element("HTML", documentNode);
    const body = element("BODY", html);

    it("joins the parts from the root down with >", () => {
        const main = element("MAIN", body);
        const button = element("BUTTON", main, { classes : ["primary", "btn"] });

        expect(describeNode(button)).toBe("html>body>main>button.btn.primary");
    });

    it("stops at the first element with an ID", () => {
        const app = element("DIV", body, { id : "app" });
        const link = element("A", app);

        expect(describeNode(link)).toBe("#app>a");
    });

    it("keeps the selector at 100 characters or less, and gives the deepest part when no part fits", () => {
        let node = body;
        for (let i = 0; i < 30; i++) node = element("SECTION", node, { classes : [`c${i}`] });
        const long = element("SPAN", node, { classes : ["x".repeat(150)] });

        expect(describeNode(node).length).toBeLessThanOrEqual(100);
        expect(describeNode(long)).toBe(`span.${"x".repeat(150)}`);
    });

    it("names text nodes in upper case without the number sign", () => {
        const text : FakeNode = { nodeType : 3, nodeName : "#text", parentNode : element("P", body) };
        expect(describeNode(text)).toBe("html>body>p>TEXT");
    });

    it("gives an empty string for an empty value or an object that throws", () => {
        expect(describeNode(null)).toBe("");
        expect(describeNode(undefined)).toBe("");
        const broken = { nodeType : 1, get nodeName() : string { throw new Error("detached"); } };
        expect(describeNode(broken)).toBe("");
    });
});
