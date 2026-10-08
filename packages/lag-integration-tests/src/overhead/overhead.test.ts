import { expect } from "vitest";
import { createNoopMeter, setupAllMonitors } from "@lag/core";
import { createLagWorker } from "@lag/worker";
import { cdp, recordBudget, recordMeasurement } from "../commands.js";
import { countWorkerMessages, createBrowserDeps, createRecordingLogger, createTeeMeter, createTimerAccounting, median, wait } from "../harness.js";

/**
 * The cost of the monitors on an idle page, from the main-thread metrics of
 * the renderer (CDP Performance.getMetrics): TaskDuration is the time of all
 * main-thread tasks, ScriptDuration the time in JavaScript. The test frame
 * shares the renderer and the main thread with the Vitest page, so the
 * baseline (the same page without monitors) includes Vitest itself.
 *
 * Each round measures a 10 s window without monitors, then a 10 s window
 * with setupAllMonitors(createBrowserDeps(window, ...)) and a worker, with
 * the default options. The second window starts 6 s after the setup, after
 * the one-time work (the clock synchronization, and the clock resolution
 * check at 5 s).
 */

const WINDOW_MS = 10_000;
const SETTLE_MS = 6_000;
const ROUNDS = 3;

/**
 * The CPU budget: 3 % of one core (30 ms each second). Three loops cost
 * almost all of it (measured alone, TaskDuration, Chromium on a desktop
 * CPU): DriftLag's chain of 5 ms timers 11 ms/s, FrameTimingMonitor's
 * requestAnimationFrame loop 14 ms/s (the page then renders each frame),
 * IdleAvailabilityMonitor 3 ms/s. All monitors together: 22 to 25 ms/s
 * (2.2 % to 2.5 %; the loops share frames). The limit is the largest round
 * plus 20 % for the variation between runs. A new loop, or a loop that does
 * more work in each callback, exceeds it.
 */
const CPU_BUDGET_PERCENT = 3;

/**
 * The timer budget: a 5 ms chain fires at most 1000 / 5 = 200 times each
 * second (R3, clocks and timers research: "5 ms chains mean about 200
 * wake-ups each second"). The other timer monitors add less than 10 each
 * second. More than 210 shows a new high-frequency timer or a shorter step.
 */
const TIMER_BUDGET_PER_SECOND = 210;

/**
 * The wake-up budget: the timer budget, plus one animation frame and one
 * idle callback for each frame at 60 Hz, plus 10 for the messages (the
 * scheduling probes and the worker heartbeat, about 2 each second).
 */
const WAKE_UP_BUDGET_PER_SECOND = TIMER_BUDGET_PER_SECOND + 60 + 60 + 10;

type Window = { taskMsPerS : number; scriptMsPerS : number; seconds : number };

async function measureWindow() : Promise<Window> {
    const before = await cdp.getPerformanceMetrics();
    const start = performance.now();
    await wait(WINDOW_MS);
    const after = await cdp.getPerformanceMetrics();
    const seconds = (performance.now() - start) / 1_000;
    return {
        taskMsPerS : ((after["TaskDuration"]! - before["TaskDuration"]!) * 1_000) / seconds,
        scriptMsPerS : ((after["ScriptDuration"]! - before["ScriptDuration"]!) * 1_000) / seconds,
        seconds,
    };
}

describe("The overhead of all monitors on an idle page", () => {
    it("stays in the CPU and timer budgets", async () => {
        const baseline : Window[] = [];
        const monitored : Window[] = [];
        const callbacks : Array<Record<string, number>> = [];
        await wait(2_000);

        for (let round = 0; round < ROUNDS; round++) {
            baseline.push(await measureWindow());

            const accounting = createTimerAccounting();
            const worker = countWorkerMessages(createLagWorker());
            const handles = setupAllMonitors(createBrowserDeps({
                logger : createRecordingLogger(),
                meter : createTeeMeter(createNoopMeter()).meter,
                worker : worker.worker,
            }, accounting.globals));
            try {
                await wait(SETTLE_MS);
                accounting.resetCounts();
                worker.reset();
                const window = await measureWindow();
                monitored.push(window);
                const counts = accounting.counts();
                callbacks.push({
                    timers : (counts.timeouts + counts.intervals) / window.seconds,
                    animationFrames : counts.animationFrames / window.seconds,
                    idleCallbacks : counts.idleCallbacks / window.seconds,
                    messages : counts.messages / window.seconds,
                    workerMessages : worker.count() / window.seconds,
                });
            } finally {
                handles.stop();
                worker.worker.terminate();
            }
            await wait(1_000);
        }

        const baseTask = median(baseline.map(w => w.taskMsPerS));
        const monitorTask = median(monitored.map(w => w.taskMsPerS));
        const baseScript = median(baseline.map(w => w.scriptMsPerS));
        const monitorScript = median(monitored.map(w => w.scriptMsPerS));
        const taskOverheadMsPerS = monitorTask - baseTask;
        const scriptOverheadMsPerS = monitorScript - baseScript;
        // ms of CPU each second / 1000 ms = the fraction of one core
        const taskOverheadPercent = taskOverheadMsPerS / 10;
        const timersPerS = median(callbacks.map(c => c["timers"]!));
        const rate = (name : string) : number => median(callbacks.map(c => c[name]!));

        console.log(`Overhead: TaskDuration ${baseTask.toFixed(2)} -> ${monitorTask.toFixed(2)} ms/s (+${taskOverheadMsPerS.toFixed(2)} ms/s = ${taskOverheadPercent.toFixed(2)} % of one core); ` +
            `ScriptDuration ${baseScript.toFixed(2)} -> ${monitorScript.toFixed(2)} ms/s (+${scriptOverheadMsPerS.toFixed(2)} ms/s); ` +
            `callbacks/s: timers ${timersPerS.toFixed(1)}, animation frames ${rate("animationFrames").toFixed(1)}, idle ${rate("idleCallbacks").toFixed(1)}, ` +
            `messages ${rate("messages").toFixed(1)}, worker messages ${rate("workerMessages").toFixed(1)}`);

        const labels = (condition : string) => ({ condition });
        await recordMeasurement("overhead/baseline/main_thread_task_ms_per_s", "ms/s", baseline.map(w => w.taskMsPerS), labels("baseline"));
        await recordMeasurement("overhead/monitors/main_thread_task_ms_per_s", "ms/s", monitored.map(w => w.taskMsPerS), labels("monitors"));
        await recordMeasurement("overhead/baseline/main_thread_script_ms_per_s", "ms/s", baseline.map(w => w.scriptMsPerS), labels("baseline"));
        await recordMeasurement("overhead/monitors/main_thread_script_ms_per_s", "ms/s", monitored.map(w => w.scriptMsPerS), labels("monitors"));
        const metricNames : Record<string, string> = {
            timers : "timer_callbacks_per_s",
            animationFrames : "animation_frames_per_s",
            idleCallbacks : "idle_callbacks_per_s",
            messages : "message_tasks_per_s",
            workerMessages : "worker_messages_per_s",
        };
        for (const [name, metric] of Object.entries(metricNames)) {
            await recordMeasurement(`overhead/monitors/${metric}`, "callbacks/s", callbacks.map(c => c[name]!), labels("monitors"));
        }
        await recordBudget({ name : "Main-thread CPU of all monitors, idle page, % of one core", unit : "%", value : taskOverheadPercent, limit : CPU_BUDGET_PERCENT });
        await recordBudget({ name : "Main-thread CPU of all monitors, idle page, ms each second", unit : "ms/s", value : taskOverheadMsPerS, limit : CPU_BUDGET_PERCENT * 10 });
        await recordBudget({ name : "Timer callbacks of all monitors each second, idle page", unit : "callbacks/s", value : timersPerS, limit : TIMER_BUDGET_PER_SECOND });
        const wakeUpsPerS = median(callbacks.map(c => c["timers"]! + c["animationFrames"]! + c["idleCallbacks"]! + c["messages"]! + c["workerMessages"]!));
        await recordBudget({ name : "Main-thread wake-ups of all monitors each second, idle page", unit : "wake-ups/s", value : wakeUpsPerS, limit : WAKE_UP_BUDGET_PER_SECOND });

        expect(taskOverheadPercent).toBeLessThanOrEqual(CPU_BUDGET_PERCENT);
        expect(timersPerS).toBeLessThanOrEqual(TIMER_BUDGET_PER_SECOND);
        expect(wakeUpsPerS).toBeLessThanOrEqual(WAKE_UP_BUDGET_PER_SECOND);
        // The monitors operate: DriftLag alone gives more than 60 timer callbacks each second,
        // also with the 15.6 ms tick of Windows (approximately 175 with a 1 ms tick)
        expect(timersPerS).toBeGreaterThan(40);
    });
});
