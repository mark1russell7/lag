import { afterEach, describe, expect, it, vi } from "vitest";
import { createRandomId } from "./random-id.js";

describe("createRandomId", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("gives the bytes of crypto.getRandomValues as 32 hexadecimal digits", () => {
        vi.stubGlobal("crypto", {
            getRandomValues : (bytes : Uint8Array) => {
                bytes.forEach((_, i) => { bytes[i] = i * 17; });
                return bytes;
            },
        });

        expect(createRandomId()).toBe("00112233445566778899aabbccddeeff");
    });

    it("uses Math.random when the environment has no crypto.getRandomValues", () => {
        vi.stubGlobal("crypto", undefined);
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        expect(createRandomId()).toBe("80".repeat(16));
    });

    it("gives a different ID at each use", () => {
        const first = createRandomId();

        expect(first).toMatch(/^[0-9a-f]{32}$/);
        expect(createRandomId()).not.toBe(first);
    });
});
