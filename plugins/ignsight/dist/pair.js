import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ApiError, exchangeCode } from "./api.js";
import { displayName } from "./agents/index.js";
import { credentialFile, refreshState } from "./capture.js";
import { deleteSecret, storeSecret } from "./keychain.js";
import { parsePairingToken, resolveApiOrigin } from "./pairing-token.js";
import { replaceWithLock } from "./uploader.js";
import { assertWritableDataDirectory, pairingDirectory, pairingKey, savePairing, updateState, workspaceRoot, } from "./workspace.js";
/**
 * The pairing token of a prompt that is exactly one of `commands` (every
 * registered agent's connect command) followed by a token, or null for every
 * other prompt. Fixed alternatives and bounded quantifiers keep it linear-time.
 */
export function connectToken(prompt, commands) {
    if (typeof prompt !== "string" || !commands.length)
        return null;
    const command = commands.map((item) => item.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
    return new RegExp(`^\\s{0,64}(?:${command})\\s{1,64}(ignsight1_[A-Za-z0-9_-]{1,4096}|[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}[- ]?[23456789ABCDEFGHJKMNPQRSTVWXYZ]{3})\\s{0,64}$`, "i").exec(prompt)?.[1] ?? null;
}
/**
 * Pair `directory` using a portal pairing token. `host` is the producer of the
 * coding agent running the hook; a code minted for another producer is refused
 * unspent. Throws candidate-readable errors.
 */
export async function pairWorkspace(token, directory, host) {
    const legacy = token.trim().startsWith("ignsight1_");
    if (!legacy && !/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}[- ]?[23456789ABCDEFGHJKMNPQRSTVWXYZ]{3}$/i.test(token.trim()))
        throw new Error("Invalid pairing code. Copy the 7-character code from the candidate portal.");
    if (!legacy && !host)
        throw new Error("Choose your coding agent with --agent <producer>.");
    const { api, producer, code } = legacy ? parsePairingToken(token) : { api: resolveApiOrigin(), producer: host, code: token.replace(/[- ]/g, "").toUpperCase() };
    // Exchanging another agent's code would also revoke that agent's working credential.
    if (host && producer !== host)
        throw new Error(`This code is for ${displayName(producer)}, not ${displayName(host)}. Copy the ${displayName(host)} code from the candidate portal. The code was not used.`);
    const root = await workspaceRoot(directory);
    await assertWritableDataDirectory();
    let exchange;
    try {
        exchange = await exchangeCode(api, producer, code);
    }
    catch (error) {
        if (error instanceof ApiError && error.status === 401)
            throw new Error("The pairing code was rejected: it expired, was already used, or the assessment has ended. Get a new code from the candidate portal.", { cause: error });
        throw new Error(`Could not reach the assessment API at ${api}.`, { cause: error });
    }
    if (!exchange.attempt_id)
        throw new Error("The API returned a credential without an attempt.");
    const key = pairingKey(producer, root, exchange.attempt_id);
    const pairing = {
        version: 1, key, root, producer, api_url: api, attempt_id: exchange.attempt_id,
        credential_storage: "keychain", paired_at: new Date().toISOString(),
    };
    try {
        await mkdir(pairingDirectory(key), { recursive: true, mode: 0o700 });
        await replaceWithLock(pairing, async () => {
            // Re-pairing the same binding starts a fresh local lifecycle.
            await deleteSecret(key, credentialFile(pairing));
            await rm(resolve(pairingDirectory(key), "sessions"), { recursive: true, force: true });
            await rm(resolve(pairingDirectory(key), "state.json"), { force: true });
            pairing.credential_storage = await storeSecret(key, exchange.credential, credentialFile(pairing));
            await savePairing(pairing);
            await updateState(key, { expires_at: exchange.expires_at });
        });
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        throw new Error(`The assessment accepted the code, but this computer could not save the pairing (${reason}). Get a new code from the candidate portal and try again.`, { cause: error });
    }
    // The first status call is what tells the portal this producer is connected.
    const state = await refreshState(pairing, 5_000).catch(() => null);
    return {
        lines: [describeState(state?.state ?? null), `Workspace: ${root}`, `Attempt: ${pairing.attempt_id}`],
        warning: pairing.credential_storage === "file"
            ? "Warning: no OS keychain was available, so the credential is stored in an owner-only file. The reviewer will see a capture warning."
            : null,
    };
}
export function describeState(state, endedAt = null) {
    switch (state) {
        case "active": return "Connected to Ignsight. Capture is active for your assessment.";
        case "waiting-for-start": return "Connected to Ignsight. Waiting for your assessment to start. Capture has not started.";
        case "paired": return "Connected to Ignsight. Capture starts when your assessment starts.";
        case "expired":
        case "ended": return `Assessment ended at ${endedAt ?? "unknown time"}. Capture has stopped.`;
        default: return "Connected to Ignsight. Capture status could not be confirmed because the API could not be reached. Nothing is captured until it reports the assessment active.";
    }
}
