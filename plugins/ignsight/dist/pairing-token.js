// Short codes use the configured API; legacy tokens remain readable for one release.
import { readFileSync } from "node:fs";
import { agents } from "./agents/index.js";
const PREFIX = "ignsight1_";
const producers = new Set(agents.map((agent) => agent.producer));
/** Decode and validate a pairing token. Throws a candidate-readable error. */
export function parsePairingToken(token) {
    const text = token.trim();
    if (!text.startsWith(PREFIX))
        throw new Error("This is not an Ignsight pairing code. Copy it again from the candidate portal.");
    let value;
    try {
        value = JSON.parse(Buffer.from(text.slice(PREFIX.length), "base64url").toString("utf8"));
    }
    catch {
        throw new Error("The pairing code is incomplete. Copy it again from the candidate portal.");
    }
    if (typeof value !== "object" || value === null)
        throw new Error("The pairing code is malformed.");
    const { api, producer, code } = value;
    if (typeof api !== "string" || typeof producer !== "string" || !producers.has(producer) || typeof code !== "string" || !code) {
        throw new Error("The pairing code is malformed.");
    }
    return { api: apiOrigin(api), producer: producer, code };
}
/** The API origin, allowing plain http only for loopback development APIs. */
export function apiOrigin(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("The pairing code has an invalid API address.");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) {
        throw new Error("The pairing code has an invalid API address.");
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
export function resolveApiOrigin() {
    if (process.env.IGNSIGHT_API_URL)
        return apiOrigin(process.env.IGNSIGHT_API_URL);
    try {
        const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
        if (typeof config === "object" && config !== null && "apiOrigin" in config && typeof config.apiOrigin === "string")
            return apiOrigin(config.apiOrigin);
    }
    catch { /* Report missing package configuration below. */ }
    throw new Error("The assessment API is not configured. Reinstall the plugin or set IGNSIGHT_API_URL.");
}
