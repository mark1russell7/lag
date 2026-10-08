import { describe, expect, it } from "vitest";
import { siteContent } from "../content/site-content";
import { architectureEdges, architectureNodes } from "./graph";

const ids = architectureNodes.map(node => node.id);
const APP_PATHS = ["/results", "/playground"];

describe("architecture graph", () => {
    it("has a unique ID for each node", () => {
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("connects only nodes that exist", () => {
        for (const edge of architectureEdges) {
            expect(ids, `${edge.source} -> ${edge.target}`).toContain(edge.source);
            expect(ids, `${edge.source} -> ${edge.target}`).toContain(edge.target);
        }
    });

    it("puts children in group nodes that exist", () => {
        for (const node of architectureNodes.filter(candidate => candidate.parent)) {
            const parent = architectureNodes.find(candidate => candidate.id === node.parent);
            expect(parent?.size, node.id).toBeDefined();
        }
    });

    it("links each node to a page that exists", () => {
        for (const node of architectureNodes) {
            if (!node.docs) continue;
            if (APP_PATHS.includes(node.docs)) continue;
            const [, section = "", ...rest] = node.docs.split("/");
            expect(siteContent.page(section, rest.join("/")), `${node.id}: ${node.docs}`).toBeDefined();
        }
    });
});
