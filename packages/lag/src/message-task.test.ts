import { describe, it, expect, vi } from "vitest";
import { createMessageTaskQueue } from "./message-task.js";
import type { MessageChannelConstructor, MessagePortLike } from "./SchedulingFairnessMonitor.js";

/** A channel whose messages wait until `deliverAll()`, as tasks do. */
function createChannel() {
    const pending : Array<() => void> = [];
    const closed = vi.fn();
    class Channel {
        readonly port1 : MessagePortLike = { postMessage : () => {}, onmessage : null, close : closed };
        readonly port2 : MessagePortLike = {
            postMessage : () => {
                pending.push(() => (this.port1.onmessage as (() => void) | null)?.());
            },
            onmessage : null,
            close : closed,
        };
    }
    return {
        Channel : Channel as unknown as MessageChannelConstructor,
        closed,
        deliverAll() { for (const deliver of pending.splice(0)) deliver(); },
    };
}

describe("createMessageTaskQueue", () => {
    it("runs the callbacks later, in the sequence in which they were posted", () => {
        const channel = createChannel();
        const queue = createMessageTaskQueue(channel.Channel);
        const order : number[] = [];

        queue.post(() => order.push(1));
        queue.post(() => order.push(2));
        expect(order).toEqual([]);

        channel.deliverAll();
        expect(order).toEqual([1, 2]);
    });

    it("drops the callbacks that did not run when it closes, and closes the ports", () => {
        const channel = createChannel();
        const queue = createMessageTaskQueue(channel.Channel);
        const callback = vi.fn();

        queue.post(callback);
        queue.close();
        channel.deliverAll();

        expect(callback).not.toHaveBeenCalled();
        expect(channel.closed).toHaveBeenCalledTimes(2);
    });
});
