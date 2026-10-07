/** Mermaid diagrams for the concept pages. */

/** A simplified event loop: one task, then all microtasks, then sometimes a frame. */
export const eventLoopChart = `
flowchart LR
    task["Run one task"] --> micro["Run all microtasks"]
    micro --> check{"Time for a frame?"}
    check -- "yes" --> frame["Animation frame callbacks,<br/>style, layout, paint"]
    check -- "no" --> task
    frame --> task
`;

/**
 * The states of LifecycleStateMachine (packages/lag/src/LifecycleStateMachine.ts).
 * A simplified view: pagehide can start from any state.
 */
export const lifecycleChart = `
stateDiagram-v2
    direction LR
    [*] --> active
    active --> passive: blur
    passive --> active: focus
    active --> hidden: visibilitychange
    passive --> hidden: visibilitychange
    hidden --> active: visibilitychange
    hidden --> frozen: freeze
    frozen --> hidden: resume
    frozen --> active: pageshow (persisted)
    hidden --> terminated: pagehide
    terminated --> [*]
`;
