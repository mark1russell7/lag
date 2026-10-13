import { describe, expect, it } from "vitest";
import { sessionLossRetry } from "./session-loss.js";

describe("sessionLossRetry", () => {
    it("operates the tests a second time after a lost session without a failed test, also with the colors of Vitest", () => {
        const output = "\u001b[31mError: Browser connection was closed while running tests\u001b[39m\nWebDriverError: invalid session id\n Test Files  3 passed (9)\n";

        expect(sessionLossRetry(output)).toEqual({
            retry : true,
            reason : "Safari in the iOS Simulator closed its WebDriver session (Browser connection was closed while running tests;invalid session id), and no test failed. Thus the tests operate a second time.",
        });
    });

    it("does not operate the tests again when a test also failed", () => {
        expect(sessionLossRetry("invalid session id\n FAIL  src/drift.test.ts > drift\n").retry).toBe(false);
        expect(sessionLossRetry("invalid session id\n      Tests  2 failed | 40 passed (42)\n").retry).toBe(false);
    });

    it("does not operate the tests again for another failure", () => {
        expect(sessionLossRetry("Error: Cannot find module 'vitest'\n").retry).toBe(false);
    });
});
