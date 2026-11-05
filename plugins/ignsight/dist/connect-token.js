// Dependency-free so the old-Node guard in hook.ts can block a connect prompt too.
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
