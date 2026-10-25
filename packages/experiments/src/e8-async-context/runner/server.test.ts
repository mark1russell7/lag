import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveDirectory, type StaticServer } from "./server.js";

describe("serveDirectory", () => {
    let dir : string;
    let server : StaticServer;

    beforeAll(async () => {
        dir = mkdtempSync(path.join(tmpdir(), "lag-e8-server-"));
        mkdirSync(path.join(dir, "measure"));
        mkdirSync(path.join(dir, "measure-other"));
        writeFileSync(path.join(dir, "measure", "index.html"), "<p>root</p>");
        writeFileSync(path.join(dir, "measure-other", "secret.txt"), "secret");
        server = await serveDirectory(path.join(dir, "measure"));
    });

    afterAll(async () => {
        await server.close();
        rmSync(dir, { recursive : true, force : true });
    });

    it("serves a file of the root", async () => {
        const response = await fetch(`${server.origin}/index.html`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("<p>root</p>");
    });

    it("does not serve a file of a sibling folder whose name starts with the name of the root", async () => {
        expect((await fetch(`${server.origin}/..%2Fmeasure-other/secret.txt`)).status).toBe(404);
    });

    it("answers a malformed escape with 400 and continues to serve", async () => {
        expect((await fetch(`${server.origin}/%E0`)).status).toBe(400);
        expect((await fetch(`${server.origin}/index.html`)).status).toBe(200);
    });
});
