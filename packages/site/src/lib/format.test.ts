import { describe, expect, it } from "vitest";
import { formatBytes, formatMs } from "./format";

const number1 = new Intl.NumberFormat("en", { maximumFractionDigits : 1 });
const number2 = new Intl.NumberFormat("en", { maximumFractionDigits : 2 });
const integer = new Intl.NumberFormat("en", { maximumFractionDigits : 0 });

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

/** The duration copy of the site before the move to `@mark1russell7/quantity`, word for word. */
function copyFormatMs(ms : number) : string {
    if (!Number.isFinite(ms)) return "–";
    const abs = Math.abs(ms);
    if (abs < 1) return `${number2.format(ms)} ms`;
    if (abs < 10) return `${number1.format(ms)} ms`;
    if (abs < 1000) return `${integer.format(ms)} ms`;
    // 59 995 ms and more round to 60 s: they show in minutes
    if (abs < 59_995) return `${number2.format(ms / 1000)} s`;
    // Round to whole seconds first, thus 119 600 ms gives "2 min 0 s", not "1 min 60 s"
    const totalSeconds = Math.round(abs / 1000);
    return `${ms < 0 ? "-" : ""}${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The durations of the sweep: dense runs in each unit, the values next to each change of unit, and long runs. */
const MS : number[] = [0, 0.004, 0.005, 0.995, 9.949, 9.95, 999.49, 999.5, 59_994, 59_995, 59_999, MINUTE, 119_600, HOUR, 3_700_000];
for (let i = 0; i <= 2000; i++) MS.push(i / 100);
for (let i = 0; i <= 20_000; i++) MS.push(i / 10);
for (let i = 0; i <= 200_000; i += 7) MS.push(i);
for (let i = 0; i <= 3 * HOUR; i += 997) MS.push(i);
const SIGNED_MS = [...MS, ...MS.filter(ms => ms > 0).map(ms => -ms)];

describe("formatMs on the scale of @mark1russell7/quantity and the copy of the site", () => {
    it("gives the text of the copy below one minute, except for the two listed differences", () => {
        let same = 0;
        let rounded = 0;
        let zero = 0;
        let longer = 0;
        for (const ms of SIGNED_MS) {
            const old = copyFormatMs(ms);
            const text = formatMs(ms);
            if (text === old) {
                same++;
                continue;
            }
            if (Math.abs(ms) >= 59_995) {
                // the scale shows minutes with no "0 s", and hours and minutes from one hour
                expect(text, `${ms} ms`).toMatch(/^-?\d+ (min|h)( \d+ (s|min))?$/);
                longer++;
                continue;
            }
            if (Math.abs(ms) >= 999.5 && Math.abs(ms) < 1000) {
                // the copy selects the unit before it rounds: 999.5 ms gave "1,000 ms"
                expect([old, text], `${ms} ms`).toEqual(ms < 0 ? ["-1,000 ms", "-1 s"] : ["1,000 ms", "1 s"]);
                rounded++;
                continue;
            }
            // a negative value that rounds to 0 has no sign
            expect([old, text], `${ms} ms`).toEqual(["-0 ms", "0 ms"]);
            zero++;
        }
        expect(same + rounded + zero + longer).toBe(SIGNED_MS.length);
        expect(same).toBeGreaterThan(40_000);
        expect(rounded).toBeGreaterThan(0);
        expect(zero).toBeGreaterThan(0);
        expect(longer).toBeGreaterThan(0);
    });

    it("gives the listed text changes", () => {
        expect([copyFormatMs(0.42), formatMs(0.42)]).toEqual(["0.42 ms", "0.42 ms"]);
        expect([copyFormatMs(1250), formatMs(1250)]).toEqual(["1.25 s", "1.25 s"]);
        expect([copyFormatMs(125_000), formatMs(125_000)]).toEqual(["2 min 5 s", "2 min 5 s"]);
        expect([copyFormatMs(120_000), formatMs(120_000)]).toEqual(["2 min 0 s", "2 min"]);
        expect([copyFormatMs(3_700_000), formatMs(3_700_000)]).toEqual(["61 min 40 s", "1 h 2 min"]);
        expect([copyFormatMs(999.5), formatMs(999.5)]).toEqual(["1,000 ms", "1 s"]);
        expect([copyFormatMs(-0.001), formatMs(-0.001)]).toEqual(["-0 ms", "0 ms"]);
        expect([copyFormatMs(Number.NaN), formatMs(Number.NaN)]).toEqual(["–", "–"]);
    });
});
