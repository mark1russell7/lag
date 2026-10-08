import type { MessageChannelConstructor } from "./SchedulingFairnessMonitor.js";

/** A function that starts a callback in a new task, for example `createMessageTaskQueue(...).post`. */
export type PostTaskFn = (callback : () => void) => void;

/** A queue that starts each callback in a new task. */
export type MessageTaskQueue = {
    /** This method starts `callback` in a new task, after the tasks that are in the queue at this time. */
    post(callback : () => void) : void;
    /** This method removes the callbacks that did not start, and closes the channel. */
    close() : void;
};

/**
 * This function makes a queue that starts each callback in a new task,
 * through one `MessageChannel`.
 *
 * A message task has the timer nesting level 0. Thus, a `setTimeout(0)`
 * that the callback schedules gets no clamp. A callback of `setInterval` has
 * a nesting level that increases at each repeat. Above the nesting level 5,
 * browsers clamp a timeout to 4 ms or more. A probe that starts
 * `setTimeout(0)` from a message task measures the queue, not the clamp.
 */
export function createMessageTaskQueue(MessageChannelCtor : MessageChannelConstructor) : MessageTaskQueue {
    const channel = new MessageChannelCtor();
    const callbacks : Array<() => void> = [];
    channel.port1.onmessage = () => {
        callbacks.shift()?.();
    };
    channel.port1.start?.();
    return {
        post(callback) {
            callbacks.push(callback);
            channel.port2.postMessage(null);
        },
        close() {
            callbacks.length = 0;
            channel.port1.onmessage = null;
            channel.port1.close?.();
            channel.port2.close?.();
        },
    };
}
