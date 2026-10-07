/**
 * Lag generators: the workloads that make different *types* of main-thread
 * pressure. They are different from distributions, which describe only "how
 * much".
 *
 * Each generator gives a `Promise<void>` that resolves when the lag event is
 * complete, with all deferred work.
 */
export type LagGenerator = (durationMs : number) => Promise<void>;

const wait = (ms : number) : Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

// ─── 1. Sync busy-wait ──────────────────────────────────────────────────────

/**
 * Pure CPU blocking with a busy loop. The generator blocks the main thread
 * for `durationMs` of elapsed time. This is the gold standard to trigger lag
 * monitors.
 */
export const syncBusyWait : LagGenerator = (durationMs) => {
    return new Promise<void>((resolve) => {
        const start = performance.now();
        while (performance.now() - start < durationMs) {
            // burn CPU — no early exit
        }
        resolve();
    });
};

// ─── 2. Sync busy-wait with computation (defeats optimizer) ─────────────────

/**
 * The same as `syncBusyWait`, but it does math that the optimizer cannot
 * remove. Some JIT engines can remove an empty busy loop. This version
 * forces real work.
 */
export const syncCompute : LagGenerator = (durationMs) => {
    return new Promise<void>((resolve) => {
        const start = performance.now();
        let acc = 0;
        let i = 0;
        while (performance.now() - start < durationMs) {
            acc += Math.sin(i) * Math.cos(i);
            i++;
        }
        // Reference acc so the optimizer can't dead-code it
        if (acc === Number.POSITIVE_INFINITY) console.log("impossible");
        resolve();
    });
};

// ─── 3. GC pressure ─────────────────────────────────────────────────────────

/**
 * This generator allocates large numbers of short-lived objects to make GC
 * pressure. GC pauses appear as sudden spikes in lag measurements. Use this
 * generator to exercise `GCSignalDetector`.
 *
 * The generator uses `durationMs` as a budget: it allocates as much garbage
 * as it can in that window.
 */
export const gcPressure : LagGenerator = (durationMs) => {
    return new Promise<void>((resolve) => {
        const start = performance.now();
        const garbage : unknown[] = [];
        while (performance.now() - start < durationMs) {
            // Allocate ~10KB chunks of arrays-of-objects, then drop refs
            const chunk = new Array(100);
            for (let i = 0; i < 100; i++) {
                chunk[i] = { a : Math.random(), b : new Array(10).fill(0), c : "x" };
            }
            garbage.push(chunk);
            if (garbage.length > 50) garbage.length = 0; // periodically free
        }
        resolve();
    });
};

// ─── 4. Microtask flood ─────────────────────────────────────────────────────

/**
 * This generator queues `count` microtasks, one after the other. Microtasks
 * operate between macrotasks, and too many microtasks starve the macrotask
 * queue. Each microtask does a little work, so that the scheduling cost is
 * measurable.
 */
export function microtaskFlood(count : number) : LagGenerator {
    return () => new Promise<void>((resolve) => {
        let remaining = count;
        const tick = () : void => {
            // Tiny work
            const v = Math.sqrt(remaining);
            if (v < 0) console.log("impossible");
            remaining--;
            if (remaining > 0) {
                queueMicrotask(tick);
            } else {
                resolve();
            }
        };
        queueMicrotask(tick);
    });
}

// ─── 5. Macrotask flood ─────────────────────────────────────────────────────

/**
 * This generator queues `count` `setTimeout(0)` macrotasks, one after the
 * other. Each one yields to the event loop. The generator stresses
 * `MacrotaskLag` and makes a measurable scheduling delay.
 */
export function macrotaskFlood(count : number) : LagGenerator {
    return () => new Promise<void>((resolve) => {
        let remaining = count;
        const tick = () : void => {
            const v = Math.sqrt(remaining);
            if (v < 0) console.log("impossible");
            remaining--;
            if (remaining > 0) {
                setTimeout(tick, 0);
            } else {
                resolve();
            }
        };
        setTimeout(tick, 0);
    });
}

// ─── 6. Promise chain ───────────────────────────────────────────────────────

/**
 * A chain of promise resolutions: a microtask chain through `Promise.then`.
 * It is a little different from `queueMicrotask`: each `.then` queues a
 * microtask, but it also makes a new `Promise` object.
 */
export function promiseChain(length : number) : LagGenerator {
    return () => {
        let p : Promise<unknown> = Promise.resolve();
        for (let i = 0; i < length; i++) {
            p = p.then(() => {
                const v = Math.sqrt(i);
                if (v < 0) console.log("impossible");
            });
        }
        return p as Promise<void>;
    };
}

// ─── 7. Layout thrashing ────────────────────────────────────────────────────

/**
 * This generator forces a synchronous recalculation of layout and style,
 * with alternate reads and writes on the DOM. This pattern is notoriously
 * expensive. It can make long animation frame entries with
 * `forcedStyleAndLayoutDuration > 0`.
 */
export const layoutThrash : LagGenerator = (durationMs) => {
    return new Promise<void>((resolve) => {
        const el = document.body;
        const start = performance.now();
        let i = 0;
        while (performance.now() - start < durationMs) {
            // Read forces layout
            const w = el.offsetWidth;
            // Write invalidates layout
            el.style.paddingLeft = `${(i % 5)}px`;
            // Read forces layout again — now we're in a thrash
            const h = el.offsetHeight;
            if (w + h < 0) console.log("impossible");
            i++;
        }
        // Reset styling so we don't leak visual state
        el.style.paddingLeft = "";
        resolve();
    });
};

// ─── 8. Long animation frame ────────────────────────────────────────────────

/**
 * This generator schedules a `requestAnimationFrame` callback that does
 * `durationMs` of work in the production phase of the frame. The browser
 * then reports a long animation frame entry. Its `blockingDuration` is
 * approximately the work time minus 50 ms, because the blocking duration of
 * a long task is its duration minus 50 ms.
 */
export function longAnimationFrame(durationMs : number) : LagGenerator {
    return () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            const start = performance.now();
            let acc = 0;
            while (performance.now() - start < durationMs) {
                acc += Math.sin(start);
            }
            if (acc === Number.POSITIVE_INFINITY) console.log("impossible");
            resolve();
        });
    });
}

// ─── 9. Sleep / yield ───────────────────────────────────────────────────────

/**
 * An idle period: the generator yields the event loop for `durationMs`. Use
 * it to space out the lag events in workload sequences.
 */
export const sleep : LagGenerator = (durationMs) => wait(durationMs);
