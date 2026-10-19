import { agentById, agents } from "./agents/index.js";
import { PRODUCER } from "./version.js";
/** A non-2xx API answer. `status` drives retry and fail-closed decisions. */
export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const states = new Set(["paired", "waiting-for-start", "active", "expired"]);
export async function exchangeCode(api, producer, code) {
    const body = await request(api, "/v1/candidate/producer/exchange", {
        method: "POST", body: JSON.stringify({ producer, code }), signal: AbortSignal.timeout(15_000),
    }, agents.find((agent) => agent.producer === producer));
    if (typeof body.credential !== "string" || typeof body.expires_at !== "string")
        throw new ApiError(502, "Unexpected pairing response");
    return { credential: body.credential, expires_at: body.expires_at, attempt_id: typeof body.attempt_id === "string" ? body.attempt_id : null };
}
/** The credential's state. The endpoint answers 200 for every known credential, so read `state`, never just the HTTP status. */
export async function producerStatus(api, producer, credential, timeoutMs = 10_000) {
    const body = await request(api, `/v1/candidate/producer/status?producer=${producer}`, {
        headers: { authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(timeoutMs),
    }, agents.find((agent) => agent.producer === producer));
    if (typeof body.state !== "string" || !states.has(body.state))
        throw new ApiError(502, "Unexpected status response");
    return {
        state: body.state,
        attempt_ids: Array.isArray(body.attempt_ids) ? body.attempt_ids.filter((id) => typeof id === "string") : [],
        expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
    };
}
export async function uploadBatch(api, attemptId, credential, batch) {
    const body = await request(api, `/v1/attempts/${attemptId}/events:batch`, {
        method: "POST", headers: { authorization: `Bearer ${credential}` }, body: JSON.stringify(batch),
        signal: AbortSignal.timeout(30_000),
    }, agentById(batch.session.source));
    if (!Array.isArray(body.results))
        throw new ApiError(502, "Unexpected batch response");
    return body.results;
}
async function request(api, path, init, agent) {
    if (!agent)
        throw new Error("No coding-agent adapter registered for this request");
    const response = await fetch(`${api}${path}`, {
        ...init, headers: {
            "content-type": "application/json", accept: "application/json", ...init.headers,
            "User-Agent": `ignsight-capture/${PRODUCER.version} (${agent.id})`,
        },
    });
    if (!response.ok)
        throw new ApiError(response.status, `${path.split("?")[0]} answered ${response.status}`);
    return response.json();
}
