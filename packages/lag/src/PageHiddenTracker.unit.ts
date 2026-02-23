import { PageHiddenTracker } from "./PageHiddenTracker.js";

describe('PageHiddenTracker', () => {
    let mockVisibilityState : 'visible' | 'hidden';
    let visibilityChangeListeners : Set<() => void>;

    /**
     * Helper function to simulate visibility state changes
     * Triggers all registered visiblity change listeners
     */
    const setVisibility = (state : 'visible' | 'hidden') => {
        mockVisibilityState = state;
        visibilityChangeListeners.forEach(listener => listener());
    };

    beforeAll(() => {
        Object.defineProperty(global, 'document', {
            value : {
                get visibilityState() {
                    return mockVisibilityState;
                },
                addEventListener : jest.fn((event : string, callback : () => void) {
                    if(event === 'visibilitychange') {
                        visibilityChangeListeners.add(callback);
                    }
                }),
                removeEventListener : jest.fn((event : string, callback : () => void) => {
                    if(event === 'visibilitychange') {
                        visibilityChangeListeners.delete(callback);
                    }
                })
            },
            writable : true,
        })
    });

    beforeEach(() => {
        mockVisibilityState = 'visible';
        visibilityChangeListeners = new Set();
        jest.clearAllMocks();
    });

    describe('initilization', () => {
        it('registers a visibilitychange event listener on construction', () => {
            new PageHiddenTracker();

            expect(document.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

            expect(document.addEventListener).toHaveBeenCalledTimes(1);
        });

        it('detects initial visibility state during construction', () => {
            mockVisibilityState = 'hidden';
            const tracker = new PageHiddenTracker();
            expect(tracker.getAndReset()).toBe(true);
        });

        it('initializes with visible state by default', () => {
            mockVisibilityState = 'visible';
            const tracker = new PageHiddenTracker();
            expect(tracker.getAndReset()).toBe(false);
        });
    });

    describe('visibility tracking', () => {
        it('returns false when page remains continuously visible', () => {
            const tracker = new PageHiddenTracker();
            expect(tracker.getAndReset()).toBe(false);
            expect(tracker.getAndReset()).toBe(false);
        });

        it('detects visibility changes through event listeners', () => {
            const tracker = new PageHiddenTracker();
            setVisibility('hidden');
            expect(tracker.getAndReset()).toBe(true);

            // after reset, page is still hidden, so should return true again
            expect(tracker.getAndReset()).toBe(true);

            setVisibility('visible');
            // First cal still reports it was hidden (before it was rest)
            expect(tracker.getAndReset()).toBe(true);
            // Now that we've reset after the visibility change, it should report false
            expect(tracker.getAndReset()).toBe(false);
        });

        it('latches to true if page becomes hidden at any point during the tracking period', () => {
            const tracker = new PageHiddenTracker();
            setVisibility('hidden');
            setVisibility('visible');
            expect(tracker.getAndReset()).toBe(true);
            expect(tracker.getAndReset()).toBe(false);
        });

        it('tracks multiple hide/show cycles within a single period', () => {
            const tracker = new PageHiddenTracker();
            setVisibility('hidden');
            setVisibility('visible');
            setVisibility('hidden');
            setVisibility('visible');
            expect(tracker.getAndReset()).toBe(true);
            expect(tracker.getAndReset()).toBe(false);
        });


    });

    describe('getAndReset behavior', () => {
        it('resets the hidden state after each call', () => {
            const tracker = new PageHiddenTracker();
            setVisibility('hidden');
            expect(tracker.getAndReset()).toBe(true);
            expect(tracker.getAndReset()).toBe(true);
            setVisibility('visible');
            expect(tracker.getAndReset()).toBe(true);
            expect(tracker.getAndReset()).toBe(false);
        });

        it('starts fresh tracking after reset even if page is currently hidden', () => {
            const tracker = new PageHiddenTracker();
            setVisibility('hidden');
            expect(tracker.getAndReset()).toBe(true);
            expect(tracker.getAndReset()).toBe(true);
        });

        it('handles rapid successive calls correctly', () => {
            const tracker = new PageHiddenTracker();
            setVisibility('hidden');
            expect(tracker.getAndReset()).toBe(true);
            expect(tracker.getAndReset()).toBe(true);
            setVisibility('visible');
            expect(tracker.getAndReset()).toBe(true);
            expect(tracker.getAndReset()).toBe(false);
        });


    });

    describe('edge cases and race conditions', () => {
        it('handles race condition where visibilityState changes before event fires', () => {
            const tracker = new PageHiddenTracker();

            // Manually change state WITHOUT trigger listeners (simulating race condition)
            mockVisibilityState = 'hidden';

            // getAndReset should still detect the hidden state because it checks visibilityState synchronously
            expect(tracker.getAndReset()).toBe(true);

        });

        it('correctly tracks state when event listener is triggered without state change', () => {
            const tracker = new PageHiddenTracker();
            visibilityChangeListeners.forEach(listener => listener());
            expect(tracker.getAndReset()).toBe(false);
        });

        it('handles multiple trackers independently', () => {
            const tracker1 = new PageHiddenTracker();
            const tracker2 = new PageHiddenTracker();

            setVisibility('hidden');

            expect(tracker1.getAndReset()).toBe(true);
            expect(tracker2.getAndReset()).toBe(true);

            expect(tracker1.getAndReset()).toBe(true);
            expect(tracker2.getAndReset()).toBe(true);

            setVisibility('visible');
            setVisibility('hidden');

            expect(tracker1.getAndReset()).toBe(true);
            expect(tracker2.getAndReset()).toBe(true);
        });

        it('detects hidden state both from events and direct state checks', () => {
            const tracker = new PageHiddenTracker();
            setVisibility('hidden');
            expect(tracker.getAndReset()).toBe(true);
            mockVisibilityState = 'hidden';
            expect(tracker.getAndReset()).toBe(true);

            mockVisibilityState = 'visible';
            visibilityChangeListeners.forEach(listener => listener());
            mockVisibilityState = 'hidden';
            expect(tracker.getAndReset()).toBe(true);
        })
    })
})