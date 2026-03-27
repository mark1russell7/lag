import type { Logger } from "./types.js";

export type PageLifecycleDocument = {
    visibilityState : string;
    addEventListener : (event : string, callback : () => void) => void;
};

export type PageLifecycleWindow = {
    addEventListener : (event : string, callback : (event? : { persisted? : boolean }) => void) => void;
};

export type PageLifecycleState = {
    wasHidden : boolean;
    wasFrozen : boolean;
    wasRestored : boolean;
};

export class PageLifecycleTracker {
    private wasHidden = false;
    private wasFrozen = false;
    private wasRestored = false;

    constructor(
        private readonly document : PageLifecycleDocument,
        private readonly window : PageLifecycleWindow,
        private readonly logger : Logger,
    ) {
        this.document.addEventListener("visibilitychange", () => {
            this.updateVisibility();
        });

        this.document.addEventListener("freeze", () => {
            this.wasFrozen = true;
            this.logger.log("info", "Page frozen.", { type : "PageLifecycleTracker" });
        });

        this.document.addEventListener("resume", () => {
            this.logger.log("info", "Page resumed from freeze.", { type : "PageLifecycleTracker" });
        });

        this.window.addEventListener("pageshow", (event) => {
            if (event?.persisted) {
                this.wasRestored = true;
                this.logger.log("info", "Page restored from BFCache.", { type : "PageLifecycleTracker" });
            }
        });

        this.updateVisibility();
    }

    private updateVisibility() : void {
        if (this.document.visibilityState === "hidden") {
            this.wasHidden = true;
        }
    }

    getAndReset() : PageLifecycleState {
        this.updateVisibility();

        const state : PageLifecycleState = {
            wasHidden : this.wasHidden,
            wasFrozen : this.wasFrozen,
            wasRestored : this.wasRestored,
        };

        this.wasHidden = false;
        this.wasFrozen = false;
        this.wasRestored = false;

        this.updateVisibility();

        return state;
    }
}
