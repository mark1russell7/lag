/**
 * This module has a Vitest browser command for a WebSocket server in Node.
 * A probe connects to it from a worker, and the server records when each
 * message arrives (`Date.now()`). Thus a test can see if a worker can send
 * while the main thread of its page is blocked.
 */
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { Socket } from "node:net";
import type { BrowserCommand } from "vitest/node";

/** The server of each session, with the arrival times of the messages. */
const servers = new Map<string, { server : Server; sockets : Set<Socket>; arrivals : number[] }>();

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** This command starts a WebSocket server on a free port and gives the port. */
const startProbeSocketServer : BrowserCommand<[]> = async (ctx) => {
    const state = { server : createServer(), sockets : new Set<Socket>(), arrivals : [] as number[] };
    state.server.on("upgrade", (request, socket : Socket) => {
        const key = request.headers["sec-websocket-key"];
        const accept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        state.sockets.add(socket);
        // Each data chunk after the handshake is a frame of the client
        socket.on("data", () => state.arrivals.push(Date.now()));
        socket.on("error", () => {});
    });
    await new Promise<void>(resolve => state.server.listen(0, "127.0.0.1", resolve));
    servers.set(ctx.sessionId, state);
    const address = state.server.address();
    return typeof address === "object" && address ? address.port : 0;
};

/** This command gives the arrival times of the messages (`Date.now()`), and stops the server. */
const stopProbeSocketServer : BrowserCommand<[]> = async (ctx) => {
    const state = servers.get(ctx.sessionId);
    if (!state) return [];
    servers.delete(ctx.sessionId);
    for (const socket of state.sockets) socket.destroy();
    await new Promise<void>(resolve => state.server.close(() => resolve()));
    return state.arrivals;
};

export const probeSocketCommands = { startProbeSocketServer, stopProbeSocketServer };
