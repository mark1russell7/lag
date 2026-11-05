import { expect } from "vitest";
import { createNoopMeter, setupAllMonitors, type AllMonitorHandles, type BrowserGlobals } from "@mark1russell7/lag";
import { createBrowserDeps, createTeeMeter, wait } from "./harness.js";
import { environment } from "./commands.js";
import { idleProbe } from "./idle-probe.js";

/** The time of the idle case. */
const IDLE_MS = 60_000;

/** The time for the monitor to find the throttling and the grid, before the first block. */
const SETTLE_MS = 8_000;

/** The known blocks, in order. */
const BLOCKS_MS = [2_500, 6_000, 2_500, 6_000, 2_500, 6_000];

/** The time between two blocks. Each block adds a part of a grid, so that the blocks do not have one position on the grid. */
const BLOCK_GAP_MS = 10_000;
const BLOCK_SHIFT_MS = 370;

/** The grid of WebKit in a frame that is off the screen, from experiment E9. */
const GRID_MS = 1_000;

/** A wake is off the grid when it is further than this from the usual position on the grid. */
const OFF_GRID_MS = 50;

const LONG_STEP_MS = GRID_MS * 2.2;

/** A value at or above this has no place in a normal window of the idle case. */
const LONG_VALUE_MS = 500;

/** The time after the end of a block in which its value can come. */
const VALUE_AFTER_BLOCK_MS = 3_000;

type Read = {
    readonly name : string;
    readonly userAgent : string;
    readonly idleMessages : number;
    readonly throttled : boolean;
    readonly offScreenMs : number;
    readonly wakes : number;
    readonly longSteps : readonly number[];
    readonly offGrid : number;
    readonly marked : readonly number[];
    readonly unmarkedLong : readonly number[];
    readonly unread : Readonly<Record<string, number>>;
    readonly blocks : ReadonlyArray<{ readonly ms : number; readonly value : number | null }>;
};

/** A frame of the same origin, above a spacer. A scroll of the test page moves the frame off the screen. */
async function createFrame() : Promise<{ frame : HTMLIFrameElement; child : Window & typeof globalThis; spacer : HTMLDivElement }> {
    const frame = document.createElement("iframe");
    frame.style.cssText = "display: block; width: 300px; height: 300px; border: 0";
    const loaded = new Promise<void>(resolve => frame.addEventListener("load", () => resolve(), { once : true }));
    frame.srcdoc = "<!doctype html><p>A frame of the lag test</p>";
    const spacer = document.createElement("div");
    spacer.style.height = "4000px";
    document.body.append(frame, spacer);
    await loaded;
    return { frame, child : frame.contentWindow as Window & typeof globalThis, spacer };
}

/** A chain of timeouts in the frame that does not use the monitor. It gives the time of each wake. */
function watchWakes(child : Window & typeof globalThis) {
    const wakes : number[] = [];
    let stopped = false;
    let handle = 0;
    const step = () : void => {
        wakes.push(performance.now());
        if (!stopped) handle = child.setTimeout(step, 100);
    };
    handle = child.setTimeout(step, 100);
    return {
        wakes,
        stop() {
            stopped = true;
            child.clearTimeout(handle);
        },
    };
}

/** The number of wakes that are further than `OFF_GRID_MS` from the mean position on the grid. */
function countOffGrid(wakes : readonly number[]) : number {
    const angles = wakes.map(at => (at % GRID_MS) / GRID_MS * 2 * Math.PI);
    const mean = Math.atan2(
        angles.reduce((sum, angle) => sum + Math.sin(angle), 0),
        angles.reduce((sum, angle) => sum + Math.cos(angle), 0),
    );
    const limit = OFF_GRID_MS / GRID_MS * 2 * Math.PI;
    return angles.filter(angle => Math.abs(Math.atan2(Math.sin(angle - mean), Math.cos(angle - mean))) > limit).length;
}

function block(ms : number) : void {
    const end = performance.now() + ms;
    while (performance.now() < end) { /* This loop is the block. */ }
}

/**
 * A read of the option `recordThrottledSteps` in a real browser, for a person.
 * Each test gives one line with the prefix `throttled-step read`. The tests do
 * not examine the values, because this is a read and not a gate. The line tells
 * if the rule invents a value on an idle page, and how near its value is to a
 * known block. Real WebKit on macOS is not an iPhone.
 */
describe("A read of long throttled steps", () => {
    let handles : AllMonitorHandles | undefined;
    let cleanup = () : void => {};

    afterEach(() => {
        handles?.stop();
        handles = undefined;
        cleanup();
    });

    async function read(name : string, during : () => Promise<ReadonlyArray<{ readonly ms : number; readonly endAt : number }>>) : Promise<Read> {
        const idleMessages = (await idleProbe()).messages;
        const { frame, child, spacer } = await createFrame();
        const watch = watchWakes(child);
        cleanup = () => {
            watch.stop();
            window.scrollTo(0, 0);
            frame.remove();
            spacer.remove();
        };
        const tee = createTeeMeter(createNoopMeter());
        const logs : string[] = [];
        const { frameViewport : _unused, ...deps } = createBrowserDeps({
            logger : { log : (_level, message) => logs.push(message) },
            meter : tee.meter,
            peerHangWatch : false,
            hangJournal : false,
            crashReportContext : false,
        }, child as unknown as BrowserGlobals);
        handles = setupAllMonitors({ ...deps, recordThrottledSteps : true });
        await wait(3_000);

        window.scrollTo(0, 2_000);
        const offAt = performance.now();
        const blocks = await during();
        // A value waits for the next step. A value of 5 s or more also waits 2 s for late evidence.
        await wait(VALUE_AFTER_BLOCK_MS + 2_000);
        const onAt = performance.now();
        window.scrollTo(0, 0);

        const wakes = watch.wakes.filter(at => at > offAt && at < onAt);
        const records = tee.records("lag_drift_histogram").filter(record => record.time > offAt);
        const isMarked = (attributes : unknown) : boolean => (attributes as { source? : string } | undefined)?.source === "throttled-step";
        const marked = records.filter(record => isMarked(record.attributes));
        const unread : Record<string, number> = {};
        for (const record of tee.records("lag_drift_unread_steps").filter(row => row.time > offAt)) {
            const mode = String((record.attributes as { mode? : string } | undefined)?.mode);
            unread[mode] = (unread[mode] ?? 0) + 1;
        }
        const result : Read = {
            name,
            userAgent : navigator.userAgent,
            idleMessages,
            throttled : logs.includes("DriftLag: the browser throttles the timers. The windows pause."),
            offScreenMs : Math.round(onAt - offAt),
            wakes : wakes.length,
            longSteps : wakes.slice(1).map((at, index) => Math.round(at - wakes[index]!)).filter(step => step > LONG_STEP_MS),
            offGrid : countOffGrid(wakes),
            marked : marked.map(record => Math.round(record.value)),
            unmarkedLong : records.filter(record => !isMarked(record.attributes) && record.value >= LONG_VALUE_MS).map(record => Math.round(record.value)),
            unread,
            blocks : blocks.map(({ ms, endAt }) => {
                const value = marked.find(record => record.time >= endAt && record.time <= endAt + VALUE_AFTER_BLOCK_MS + 2_000);
                return { ms, value : value === undefined ? null : Math.round(value.value) };
            }),
        };
        console.log(`throttled-step read ${JSON.stringify(result)}`);
        return result;
    }

    it("an idle page with the frame off the screen", async (ctx) => {
        ctx.skip(environment() !== "safari", "This read is for the real Safari.");
        const result = await read("idle", async () => {
            await wait(IDLE_MS);
            return [];
        });
        expect(result.offScreenMs).toBeGreaterThan(0);
    }, 180_000);

    it("known blocks with the frame off the screen", async (ctx) => {
        ctx.skip(environment() !== "safari", "This read is for the real Safari.");
        const result = await read("blocks", async () => {
            await wait(SETTLE_MS);
            const blocks : Array<{ ms : number; endAt : number }> = [];
            for (const [index, ms] of BLOCKS_MS.entries()) {
                block(ms);
                blocks.push({ ms, endAt : performance.now() });
                await wait(BLOCK_GAP_MS + BLOCK_SHIFT_MS * (index + 1));
            }
            return blocks;
        });
        expect(result.blocks).toHaveLength(BLOCKS_MS.length);
    }, 240_000);
});
