import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

const number1 = new Intl.NumberFormat("en", { maximumFractionDigits : 1 });

/** The copy of the site before the move to `@mark1russell7/quantity`, word for word. */
function copyFormatBytes(bytes : number) : string {
    if (!Number.isFinite(bytes)) return "–";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (Math.abs(value) >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${number1.format(value)} ${units[unit]}`;
}

const KI = 1024;
const MI = KI * KI;
const GI = MI * KI;

/** The sizes of the sweep: each power of 1024, the values next to each change of unit, and a dense run. */
const BYTES : number[] = [0, 1, 512, 1023, 1024, 1536, 1048524, 1048575, 1048576];
for (const base of [1, KI, MI, GI, GI * KI]) {
    for (const factor of [1, 1.05, 1.5, 10, 100, 999.9, 1023.9, 1023.94, 1023.95, 1024]) BYTES.push(Math.round(base * factor));
}
for (let bytes = 0; bytes <= 3 * MI; bytes += 997) BYTES.push(bytes);
const SIGNED_BYTES = [...BYTES, ...BYTES.filter(b => b > 0).map(b => -b)];

/** The copy shows the IEC sizes with the symbols of 1000: "KB" for 1024 bytes. */
const toIec = (text : string) : string => text.replace(/ KB$/, " KiB").replace(/ MB$/, " MiB").replace(/ GB$/, " GiB");

describe("formatBytes on the scale of @mark1russell7/quantity and the copy of the site", () => {
    it("gives the text of the copy with KiB for KB, except for the two listed differences", () => {
        let same = 0;
        let filled = 0;
        let tebibytes = 0;
        for (const b of SIGNED_BYTES) {
            const old = toIec(copyFormatBytes(b));
            const text = formatBytes(b);
            if (text === old) {
                same++;
                continue;
            }
            if (Math.abs(b) >= GI * 1023.95) {
                // the copy has no step above GB: "1,024 GB" is "1 TiB" now
                expect(text, `${b} B`).toMatch(/ TiB$/);
                tebibytes++;
                continue;
            }
            // the copy selects the unit before it rounds: 1,048,575 B gave "1,024 KB". The rounded value fills the next step now
            expect(old, `${b} B`).toMatch(/^-?1,024 (B|KiB|MiB)$/);
            expect(text, `${b} B`).toMatch(/^-?1 (KiB|MiB|GiB)$/);
            filled++;
        }
        expect(same + filled + tebibytes).toBe(SIGNED_BYTES.length);
        expect(same).toBeGreaterThan(6_000);
        expect(filled).toBeGreaterThan(0);
        expect(tebibytes).toBeGreaterThan(0);
    });

    it("gives the listed text changes", () => {
        expect([copyFormatBytes(1536), formatBytes(1536)]).toEqual(["1.5 KB", "1.5 KiB"]);
        expect([copyFormatBytes(1_048_575), formatBytes(1_048_575)]).toEqual(["1,024 KB", "1 MiB"]);
        expect([copyFormatBytes(GI * KI), formatBytes(GI * KI)]).toEqual(["1,024 GB", "1 TiB"]);
        expect([copyFormatBytes(1023), formatBytes(1023)]).toEqual(["1,023 B", "1,023 B"]);
        expect([copyFormatBytes(Number.NaN), formatBytes(Number.NaN)]).toEqual(["–", "–"]);
    });
});
