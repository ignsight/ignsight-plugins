import { connectCommands } from "./agents/index.js";
/** Return the agent-specific status command. */
export function statusCommand(agent) {
    return agent.connectCommand.replace("connect", "status");
}
/** Format a candidate-facing notice. */
export function noticeText(code, agent, detail) {
    const pair = `Get a fresh code from the candidate portal, then run ${connectCommands()}.`;
    const messages = {
        data_dir_unwritable: "Ignsight cannot write its data directory. Check its permissions and try again.",
        "pairing_failed:code_expired_or_used": `Ignsight could not pair because the code expired or was already used. ${pair}`,
        "pairing_failed:other_agent_code": `Ignsight could not pair because the code is for another agent. ${pair}`,
        "pairing_failed:home_directory": "Ignsight could not pair because it cannot access your home directory. Check its permissions and try again.",
        "pairing_failed:api_unreachable": "Ignsight could not pair because the service is unreachable. Check your connection and try again.",
        api_unreachable: "Ignsight cannot reach the service. Check your connection and try again.",
        credential_missing: `Ignsight could not read the saved credential. ${pair}`,
        credential_revoked: `Ignsight connection was revoked. ${pair}`,
        buffer_full: "Ignsight local buffer is full. Check your connection so pending activity can upload.",
        internal_error: `Ignsight encountered an error (${detail ?? "unknown"}). Try again.`,
    };
    return `${messages[code]} Run ${statusCommand(agent)} in ${agent.displayName} for details.`;
}
