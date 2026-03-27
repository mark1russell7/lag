const noopObservable = { addCallback() {} };
const noopInstrument = { record() {} };

export function createNoopMeter() {
    return {
        createHistogram: () => noopInstrument,
        createObservableGauge: () => noopObservable,
    };
}
