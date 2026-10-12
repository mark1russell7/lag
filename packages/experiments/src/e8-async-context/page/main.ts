/**
 * The page of experiment E8. The build replaces `#e8-setup` with the module
 * of one setup. That module loads first. In setup C, it installs the patches
 * of async-browser-context before the other modules load.
 */
import { contextManager, setup } from "#e8-setup";
import { init } from "@mark1russell7/otel-ts";
import { OTLP_PATH } from "../shared/types.js";
import { createE8Page } from "./harness.js";

// Tracing registers the context manager. The page turns off the other parts
// of otel-ts, thus the differences between the setups come from the context.
init({
    serviceName : "lag-e8",
    endpoint : `${location.origin}${OTLP_PATH}`,
    contextManager,
    tracing : true,
    metrics : false,
    logs : false,
    faro : false,
    sessionTracking : false,
    instrumentDocumentLoad : false,
    instrumentFetch : false,
    instrumentXhr : false,
    instrumentUserInteraction : false,
    instrumentLongTask : false,
});

window.e8 = createE8Page(setup, contextManager);
