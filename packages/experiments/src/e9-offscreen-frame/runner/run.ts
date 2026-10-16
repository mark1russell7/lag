/**
 * Experiment E9: a cross-origin frame that leaves the viewport.
 *
 * A top-level page (127.0.0.1) has a frame of another origin (localhost) at
 * its top. The frame records its animation frames, its idle callbacks, a
 * timer of 100 ms and the notifications of an IntersectionObserver on its
 * documentElement. The runner scrolls the frame out of the viewport for 4 s,
 * and then back. It prints the gaps of each signal and the notifications.
 *
 * Usage: pnpm --filter @lag/experiments e9 [--runs=3]
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, firefox, webkit, type BrowserType } from "playwright";

type FrameLog = {
    frames : number[];
    io : Array<{ t : number; intersecting : boolean }>;
    idle : number[];
    timers : number[];
};

const OFFSCREEN_MS = 4_000;

const FRAME_PAGE = `<!doctype html><html><body style="margin:0;height:300px">frame<script>
window.log = { frames : [], io : [], idle : [], timers : [] };
const t0 = performance.now();
const at = () => Math.round(performance.now() - t0);
function loop() { log.frames.push(at()); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
new IntersectionObserver((entries) => {
    for (const entry of entries) log.io.push({ t : at(), intersecting : entry.isIntersecting });
}).observe(document.documentElement);
if (window.requestIdleCallback) { const idle = () => { log.idle.push(at()); requestIdleCallback(idle); }; requestIdleCallback(idle); }
setInterval(() => log.timers.push(at()), 100);
addEventListener("message", (event) => { if (event.data === "dump") event.source.postMessage(JSON.stringify(log), "*"); });
</script></body></html>`;

function topPage(framePort : number) : string {
    return `<!doctype html><html><body style="margin:0;height:5000px">
<iframe id="f" src="http://localhost:${framePort}/" style="width:300px;height:300px;border:0"></iframe>
<script>window.dump = () => new Promise((resolve) => {
    addEventListener("message", (event) => resolve(event.data), { once : true });
    document.getElementById("f").contentWindow.postMessage("dump", "*");
});</script></body></html>`;
}

function serve(body : () => string) : Promise<http.Server> {
    return new Promise((resolve) => {
        const server = http.createServer((_request, response) => {
            response.setHeader("content-type", "text/html");
            response.end(body());
        });
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

/** The gaps between two values of `times` that are longer than `minGapMs`, with the time of their start. */
function gaps(times : readonly number[], minGapMs : number) : Array<{ at : number; gap : number }> {
    const found : Array<{ at : number; gap : number }> = [];
    for (let index = 1; index < times.length; index++) {
        const gap = times[index]! - times[index - 1]!;
        if (gap > minGapMs) found.push({ at : times[index - 1]!, gap });
    }
    return found;
}

async function measure(type : BrowserType, topPort : number) : Promise<FrameLog & { version : string }> {
    const browser = await type.launch();
    try {
        const page = await browser.newPage({ viewport : { width : 800, height : 600 } });
        await page.goto(`http://127.0.0.1:${topPort}/`);
        await page.waitForTimeout(1_500);
        await page.evaluate("window.scrollTo(0, 3000)");
        await page.waitForTimeout(OFFSCREEN_MS);
        await page.evaluate("window.scrollTo(0, 0)");
        await page.waitForTimeout(1_500);
        const log = JSON.parse(await page.evaluate<string>("window.dump()")) as FrameLog;
        return { ...log, version : browser.version() };
    } finally {
        await browser.close();
    }
}

const runs = Number(process.argv.find(arg => arg.startsWith("--runs="))?.slice("--runs=".length) ?? 1);
const frameServer = await serve(() => FRAME_PAGE);
const framePort = (frameServer.address() as AddressInfo).port;
const topServer = await serve(() => topPage(framePort));
const topPort = (topServer.address() as AddressInfo).port;

try {
    for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]] as const) {
        for (let run = 1; run <= runs; run++) {
            const log = await measure(type, topPort);
            console.log(JSON.stringify({
                engine : name,
                run,
                version : log.version,
                animationFrames : { count : log.frames.length, gapsOver100Ms : gaps(log.frames, 100) },
                intersectionObserver : log.io,
                idleCallbacks : { count : log.idle.length, gapsOver200Ms : gaps(log.idle, 200) },
                timer100Ms : { gapsOver250Ms : gaps(log.timers, 250) },
            }));
        }
    }
} finally {
    frameServer.close();
    topServer.close();
}
