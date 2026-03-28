type NoopInstrument = { record(...args : unknown[]) : void };
type NoopObservable = { addCallback(...args : unknown[]) : void };

const noopObservable : NoopObservable = { addCallback() {} };
const noopInstrument : NoopInstrument = { record() {} };

export function createNoopMeter() : {
    createHistogram : (...args : unknown[]) => NoopInstrument;
    createObservableGauge : (...args : unknown[]) => NoopObservable;
} {
    return {
        createHistogram : () => noopInstrument,
        createObservableGauge : () => noopObservable,
    };
}
