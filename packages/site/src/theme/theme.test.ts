import { describe, expect, it } from "vitest";
import { contrastRatio, mixColor, readableOn, relativeLuminance } from "./colors";
import { createBrowserPreferenceStore, createMemoryPreferenceStore } from "./preferences";
import { nextThemePreference, parseThemePreference, resolveTheme, themeLabel } from "./theme";

describe("theme preference", () => {
    it("reads only light and dark; anything else is system", () => {
        expect(parseThemePreference("light")).toBe("light");
        expect(parseThemePreference("dark")).toBe("dark");
        expect(parseThemePreference("blue")).toBe("system");
        expect(parseThemePreference(null)).toBe("system");
    });

    it("cycles system, light, dark", () => {
        expect(nextThemePreference("system")).toBe("light");
        expect(nextThemePreference("light")).toBe("dark");
        expect(nextThemePreference("dark")).toBe("system");
    });

    it("resolves the system preference", () => {
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
        expect(resolveTheme("light", true)).toBe("light");
        expect(themeLabel("dark")).toBe("Dark");
    });
});

describe("preference stores", () => {
    it("keeps values in memory", () => {
        const store = createMemoryPreferenceStore({ a : "1" });
        expect(store.get("a")).toBe("1");
        store.set("a", null);
        expect(store.get("a")).toBeNull();
    });

    it("works with a storage that throws", () => {
        const throwing = {
            getItem : () => { throw new Error("SecurityError"); },
            setItem : () => { throw new Error("QuotaExceededError"); },
            removeItem : () => { throw new Error("SecurityError"); },
        } as unknown as Storage;
        const store = createBrowserPreferenceStore(() => throwing);
        expect(store.get("theme")).toBeNull();
        expect(() => store.set("theme", "dark")).not.toThrow();
        expect(() => store.set("theme", null)).not.toThrow();
    });

    it("works when the storage itself cannot be read", () => {
        const store = createBrowserPreferenceStore(() => { throw new Error("SecurityError"); });
        expect(store.get("theme")).toBeNull();
        expect(() => store.set("theme", "light")).not.toThrow();
    });

    it("works without a storage", () => {
        const store = createBrowserPreferenceStore(() => undefined);
        expect(store.get("theme")).toBeNull();
        expect(() => store.set("theme", "light")).not.toThrow();
    });
});

describe("mixColor", () => {
    it("puts a color with an opacity on a background, as an opaque color", () => {
        expect(mixColor("#ff0000", "#ffffff", 0.2)).toBe("#ffcccc");
        expect(mixColor("#000", "#fff", 1)).toBe("#000000");
        expect(mixColor("#123456", "#abcdef", 0)).toBe("#abcdef");
        expect(mixColor("#ff0000", "#ffffff", 3)).toBe("#ff0000");
    });

    it("gives a color that is not a hex color without a change", () => {
        expect(mixColor("rgb(1, 2, 3)", "#ffffff", 0.5)).toBe("rgb(1, 2, 3)");
        expect(mixColor("#ff0000", "transparent", 0.5)).toBe("#ff0000");
    });
});

describe("contrast", () => {
    it("calculates the relative luminance and the contrast ratio of WCAG 2", () => {
        expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
        expect(relativeLuminance("#000")).toBe(0);
        expect(relativeLuminance("red")).toBeUndefined();
        expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
        expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
    });

    it("selects the text color with the higher contrast on a fill", () => {
        // White text on the dark red of the light theme, and dark text on the light red of the dark theme
        expect(readableOn("#c2301f", ["#ffffff", "#151c2e"])).toBe("#ffffff");
        expect(readableOn("#ff7b6b", ["#ffffff", "#0e1220"])).toBe("#0e1220");
    });
});
