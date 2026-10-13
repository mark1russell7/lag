/**
 * The model of the explainer "one block, four meanings of lag". It
 * simulates one long task on an ideal main thread. Then it calculates the
 * values of four monitors. DriftLag gives the blocked time of its windows,
 * and the worker gives the wait of its heartbeats. Frame timing gives the
 * gap between two frames, and Event Timing gives the latency of a click.
 * The function is pure, and it makes no load.
 *
 * The main thread does one task at a time, in the sequence in which the
 * tasks entered the queue. A rendering opportunity is not a task: the
 * browser presents a frame only at an opportunity at which no task runs.
 */

/** The fixed values of the example. The times are in ms. */
export type FourLagsSettings = {
    /** The length of the time axis. */
    readonly axisMs : number;
    /** The time between two rendering opportunities: 16.7 ms at 60 Hz. */
    readonly frameIntervalMs : number;
    /** The idle length of one DriftLag window. */
    readonly driftWindowMs : number;
    /** The timeout of one DriftLag step. */
    readonly driftStepMs : number;
    /** The time between two heartbeats of the worker. */
    readonly heartbeatIntervalMs : number;
    /** The time of the first heartbeat. The clock of the worker does not align with the windows. */
    readonly heartbeatOffsetMs : number;
    /** The duration of the event handlers of the click. */
    readonly handlerMs : number;
    /** The INP thresholds of web-vitals: at or below `good` is good, above `poor` is poor. */
    readonly inp : { readonly good : number; readonly poor : number };
};

export const FOUR_LAGS_SETTINGS : FourLagsSettings = {
    axisMs : 1000,
    frameIntervalMs : 1000 / 60,
    driftWindowMs : 100,
    driftStepMs : 5,
    heartbeatIntervalMs : 100,
    heartbeatOffsetMs : 40,
    handlerMs : 12,
    inp : { good : 200, poor : 500 },
};

/** What the reader sets. The times are in ms from the start of the axis. */
export type FourLagsInput = {
    readonly taskStartMs : number;
    readonly taskDurationMs : number;
    /** The time of the click, or `undefined` when nobody clicks. */
    readonly clickMs : number | undefined;
};

export type Interval = { readonly start : number; readonly end : number };

/** A task of the main thread. `queued` is the time at which it entered the task queue. */
export type BusyPeriod = Interval & { readonly queued : number; readonly kind : "task" | "handler" };

/** One rendering opportunity. A busy main thread misses it. */
export type FrameSlot = { readonly time : number; readonly presented : boolean };

/** One DriftLag window: 20 steps of 5 ms. Its lag is its duration minus 100 ms. */
export type DriftWindow = Interval & { readonly lagMs : number };

/** One heartbeat of the worker: the time that the worker sent it, and the time that the main thread processed it. */
export type Heartbeat = { readonly sent : number; readonly processed : number; readonly waitMs : number };

export type Rating = "good" | "needs-improvement" | "poor";

/** The click: its three phases, as Event Timing gives them. */
export type ClickResult = {
    readonly time : number;
    readonly handlerStart : number;
    readonly handlerEnd : number;
    /** The time of the first presented frame after the handlers. */
    readonly paint : number;
    readonly inputDelayMs : number;
    readonly processingMs : number;
    readonly presentationMs : number;
    readonly durationMs : number;
    readonly rating : Rating;
};

export type FourLagsResult = {
    readonly settings : FourLagsSettings;
    /** The long task. It starts after the handlers of a click that came before it. */
    readonly task : Interval;
    /** The tasks of the main thread, sorted by their start: the long task and the handlers of the click. */
    readonly busy : readonly BusyPeriod[];
    readonly frames : readonly FrameSlot[];
    /** The longest time between two presented frames, and the frames that it drops. */
    readonly frameGap : Interval & { readonly ms : number; readonly dropped : number };
    readonly windows : readonly DriftWindow[];
    /** Blocked time in a window: the sum of the lag of the windows. */
    readonly blockedMs : number;
    /** The number of windows with lag. */
    readonly lateWindows : number;
    readonly heartbeats : readonly Heartbeat[];
    /** Queueing delay: the longest wait of a heartbeat. */
    readonly longestWaitMs : number;
    readonly waitingHeartbeats : number;
    /** The mean wait of a message that comes at a random time on the axis. */
    readonly meanWaitMs : number;
    /** Input latency: the click, or `undefined` when nobody clicks. */
    readonly click : ClickResult | undefined;
};

export function rateInp(durationMs : number, thresholds : FourLagsSettings["inp"]) : Rating {
    if (durationMs <= thresholds.good) return "good";
    if (durationMs <= thresholds.poor) return "needs-improvement";
    return "poor";
}

/**
 * The time at which a task that enters the queue at `time` starts. It waits
 * for the task that runs, and for each task that entered the queue before
 * it. The periods are sorted by their start.
 */
export function startOf(busy : readonly BusyPeriod[], time : number) : number {
    let free = time;
    for (const period of busy) {
        if (period.queued > time) continue;
        if (free >= period.start && free < period.end) free = period.end;
    }
    return free;
}

/** True when the main thread does no task at `time`. */
export function isIdle(busy : readonly BusyPeriod[], time : number) : boolean {
    return busy.every(period => time < period.start || time >= period.end);
}

/** The first rendering opportunity at `time` or later. */
export function nextFrame(time : number, frameIntervalMs : number) : number {
    // A small tolerance: 3 × 16.666… is a frame time, not the time before it. The "+ 0" changes −0 to 0.
    return Math.ceil(time / frameIntervalMs - 1e-9) * frameIntervalMs + 0;
}

/**
 * The rendering opportunities on the axis. The browser presents a frame at
 * each opportunity at which no task runs. Thus the first opportunity after
 * a long task presents the next frame.
 */
export function frameSlots(busy : readonly BusyPeriod[], settings : FourLagsSettings) : FrameSlot[] {
    const slots : FrameSlot[] = [];
    for (let index = 0; index * settings.frameIntervalMs <= settings.axisMs; index++) {
        const time = index * settings.frameIntervalMs;
        slots.push({ time, presented : isIdle(busy, time) });
    }
    return slots;
}

/** The longest gap between two presented frames. A gap of n frame intervals drops n − 1 frames. */
export function longestFrameGap(slots : readonly FrameSlot[], frameIntervalMs : number) : FourLagsResult["frameGap"] {
    let best = { start : 0, end : frameIntervalMs, ms : frameIntervalMs, dropped : 0 };
    let previous : number | undefined;
    for (const slot of slots) {
        if (!slot.presented) continue;
        if (previous !== undefined && slot.time - previous > best.ms + 1e-6) {
            const ms = slot.time - previous;
            best = { start : previous, end : slot.time, ms, dropped : Math.max(0, Math.round(ms / frameIntervalMs) - 1) };
        }
        previous = slot.time;
    }
    return best;
}

/**
 * DriftLag chains timeouts of 5 ms. A window has 20 steps. A step that is
 * due while a task runs starts after that task. Thus the window takes
 * longer than 100 ms, and the difference is its lag.
 */
export function driftWindows(busy : readonly BusyPeriod[], settings : FourLagsSettings) : DriftWindow[] {
    const steps = Math.round(settings.driftWindowMs / settings.driftStepMs);
    const windows : DriftWindow[] = [];
    let start = 0;
    while (start < settings.axisMs) {
        let time = start;
        for (let step = 0; step < steps; step++) time = startOf(busy, time + settings.driftStepMs);
        windows.push({ start, end : time, lagMs : time - start - settings.driftWindowMs });
        start = time;
    }
    return windows;
}

/** The worker sends a heartbeat each 100 ms. The message waits in the task queue while the main thread is busy. */
export function heartbeats(busy : readonly BusyPeriod[], settings : FourLagsSettings) : Heartbeat[] {
    const result : Heartbeat[] = [];
    for (let sent = settings.heartbeatOffsetMs; sent < settings.axisMs; sent += settings.heartbeatIntervalMs) {
        const processed = startOf(busy, sent);
        result.push({ sent, processed, waitMs : processed - sent });
    }
    return result;
}

/** The step of the integration of `meanRandomWait`, in ms. */
const WAIT_STEP_MS = 0.25;

/** The mean wait of a message that comes at a random time on the axis. */
export function meanRandomWait(busy : readonly BusyPeriod[], axisMs : number) : number {
    if (axisMs <= 0) return 0;
    let sum = 0;
    let count = 0;
    for (let time = WAIT_STEP_MS / 2; time < axisMs; time += WAIT_STEP_MS) {
        sum += startOf(busy, time) - time;
        count++;
    }
    return sum / count;
}

/** This function simulates the example and calculates the four quantities. */
export function fourLags(input : FourLagsInput, settings : FourLagsSettings = FOUR_LAGS_SETTINGS) : FourLagsResult {
    const duration = Math.max(0, input.taskDurationMs);
    const click = input.clickMs;
    let task : BusyPeriod = { start : input.taskStartMs, end : input.taskStartMs + duration, queued : input.taskStartMs, kind : "task" };
    let handler : BusyPeriod | undefined;

    if (click !== undefined) {
        if (click < task.start) {
            // The handlers start at once. The long task cannot start in the middle of them, thus it can wait.
            handler = { start : click, end : click + settings.handlerMs, queued : click, kind : "handler" };
            if (handler.end > task.start) task = { ...task, start : handler.end, end : handler.end + duration };
        } else {
            const start = click < task.end ? task.end : click;
            handler = { start, end : start + settings.handlerMs, queued : click, kind : "handler" };
        }
    }

    const busy = [task, ...(handler ? [handler] : [])]
        .filter(period => period.end > period.start)
        .sort((a, b) => a.start - b.start);
    const frames = frameSlots(busy, settings);
    const windows = driftWindows(busy, settings);
    const beats = heartbeats(busy, settings);
    const late = windows.filter(window => window.lagMs > 1e-6);

    let clickResult : ClickResult | undefined;
    if (click !== undefined && handler) {
        // The paint of the click is the first presented frame after its handlers. A task that starts first delays it.
        const paint = frames.find(slot => slot.presented && slot.time >= handler.end - 1e-9)?.time
            ?? nextFrame(Math.max(handler.end, ...busy.map(period => period.end)), settings.frameIntervalMs);
        const durationMs = paint - click;
        clickResult = {
            time : click,
            handlerStart : handler.start,
            handlerEnd : handler.end,
            paint,
            inputDelayMs : handler.start - click,
            processingMs : handler.end - handler.start,
            presentationMs : paint - handler.end,
            durationMs,
            rating : rateInp(durationMs, settings.inp),
        };
    }

    return {
        settings,
        task : { start : task.start, end : task.end },
        busy,
        frames,
        frameGap : longestFrameGap(frames, settings.frameIntervalMs),
        windows,
        blockedMs : late.reduce((sum, window) => sum + window.lagMs, 0),
        lateWindows : late.length,
        heartbeats : beats,
        longestWaitMs : beats.reduce((longest, beat) => Math.max(longest, beat.waitMs), 0),
        waitingHeartbeats : beats.filter(beat => beat.waitMs > 0).length,
        meanWaitMs : meanRandomWait(busy, settings.axisMs),
        click : clickResult,
    };
}
