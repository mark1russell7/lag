import { defineConfig } from "vitest/config";

/** The unit tests of the runners. They operate in Node.js and open no browser. */
export default defineConfig({
    test : {
        environment : "node",
        include : ["src/*/runner/**/*.test.ts"],
    },
});
