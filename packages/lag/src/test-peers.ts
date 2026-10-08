import type { BroadcastChannelLike, LockManagerLike, PeerHangWatchDeps } from "./PeerHangWatch.js";
import type { Logger } from "./types.js";

type LockRequest = {
    page : SimulatedPage;
    callback : (lock : unknown) => unknown;
    resolve : (value : unknown) => void;
    reject : (error : unknown) => void;
};

type LockState = { holder : LockRequest | undefined; queue : LockRequest[] };

/**
 * The pages of one origin, for the tests of `PeerHangWatch`. The origin has
 * a BroadcastChannel hub and a Web Lock manager with a FIFO queue for each
 * lock name, as a browser has.
 *
 * The tests use the fake timers of Vitest: the pages share the virtual
 * clock and the timer queue. A page can hang (`hang()`). Then its callbacks
 * wait until `recover()`, and its interval callbacks do not start. A page
 * can die (`kill()`), as when the browser stops a hung page. Then its locks
 * come free, and its callbacks do not start at any time.
 */
export class SimulatedOrigin {
    /**
     * The delay of each message. Without it, a message arrives in a
     * microtask. In a browser, a message and a lock use different paths, thus
     * a message can arrive after a lock that the sender released later.
     */
    messageDelayMs = 0;
    private readonly channels = new Set<SimulatedChannel>();
    private readonly lockStates = new Map<string, LockState>();

    page() : SimulatedPage {
        return new SimulatedPage(this);
    }

    /** The number of open channels of a page. */
    openChannels(page : SimulatedPage) : number {
        return [...this.channels].filter(channel => channel.page === page).length;
    }

    /** The names of the locks that a page holds. */
    heldBy(page : SimulatedPage) : string[] {
        return [...this.lockStates.entries()].filter(([, state]) => state.holder?.page === page).map(([name]) => name);
    }

    /** @internal */
    open(channel : SimulatedChannel) : void {
        this.channels.add(channel);
    }

    /** @internal */
    close(channel : SimulatedChannel) : void {
        this.channels.delete(channel);
    }

    /** @internal Each other open channel of the same name gets a copy of the message, in a later task. */
    broadcast(from : SimulatedChannel, data : unknown) : void {
        for (const channel of this.channels) {
            if (channel === from || channel.name !== from.name) continue;
            const copy = structuredClone(data);
            if (this.messageDelayMs > 0) setTimeout(() => channel.deliver(copy), this.messageDelayMs);
            else queueMicrotask(() => channel.deliver(copy));
        }
    }

    /** @internal */
    request(page : SimulatedPage, name : string, options : { ifAvailable? : boolean }, callback : (lock : unknown) => unknown) : Promise<unknown> {
        return new Promise((resolve, reject) => {
            const state = this.lockStates.get(name) ?? { holder : undefined, queue : [] };
            this.lockStates.set(name, state);
            const request : LockRequest = { page, callback, resolve, reject };
            if (options.ifAvailable && (state.holder || state.queue.length > 0)) {
                queueMicrotask(() => page.run(() => this.settle(request, null, undefined)));
                return;
            }
            state.queue.push(request);
            this.grantNext(name);
        });
    }

    /** @internal The browser releases the locks of a page that it stops, and drops its waiting requests. */
    kill(page : SimulatedPage) : void {
        for (const [name, state] of this.lockStates) {
            state.queue = state.queue.filter(request => request.page !== page);
            if (state.holder?.page === page) {
                state.holder = undefined;
                this.grantNext(name);
            }
        }
        for (const channel of [...this.channels]) {
            if (channel.page === page) this.channels.delete(channel);
        }
    }

    private grantNext(name : string) : void {
        const state = this.lockStates.get(name)!;
        if (state.holder) return;
        const next = state.queue.shift();
        if (!next) return;
        state.holder = next;
        queueMicrotask(() => next.page.run(() => this.settle(next, { name, mode : "exclusive" }, name)));
    }

    /** This method starts the callback of a request, and releases the lock when the promise of the callback settles. */
    private settle(request : LockRequest, lock : unknown, name : string | undefined) : void {
        let result : Promise<unknown>;
        try {
            result = Promise.resolve(request.callback(lock));
        } catch (error) {
            result = Promise.reject(error);
        }
        void result.then(request.resolve, request.reject).finally(() => {
            if (name === undefined) return;
            const state = this.lockStates.get(name)!;
            if (state.holder !== request) return;
            state.holder = undefined;
            this.grantNext(name);
        });
    }
}

class SimulatedChannel implements BroadcastChannelLike {
    onmessage : ((event : { readonly data : unknown }) => void) | null = null;
    private closed = false;

    constructor(readonly origin : SimulatedOrigin, readonly page : SimulatedPage, readonly name : string) {
        origin.open(this);
    }

    postMessage(message : unknown) : void {
        if (this.closed) throw new Error("The channel is closed.");
        this.origin.broadcast(this, message);
    }

    deliver(data : unknown) : void {
        this.page.run(() => this.onmessage?.({ data }));
    }

    close() : void {
        this.closed = true;
        this.origin.close(this);
    }
}

/** One page of a `SimulatedOrigin`. */
export class SimulatedPage {
    hung = false;
    dead = false;
    readonly logs : string[] = [];
    /** The attributes of each log line, in the sequence of `logs`. */
    readonly logAttributes : unknown[] = [];
    private deferred : Array<() => void> = [];

    constructor(private readonly origin : SimulatedOrigin) {}

    /** This method starts `task` at once, or after the hang. A dead page starts nothing. */
    run(task : () => void) : void {
        if (this.dead) return;
        if (this.hung) this.deferred.push(task);
        else task();
    }

    hang() : void {
        this.hung = true;
    }

    recover() : void {
        this.hung = false;
        const tasks = this.deferred;
        this.deferred = [];
        for (const task of tasks) this.run(task);
    }

    /** The browser stops the page, for example when the user closes a hung page. */
    kill() : void {
        this.dead = true;
        this.deferred = [];
        this.origin.kill(this);
    }

    /** The dependencies of a `PeerHangWatch` in this page. The timers are the fake timers of Vitest. */
    deps() : PeerHangWatchDeps {
        const origin = this.origin;
        const page = this as SimulatedPage;
        const locks : LockManagerLike = {
            request : (name, options, callback) => origin.request(page, name, options, callback),
        };
        const logger : Logger = {
            log : (level, message, attributes) => {
                this.logs.push(`${level}: ${message}`);
                this.logAttributes.push(attributes);
            },
        };
        return {
            BroadcastChannel : class extends SimulatedChannel {
                constructor(name : string) {
                    super(origin, page, name);
                }
            },
            locks,
            wallClock : { now : () => Date.now() },
            // The simulated pages have one clock: the fake time of Vitest
            clock : { now : () => Date.now() },
            setTimeoutFn : (handler, timeout) => setTimeout(() => this.run(handler), timeout) as unknown as number,
            clearTimeoutFn : (handle) => clearTimeout(handle),
            // A hung page misses the steps of its intervals, as a blocked main thread does
            setIntervalFn : (handler, timeout) => setInterval(() => { if (!this.hung && !this.dead) handler(); }, timeout) as unknown as number,
            clearIntervalFn : (handle) => clearInterval(handle),
            logger,
        };
    }
}
