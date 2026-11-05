import { appendFile, chmod, mkdir, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { dataDirectory } from "./workspace.js";
import { PRODUCER } from "./version.js";
/** Return the diagnostic log path. */
export function hookLogPath() {
    return join(dataDirectory(), "logs", "hook.jsonl");
}
/** Append a bounded, payload-free hook diagnostic. */
export async function logHookRun(entry) {
    try {
        const path = hookLogPath();
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await chmod(dataDirectory(), 0o700);
        await chmod(dirname(path), 0o700);
        const size = await stat(path).then((file) => file.size, () => 0);
        if (size > 256 * 1024)
            await rename(path, `${path}.1`);
        const shell = process.platform === "win32" ? process.env.ComSpec : process.env.SHELL;
        const line = {
            time: new Date().toISOString(), agent: entry.agent, hook: entry.hook,
            version: PRODUCER.version, node: process.versions.node, platform: process.platform,
            shell: shell ? basename(shell) : null, duration_ms: entry.duration_ms, outcome: entry.outcome,
            ...(entry.code === undefined ? {} : { code: entry.code }),
        };
        await appendFile(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
        await chmod(path, 0o600);
    }
    catch { /* Diagnostics must not affect hooks. */ }
}
/** Read the most recent diagnostic entries. */
export async function readHookLog(limit = 100) {
    const path = hookLogPath();
    const lines = [];
    for (const file of [`${path}.1`, path]) {
        const content = await readFile(file, "utf8").catch(() => "");
        for (const line of content.split("\n")) {
            try {
                lines.push(JSON.parse(line));
            }
            catch { /* Ignore incomplete lines. */ }
        }
    }
    return limit > 0 ? lines.slice(-limit) : [];
}
