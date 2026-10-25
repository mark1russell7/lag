/**
 * The static server of the builds. It listens on 127.0.0.1 at a free port.
 * Each response has `Cache-Control: no-store`, thus each fetch of the page
 * goes to the server. The server answers the OTLP path of the page with 204
 * and counts the requests.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { OTLP_PATH } from "../shared/types.js";

const CONTENT_TYPES : Readonly<Record<string, string>> = {
    ".html" : "text/html; charset=utf-8",
    ".js" : "text/javascript; charset=utf-8",
    ".json" : "application/json",
    ".css" : "text/css",
};

export type StaticServer = {
    origin : string;
    otlpRequests() : number;
    close() : Promise<void>;
};

export async function serveDirectory(root : string) : Promise<StaticServer> {
    let otlp = 0;
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith(OTLP_PATH)) {
            otlp++;
            request.resume();
            response.writeHead(204).end();
            return;
        }
        let pathname : string;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            // A malformed escape, for example "%E0", gets 400. It does not stop the server.
            response.writeHead(400).end();
            return;
        }
        const file = path.join(root, pathname);
        // The file must be in the root. A sibling folder whose name starts with the name of the root is not in the root.
        const relative = path.relative(root, file);
        const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
        if (outside || !existsSync(file) || !statSync(file).isFile()) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            "Content-Type" : CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
            "Cache-Control" : "no-store",
        });
        createReadStream(file).pipe(response);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("The server has no port.");
    return {
        origin : `http://127.0.0.1:${address.port}`,
        otlpRequests : () => otlp,
        close : () => new Promise<void>((resolve, reject) => {
            server.closeAllConnections();
            server.close(error => (error ? reject(error) : resolve()));
        }),
    };
}
