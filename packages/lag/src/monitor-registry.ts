import type { MonitorHandle } from "./monitor-handle.js";

/**
 * A typed collection of `MonitorHandle` objects, with one stop operation for
 * all of them.
 *
 * The registry is not a dependency injection container or a service
 * locator. It has two properties:
 *
 * - **Stop in LIFO order, with error isolation.** `stopAll()` stops the
 *   handles in the reverse order of registration. It puts each `stop()` call
 *   in a `try`/`catch` block. Thus, an error in one `stop()` does not
 *   prevent the stop of the other handles.
 * - **Lookup by name.** `get<T>(name)` lets a consumer find a monitor by its
 *   name. Thus, the consumer does not keep a reference to each handle.
 *
 * To add a monitor, write one line:
 * `registry.add(createInstrumented...(deps, meter))`. It is not necessary to
 * change a central setup function.
 */
export class MonitorRegistry {
    private handles : MonitorHandle[] = [];

    /** This method registers the handle and gives the same handle back. */
    add<T>(handle : MonitorHandle<T>) : MonitorHandle<T> {
        this.handles.push(handle);
        return handle;
    }

    /**
     * This method stops all registered handles in LIFO order, and then
     * removes them from the registry. If one handle throws an error, the
     * method ignores the error and continues with the next handle.
     */
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

    /**
     * This method finds the first handle with the name. It gives `undefined`
     * if no handle has the name.
     */
    get<T>(name : string) : MonitorHandle<T> | undefined {
        return this.handles.find(h => h.name === name) as MonitorHandle<T> | undefined;
    }

    /** All registered handles, in the order of registration. */
    getAll() : readonly MonitorHandle[] {
        return this.handles;
    }

    /** The number of registered handles. */
    get size() : number {
        return this.handles.length;
    }
}
