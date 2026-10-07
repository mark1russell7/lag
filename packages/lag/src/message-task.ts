import type { MessageChannelConstructor } from "./SchedulingFairnessMonitor.js";

/** Runs callbacks in new tasks. */
export type MessageTaskQueue = {
    /** Runs `callback` in a new task, after the tasks that are in the queue at this time. */
    post(callback : () => void) : void;
    /** Removes the callbacks that did not run, and closes the channel. */
    close() : void;
};

/**
 * Runs callbacks in new tasks through one MessageChannel.
 *
 * A message task has the timer nesting level 0. Thus a `setTimeout(0)`
 * that the callback schedules gets no clamp. A callback of `setInterval` has
 * a nesting level that increases at each repeat, and browsers clamp a
 * timeout from a nesting level above 5 to 4 ms or more. A probe that starts
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
