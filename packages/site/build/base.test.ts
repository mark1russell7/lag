import { describe, expect, it } from "vitest";
import { normalizeBase } from "./base";

describe("normalizeBase", () => {
    it("gives / for an empty value", () => {
        expect(normalizeBase(undefined)).toBe("/");
        expect(normalizeBase("")).toBe("/");
        expect(normalizeBase(" / ")).toBe("/");
    });

    it("adds the slashes at the start and the end", () => {
        expect(normalizeBase("lag")).toBe("/lag/");
        expect(normalizeBase("/lag")).toBe("/lag/");
        expect(normalizeBase("/lag/")).toBe("/lag/");
        expect(normalizeBase("a/b")).toBe("/a/b/");
    });

    it("keeps a full URL", () => {
        expect(normalizeBase("https://cdn.example.org/lag")).toBe("https://cdn.example.org/lag/");
    });
});
