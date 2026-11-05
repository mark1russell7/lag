import type { Clock } from "./types.js";

/**
 * A source of the changes of a page that a script can see. A script cannot see a repaint. It sees a change of the
 * document, and an animation that runs. A source must not change the page, because a change is the condition that
 * it reports.
 */
export type PageChangeSource = {
    /** This method calls `onChange` at each change of the document. It gives the function that stops the calls. */
    observe(onChange : () => void) : () => void;
    /** This method gives `true` when an animation of the page runs at this time. */
    animating() : boolean;
};

/** The time since the last change of a page that its source saw. */
export type PageChangeClock = {
    /**
     * This method gives the milliseconds since the last change that the source saw. With no change, it counts from the
     * start of the clock. It gives 0 while an animation runs.
     */
    sinceChangeMs() : number;
    /** This method stops the source. */
    dispose() : void;
};

/**
 * In Safari on macOS, the timers of a page with no repaint go to a grid of 1 s. In 4 rows on macOS CI runners
 * (Safari 26.6.2), a page with no repaint went to the grid after 30 s at the earliest. A real click with no change of
 * the look did not stop it. A throttled step at or above this time since the last change of the page is the idle
 * grid of Safari, not lag. This value is not read on an iPhone.
 */
export const IDLE_GRID_CHANGE_MS = 30_000;

/** This function makes a clock of the changes of `source`. It reads `clock` only at a change and at a call. */
export function createPageChangeClock(source : PageChangeSource, clock : Clock) : PageChangeClock {
    let lastChangeAt = clock.now();
    const stop = source.observe(() => {
        lastChangeAt = clock.now();
    });
    return {
        sinceChangeMs() {
            const now = clock.now();
            if (source.animating()) lastChangeAt = now;
            return Math.max(0, now - lastChangeAt);
        },
        dispose() {
            stop();
        },
    };
}

/** The part of `MutationObserver` that `domPageChanges` uses. */
export type MutationObserverLike = {
    observe(target : unknown, options : {
        subtree : boolean;
        childList : boolean;
        attributes : boolean;
        characterData : boolean;
    }) : void;
    disconnect() : void;
};

/** The constructor of `MutationObserver`, with the part that `domPageChanges` uses. */
export type MutationObserverConstructor = new (callback : () => void) => MutationObserverLike;

/** The part of `document` that `domPageChanges` uses. */
export type ChangeDocument = {
    readonly documentElement : unknown;
    getAnimations?() : readonly { readonly playState : string }[];
};

/**
 * This function gives the changes of a document: a `MutationObserver` of all of its tree, and the running animations
 * of `document.getAnimations()`. It does not see a canvas that draws, a video that plays, a scroll or a change of a
 * style from a hover. The observer changes nothing on the page.
 */
export function domPageChanges(MutationObserver : MutationObserverConstructor, document : ChangeDocument) : PageChangeSource {
    return {
        observe(onChange) {
            const observer = new MutationObserver(onChange);
            observer.observe(document.documentElement, { subtree : true, childList : true, attributes : true, characterData : true });
            return () => observer.disconnect();
        },
        animating() {
            const animations = typeof document.getAnimations === "function" ? document.getAnimations() : [];
            return animations.some((animation) => animation.playState === "running");
        },
    };
}
