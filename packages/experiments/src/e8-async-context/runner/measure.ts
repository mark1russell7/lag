/**
 * One page run of E8: one setup in one engine. A new browser opens for each
 * run, thus no state stays from an earlier run. The runner waits in
 * Node.js, thus the page is idle during the windows.
 *
 * The phases, in this order:
 *
 * 1. The setup alone: a window without the monitors (Chromium: CDP).
 * 2. The setup with `setupAllMonitors` and the worker of lag, after a time
 *    to settle: a window for the CPU (Chromium: CDP) and the idle values of
 *    DriftLag.
 * 3. MacrotaskLag and SchedulingFairnessMonitor with a short interval.
 * 4. Scripted clicks with a fixed handler, and tasks of a fixed duration.
 * 5. The workloads, without the monitors (Chromium: CDP around each one).
 * 6. The context check.
 */
import os from "node:os";
import { chromium, firefox, webkit, type Browser, type CDPSession, type Page } from "playwright";
import { BLOCKING_TASK_MS, CLICK_TARGET, WORKLOAD_NAMES, type E8Page, type SetupId } from "../shared/types.js";
import { median, quantile } from "./stats.js";
import type { Engine, RunResult } from "./summary.js";

/** The durations of the phases. */
export type Timing = {
    settleMs : number;
    windowMs : number;
    monitorSettleMs : number;
    probeWindowMs : number;
    probeIntervalMs : number;
    clicks : number;
    clickGapMs : number;
    blockingTasks : number;
    blockingGapMs : number;
    workloadRepetitions : number;
};

/**
 * The timing of the experiment. The windows are 10 s, as in the overhead
 * benchmark. The monitors settle for 6 s: the clock synchronization and the
 * check of the clock resolution at 5 s are complete then.
 */
export const FULL_TIMING : Timing = {
    settleMs : 2_000,
    windowMs : 10_000,
    monitorSettleMs : 6_000,
    probeWindowMs : 10_000,
    probeIntervalMs : 200,
    clicks : 5,
    clickGapMs : 800,
    blockingTasks : 5,
    blockingGapMs : 700,
    workloadRepetitions : 5,
};

/** A short timing that only examines the harness (`--quick`). Its values are not results. */
export const QUICK_TIMING : Timing = {
    settleMs : 500,
    windowMs : 1_000,
    monitorSettleMs : 1_000,
    probeWindowMs : 1_000,
    probeIntervalMs : 200,
    clicks : 2,
    clickGapMs : 400,
    blockingTasks : 2,
    blockingGapMs : 500,
    workloadRepetitions : 1,
};

type E8Global = { e8 : E8Page };

const sleep = (ms : number) : Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function launch(engine : Engine) : Promise<Browser> {
    // The new headless mode of Chromium (Chrome for Testing), as the overhead benchmark of the integration tests
    if (engine === "chromium") return chromium.launch({ channel : "chromium", headless : true });
    if (engine === "firefox") return firefox.launch({ headless : true });
    return webkit.launch({ headless : true });
}

type MainThread = { taskMs : number; scriptMs : number; seconds : number };

/** `Performance.getMetrics` of the renderer of the page: the main-thread time so far. */
async function mainThread(session : CDPSession) : Promise<MainThread> {
    const { metrics } = await session.send("Performance.getMetrics");
    const value = (name : string) : number => metrics.find(metric => metric.name === name)?.value ?? Number.NaN;
    return { taskMs : value("TaskDuration") * 1_000, scriptMs : value("ScriptDuration") * 1_000, seconds : value("Timestamp") };
}

/** The main-thread time of each second during a window of `ms`. */
async function cpuWindow(session : CDPSession, ms : number) : Promise<{ taskMsPerS : number; scriptMsPerS : number }> {
    const before = await mainThread(session);
    await sleep(ms);
    const after = await mainThread(session);
    const seconds = after.seconds - before.seconds;
    return { taskMsPerS : (after.taskMs - before.taskMs) / seconds, scriptMsPerS : (after.scriptMs - before.scriptMs) / seconds };
}

/** This function adds the median, the 95th percentile and the count of `values` as metrics with the prefix `name`. */
function addDistribution(metrics : Record<string, number>, name : string, values : readonly number[]) : void {
    metrics[`${name}.count`] = values.length;
    if (values.length === 0) return;
    metrics[`${name}.medianMs`] = median(values);
    metrics[`${name}.p95Ms`] = quantile(values, 0.95);
}

export type RunPlan = {
    engine : Engine;
    setup : SetupId;
    round : number;
    position : number;
    url : string;
    timing : Timing;
    otlpRequests : () => number;
};

async function waitForPage(page : Page, url : string) : Promise<void> {
    await page.goto(url, { waitUntil : "load" });
    await page.waitForFunction(() => (globalThis as unknown as Partial<E8Global>).e8?.ready === true);
}

/** The idle time and the total time of all CPUs of the machine so far, in ms. */
function cpuTimes() : { idle : number; total : number } {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        idle += cpu.times.idle;
        total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    return { idle, total };
}

/** This function does one page run. */
export async function measureRun(plan : RunPlan) : Promise<RunResult> {
    const { engine, timing } = plan;
    // The load of the whole machine during the run, also the browser of the run
    const cpuStart = cpuTimes();
    const browser = await launch(engine);
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors : string[] = [];
        page.on("pageerror", error => errors.push(String(error)));
        page.on("console", message => {
            if (message.type() === "error") errors.push(message.text());
        });
        const otlpBefore = plan.otlpRequests();
        await waitForPage(page, plan.url);
        const facts = await page.evaluate(() => (globalThis as unknown as E8Global).e8.facts());
        const session = engine === "chromium" ? await context.newCDPSession(page) : undefined;
        await session?.send("Performance.enable", { timeDomain : "timeTicks" });
        const now = () : Promise<number> => page.evaluate(() => (globalThis as unknown as E8Global).e8.now());
        const metrics : Record<string, number> = {};
        await sleep(timing.settleMs);

        // 1. The setup alone
        if (session) {
            const window = await cpuWindow(session, timing.windowMs);
            metrics["idle.setup.taskMsPerS"] = window.taskMsPerS;
            metrics["idle.setup.scriptMsPerS"] = window.scriptMsPerS;
        }

        // 2. The setup with the monitors
        await page.evaluate(() => (globalThis as unknown as E8Global).e8.startMonitors());
        await sleep(timing.monitorSettleMs);
        const idleSince = await now();
        if (session) {
            const window = await cpuWindow(session, timing.windowMs);
            metrics["idle.monitors.taskMsPerS"] = window.taskMsPerS;
            metrics["idle.monitors.scriptMsPerS"] = window.scriptMsPerS;
        } else {
            await sleep(timing.windowMs);
        }
        const idle = await page.evaluate(since => (globalThis as unknown as E8Global).e8.idleReadings(since), idleSince);
        addDistribution(metrics, "drift", idle.drift);

        // 3. The probes with a short interval
        await page.evaluate(ms => (globalThis as unknown as E8Global).e8.startProbes(ms), timing.probeIntervalMs);
        await sleep(timing.probeWindowMs);
        const probes = await page.evaluate(() => (globalThis as unknown as E8Global).e8.stopProbes());
        addDistribution(metrics, "macrotaskLag", probes.macrotask);
        addDistribution(metrics, "scheduling.microtask", probes.microtask);
        addDistribution(metrics, "scheduling.macrotask", probes.schedulingMacrotask);
        addDistribution(metrics, "scheduling.messageChannel", probes.messageChannel);

        // 4. The clicks and the blocking tasks
        const clickSince = await now();
        for (let i = 0; i < timing.clicks; i++) {
            await page.click(CLICK_TARGET);
            await sleep(timing.clickGapMs);
        }
        const clicks = await page.evaluate(since => (globalThis as unknown as E8Global).e8.clickReadings(since), clickSince);
        if (clicks.lagInpMs !== undefined) metrics["click.lagInpMs"] = clicks.lagInpMs;
        addDistribution(metrics, "click.interaction", clicks.interactionMs);
        addDistribution(metrics, "click.lagEventDuration", clicks.eventDurationMs);

        const blockSince = await now();
        for (let i = 0; i < timing.blockingTasks; i++) {
            await page.evaluate(ms => (globalThis as unknown as E8Global).e8.blockTask(ms), BLOCKING_TASK_MS);
            await sleep(timing.blockingGapMs);
        }
        const loaf = await page.evaluate(since => (globalThis as unknown as E8Global).e8.loafReadings(since), blockSince);
        if (loaf.supported) addDistribution(metrics, "loaf.blocking", loaf.blockingMs);

        await page.evaluate(() => (globalThis as unknown as E8Global).e8.stopMonitors());
        await sleep(500);

        // 5. The workloads: one run to warm up, then the measured runs
        for (const name of WORKLOAD_NAMES) {
            await page.evaluate(workload => (globalThis as unknown as E8Global).e8.runWorkload(workload), name);
            const totals : number[] = [];
            const tasks : number[] = [];
            const scripts : number[] = [];
            for (let i = 0; i < timing.workloadRepetitions; i++) {
                const before = session ? await mainThread(session) : undefined;
                totals.push(await page.evaluate(workload => (globalThis as unknown as E8Global).e8.runWorkload(workload), name));
                if (session && before) {
                    const after = await mainThread(session);
                    tasks.push(after.taskMs - before.taskMs);
                    scripts.push(after.scriptMs - before.scriptMs);
                }
            }
            metrics[`workload.${name}.totalMs`] = median(totals);
            if (tasks.length > 0) {
                metrics[`workload.${name}.taskMs`] = median(tasks);
                metrics[`workload.${name}.scriptMs`] = median(scripts);
            }
        }

        // 6. The context check
        const correctness = await page.evaluate(() => (globalThis as unknown as E8Global).e8.correctness());

        const cpuEnd = cpuTimes();
        metrics["machine.cpuBusyPercent"] = 100 * (1 - (cpuEnd.idle - cpuStart.idle) / (cpuEnd.total - cpuStart.total));

        return {
            engine,
            round : plan.round,
            position : plan.position,
            measuredAt : new Date().toISOString(),
            setup : plan.setup,
            facts,
            metrics,
            loafScripts : loaf.topScripts,
            correctness,
            otlpRequests : plan.otlpRequests() - otlpBefore,
            errors,
        };
    } finally {
        await browser.close();
    }
}
