export type Document = {
    visibilityState : string;
    addEventListener : (event: string, callback: () => void) => void;
}
export class PageHiddenTracker {
    private wasHidden : boolean = false;
    constructor(
        private document : Document
    ){
        this.document.addEventListener('visibilitychange', () => this.update());
        this.update();
    }
    public getAndReset():boolean{
        /**
         * This call prevents a race condition. document.visibilityState
         * is updated synchronously per the spec
         * https://html.spec.whatwg.org/multipage/interaction.html#page-visibility
         * but the visibilitychange event is dispatched asynchronously.
         * Thus if a macrotask is enqueued to report lag ahead of the visibilitychange
         * event, we could miss this and our metrics would be skewed.
         */
        this.update();
        const wasHidden = this.wasHidden;
        this.wasHidden = false;
        this.update();
        return wasHidden;
    }

    private update() : void {
        this.wasHidden ||= this.document.visibilityState === 'hidden';
    }
}