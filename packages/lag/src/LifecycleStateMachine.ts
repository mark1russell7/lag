/**
 * The state machine of the page lifecycle is the package `page-lifecycle-tracker`
 * (https://github.com/mark1russell7/page-lifecycle-tracker). It came from
 * this module. Other libraries of the page, for example an exporter, can use
 * the same tracker (`getPageLifecycle()`) without a dependency on lag. This
 * module keeps the names of lag for its users.
 */
export {
    PageLifecycle as LifecycleStateMachine,
    getPageLifecycle,
    isVisibleState,
    eventTime,
    summarizeTransitions,
    type LifecycleSummary,
    type LifecycleState,
    type LifecycleTrigger,
    type StateTransition,
    type LifecycleMark,
    type LifecycleListener,
    type LifecycleListenerOptions,
    type LifecycleEventTarget,
    type LifecycleDocument,
    type LifecycleWindow,
    type SubscriberPhase,
    type SubscribeOptions,
} from "page-lifecycle-tracker";
