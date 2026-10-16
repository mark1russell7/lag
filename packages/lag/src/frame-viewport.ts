/**
 * The position of a frame in the viewport of the top-level page. A document
 * in a frame (an iframe) can be off-screen while its `visibilityState` stays
 * `visible`. Then the browser can stop or slow its rendering:
 *
 * - Chromium and WebKit start no `requestAnimationFrame` callback in an
 *   off-screen cross-origin frame.
 * - Firefox starts approximately one callback each second.
 *
 * In these engines, an `IntersectionObserver` on the document of the frame
 * gets a notification when the frame leaves the viewport. It gets one more
 * when the frame comes back (experiment E9).
 */
export type FrameViewport = {
    /** True when the frame intersects the viewport, or before the first notification. */
    isShown() : boolean;
    /** `listener` gets each change. The function that this method gives removes the listener. */
    subscribe(listener : (shown : boolean) => void) : () => void;
};

/** The part of an `IntersectionObserver` entry that the frame viewport reads. */
export type IntersectionEntryLike = {
    readonly isIntersecting : boolean;
};

/** The part of `IntersectionObserver` that the frame viewport uses. */
export type IntersectionObserverInit = new (
    callback : (entries : readonly IntersectionEntryLike[]) => void,
) => {
    observe(target : object) : void;
    disconnect() : void;
};

/**
 * This function makes the frame viewport of `target`, for example the
 * `documentElement` of the document in a frame. The observer has the implicit
 * root: the viewport of the top-level page. It observes only while the frame
 * viewport has listeners.
 */
export function createFrameViewport(IntersectionObserverCtor : IntersectionObserverInit, target : object) : FrameViewport {
    let shown = true;
    const listeners = new Set<(shown : boolean) => void>();
    let observer : InstanceType<IntersectionObserverInit> | undefined;

    const update = (entries : readonly IntersectionEntryLike[]) : void => {
        // The last entry is the newest position
        const entry = entries[entries.length - 1];
        if (!entry || entry.isIntersecting === shown) return;
        shown = entry.isIntersecting;
        for (const listener of [...listeners]) listener(shown);
    };

    return {
        isShown : () => shown,
        subscribe(listener) {
            listeners.add(listener);
            if (!observer) {
                observer = new IntersectionObserverCtor(update);
                observer.observe(target);
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0 || !observer) return;
                observer.disconnect();
                observer = undefined;
                // Without an observer, the position is not known: a new listener starts from "shown"
                shown = true;
            };
        },
    };
}
