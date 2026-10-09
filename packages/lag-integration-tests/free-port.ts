import net from "node:net";

/**
 * The host of the browser API servers. The browsers open `http://127.0.0.1:<port>`.
 * This config imports `@vitest/browser-webdriverio`, and webdriverio sets the
 * DNS order of Node.js to "ipv4first". Without a port of its own, each server
 * listens on 127.0.0.1 at the default port of Vitest (63315 and up). On
 * Windows, another program can listen on the same port at ::1. Then Firefox,
 * which tries 127.0.0.1 first, connects to the wrong server, and test files of
 * the other program get no result.
 */
export const BROWSER_HOST = "127.0.0.1";

/** The addresses that can hold a port of this computer: the two loopback addresses and the two wildcard addresses. */
const ADDRESSES : readonly string[] = ["127.0.0.1", "::1", "0.0.0.0", "::"];

/** Vitest gives the browser servers the ports from 63315 up. Other runs of Vitest use these ports. */
const VITEST_PORTS = { first : 63315, last : 63415 } as const;

/**
 * The maximum number of ports that the search examines. Windows gives the
 * ports of `listen(0)` in a sequence. Thus, the search can pass through all
 * the ports of `VITEST_PORTS` before it gets a port that it can use.
 */
const MAX_ATTEMPTS = 1000;

/**
 * This function listens on a port and an address, and closes the server
 * immediately. It gives the port, or `undefined` if the port is in use. An
 * address that this computer does not have (for example `::1` without IPv6)
 * cannot hold the port, thus the port counts as free on it.
 */
function tryListen(port : number, host : string) : Promise<number | undefined> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (error : NodeJS.ErrnoException) => {
            resolve(error.code === "EADDRINUSE" || error.code === "EACCES" ? undefined : port);
        });
        server.listen(port, host, () => {
            const address = server.address();
            server.close(() => resolve(typeof address === "object" && address !== null ? address.port : undefined));
        });
    });
}

/**
 * This function gives a function that gives a free port at each call: a port
 * that no program uses on a loopback address or a wildcard address, and that
 * an earlier call did not give. The operating system selects the ports, thus
 * two test processes that start at the same time get different ports. Vitest
 * binds each port with `strictPort`. If a different program takes the port
 * first, the run stops with an error. It does not continue on a shared port.
 */
export function freePorts() : () => Promise<number> {
    const given = new Set<number>();
    return async () => {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const port = await tryListen(0, BROWSER_HOST);
            if (port === undefined || given.has(port) || (port >= VITEST_PORTS.first && port <= VITEST_PORTS.last)) {
                continue;
            }
            let free = true;
            for (const host of ADDRESSES) {
                if (await tryListen(port, host) === undefined) {
                    free = false;
                    break;
                }
            }
            if (free) {
                given.add(port);
                return port;
            }
        }
        throw new Error(`No free port for a browser API server after ${MAX_ATTEMPTS} attempts.`);
    };
}
