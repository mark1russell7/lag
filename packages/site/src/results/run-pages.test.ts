import { describe, expect, it } from "vitest";
import { RUN_PAGES, runPageOf, runPageTitle } from "./run-pages";

describe("run pages", () => {
    it("finds the view of a URL path, and the overview for the path of the run", () => {
        expect(runPageOf("/results/r1").path).toBe(".");
        expect(runPageOf("/results/r1/").path).toBe(".");
        expect(runPageOf("/results/r1/tests").label).toBe("Tests");
        expect(runPageOf("/results/r1/measurements/").label).toBe("Measurements");
    });

    it("gives each view a different title", () => {
        const titles = RUN_PAGES.map(page => runPageTitle("r1", page));
        expect(titles[0]).toBe("Run r1 – lag");
        expect(titles[1]).toBe("Tests of run r1 – lag");
        expect(new Set(titles).size).toBe(RUN_PAGES.length);
    });
});
