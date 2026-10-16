import { describe, expect, it, vi } from "vitest";
import { createFrameViewport, type IntersectionEntryLike, type IntersectionObserverInit } from "./frame-viewport.js";

/** A fake `IntersectionObserver`. `notify` gives entries to the newest observer. */
function createObserverFake() {
    const observers : Array<{ callback : (entries : readonly IntersectionEntryLike[]) => void; observe : ReturnType<typeof vi.fn>; disconnect : ReturnType<typeof vi.fn> }> = [];
    class FakeObserver {
        readonly observe = vi.fn();
        readonly disconnect = vi.fn();
        constructor(readonly callback : (entries : readonly IntersectionEntryLike[]) => void) {
            observers.push(this);
        }
    }
    return {
        Ctor : FakeObserver as unknown as IntersectionObserverInit,
        observers,
        notify(...intersecting : boolean[]) {
            observers[observers.length - 1]!.callback(intersecting.map(isIntersecting => ({ isIntersecting })));
        },
    };
}

describe("createFrameViewport", () => {
    it("is shown before the first notification, and observes the target only while it has listeners", () => {
        const fake = createObserverFake();
        const target = {};
        const viewport = createFrameViewport(fake.Ctor, target);

        expect(viewport.isShown()).toBe(true);
        expect(fake.observers).toHaveLength(0);

        const first = viewport.subscribe(vi.fn());
        const second = viewport.subscribe(vi.fn());
        expect(fake.observers).toHaveLength(1);
        expect(fake.observers[0]!.observe).toHaveBeenCalledWith(target);

        first();
        expect(fake.observers[0]!.disconnect).not.toHaveBeenCalled();
        second();
        expect(fake.observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    });

    it("gives each change to the listeners, and reads the newest entry of a notification", () => {
        const fake = createObserverFake();
        const viewport = createFrameViewport(fake.Ctor, {});
        const listener = vi.fn();
        viewport.subscribe(listener);

        // The first notification of an observer gives the position at once
        fake.notify(true);
        fake.notify(false);
        fake.notify(false);
        fake.notify(false, true);

        expect(listener.mock.calls).toEqual([[false], [true]]);
        expect(viewport.isShown()).toBe(true);
    });

    it("ignores a notification without entries", () => {
        const fake = createObserverFake();
        const viewport = createFrameViewport(fake.Ctor, {});
        const listener = vi.fn();
        viewport.subscribe(listener);

        fake.notify();

        expect(listener).not.toHaveBeenCalled();
    });

    it("starts from shown again with a new observer after the last listener left", () => {
        const fake = createObserverFake();
        const viewport = createFrameViewport(fake.Ctor, {});
        const unsubscribe = viewport.subscribe(vi.fn());
        fake.notify(false);
        expect(viewport.isShown()).toBe(false);

        unsubscribe();
        expect(viewport.isShown()).toBe(true);
        viewport.subscribe(vi.fn());
        expect(fake.observers).toHaveLength(2);
    });

    it("lets a listener unsubscribe another listener during a change", () => {
        const fake = createObserverFake();
        const viewport = createFrameViewport(fake.Ctor, {});
        const second = vi.fn();
        let removeSecond : () => void = () => {};
        viewport.subscribe(() => removeSecond());
        removeSecond = viewport.subscribe(second);

        fake.notify(false);

        // The change goes to the listeners of its start
        expect(second).toHaveBeenCalledWith(false);
        fake.notify(true);
        expect(second).toHaveBeenCalledTimes(1);
    });
});
