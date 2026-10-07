/**
 * Lag generators — the actual workloads that create different *kinds* of
 * main thread pressure. Distinct from distributions, which only describe
 * "how much".
 *
 * Each generator returns a Promise<void> that resolves once the lag event
 * has fully completed (including any deferred work).
 */
export type LagGenerator = (durationMs : number) => Promise<void>;

const wait = (ms : number) : Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

// ─── 1. Sync busy-wait ──────────────────────────────────────────────────────

/**
 * Pure CPU blocking via busy loop. Spends `durationMs` of wall time blocking
 * the main thread. This is the gold standard for triggering lag monitors.
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
 * Same as syncBusyWait but does math the optimizer can't elide. Some JIT
 * engines may optimize away an empty busy loop; this version forces real work.
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
 * Allocates large numbers of short-lived objects to trigger GC pressure.
 * GC pauses appear as sudden spikes in lag measurements — useful for
 * exercising GCSpikeDetector.
 *
 * `durationMs` is interpreted as a budget; the generator allocates as much
 * garbage as it can in that window.
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
 * Queues `count` microtasks back-to-back. Microtasks run between macrotasks
 * and starve the macrotask queue if abused. Each microtask does a tiny bit
 * of work to make the scheduling cost measurable.
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
 * Queues `count` setTimeout(0) macrotasks back-to-back. Each one yields to
 * the event loop. Stresses MacrotaskLag and creates measurable scheduling
 * delay.
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
 * Chained promise resolution — forms a microtask chain via Promise.then.
 * Slightly different from queueMicrotask: each .then enqueues a microtask
 * but also creates a new Promise object.
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
 * Forces synchronous layout/style recalculation by alternating reads and
 * writes on the DOM. This is a notoriously expensive pattern that should
 * trigger LongAnimationFrame entries with `forcedStyleAndLayoutDuration > 0`.
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
 * Schedules a requestAnimationFrame callback that does `durationMs` of work
 * inside the frame production phase. This generates a LoAF entry whose
 * `blockingDuration` matches the work time.
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
 * Idle period — yields the event loop for `durationMs`. Used to space out
 * lag events in workload sequences.
 */
export const sleep : LagGenerator = (durationMs) => wait(durationMs);
