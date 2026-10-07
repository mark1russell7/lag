/**
 * A random ID of 32 hexadecimal digits, from `crypto.getRandomValues` when it
 * exists (in all browsers and workers, also on insecure pages), else from
 * `Math.random`.
 */
export function createRandomId() : string {
    const bytes = new Uint8Array(16);
    const crypto = (globalThis as { crypto? : { getRandomValues?(array : Uint8Array) : Uint8Array } }).crypto;
    if (typeof crypto?.getRandomValues === "function") {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
