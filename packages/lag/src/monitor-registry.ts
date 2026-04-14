import type { MonitorHandle } from "./monitor-handle.js";

/**
 * Typed collection of MonitorHandles with unified teardown.
 *
 * Not a DI container or service locator — just a simple registry with two
 * properties:
 *
 *   1. **LIFO teardown with error isolation.** `stopAll()` stops handles in
 *      reverse order of registration, wrapping each in try/catch so one bad
 *      stop() doesn't prevent others from tearing down.
 *
 *   2. **Named lookup.** `get<T>(name)` lets consumers find a specific
 *      monitor by name instead of tracking handles manually.
 *
 * Adding a new monitor is a one-liner: `registry.add(createInstrumented...(deps, meter))`.
 * No modifications to any god function required.
 */
export class MonitorRegistry {
    private handles : MonitorHandle[] = [];

    /** Register a handle; returns it unchanged for chaining. */
    add<T>(handle : MonitorHandle<T>) : MonitorHandle<T> {
        this.handles.push(handle);
        return handle;
    }

    /** Stop all registered handles in LIFO order; errors are swallowed per-handle. */
    stopAll() : void {
        for (let i = this.handles.length - 1; i >= 0; i--) {
            try {
                this.handles[i]!.stop();
            } catch {
                // swallow — don't let one bad stop() prevent others
            }
        }
        this.handles = [];
    }

    /** Look up a handle by its name. Returns undefined if not found. */
    get<T>(name : string) : MonitorHandle<T> | undefined {
        return this.handles.find(h => h.name === name) as MonitorHandle<T> | undefined;
    }

    /** All registered handles, in registration order. */
    getAll() : readonly MonitorHandle[] {
        return this.handles;
    }

    /** Number of registered handles. */
    get size() : number {
        return this.handles.length;
    }
}
