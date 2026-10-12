/**
 * The builds of setups A and C use this module in place of
 * `@opentelemetry/context-zone`. It gives the same class, but it does not
 * load zone.js. otel-ts makes a `ZoneContextManager` only for
 * `contextManager: "zone"`.
 */
export { ZoneContextManager } from "@opentelemetry/context-zone-peer-dep";
