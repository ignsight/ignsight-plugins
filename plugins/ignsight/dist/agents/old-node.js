// Duplicated from adapters because the old-Node guard cannot load them.
export const oldNodeAgents = {
    codex: {
        displayName: "Codex", connectCommand: "$ignsight:connect", statusCommand: "$ignsight:status", notice: true,
        blockPrompt: (message) => ({ decision: "block", reason: message }),
    },
    "claude-code": {
        displayName: "Claude Code", connectCommand: "/ignsight:connect", statusCommand: "/ignsight:status", notice: true,
        blockPrompt: (message) => ({ continue: false, stopReason: message }),
    },
    cursor: {
        displayName: "Cursor", connectCommand: "/connect", statusCommand: "/status", notice: false,
        blockPrompt: (message) => ({ continue: false, user_message: message }),
    },
};
