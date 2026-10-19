import { constants } from "node:fs";
import { open, opendir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isInside } from "../workspace.js";
import { MAX_STRING_LENGTH } from "./redact.js";
import { expandHome, isSensitiveFile, resolveReal } from "./scope.js";
const MAX_FILES = 128;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 4_096;
const excluded = new Set([".git", "node_modules"]);
/** Snapshot workspace instructions, including bounded imports, without reading external or credential files. */
export async function instructionEvents(root) {
    const files = new Map();
    let entries = 0;
    let checks = 0;
    const workspacePath = (path) => relative(root, path).split(sep).join("/");
    const excludedPath = (path) => workspacePath(path).split("/").some((part) => excluded.has(part));
    async function capture(path, depth, importedBy) {
        if (depth > MAX_DEPTH || files.size >= MAX_FILES || ++checks > MAX_ENTRIES)
            return;
        const real = await resolveReal(path);
        const kind = !isInside(real, root) ? "out_of_workspace"
            : isSensitiveFile(path) || isSensitiveFile(real) ? "sensitive_file" : null;
        if (kind) {
            // Import content is omitted entirely; retain only the reason on its importing file.
            if (importedBy) {
                const marker = { kind, pointer: "/imported_content" };
                importedBy.redactions = [...(importedBy.redactions ?? []), marker];
            }
            return;
        }
        if (excludedPath(path) || excludedPath(real))
            return;
        const existing = files.get(real);
        if (existing) {
            if (importedBy && existing !== importedBy)
                existing.imported_by ??= importedBy.path;
            return;
        }
        let content;
        try {
            if (!(await stat(real)).isFile())
                return;
            const file = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                if (!(await file.stat()).isFile())
                    return;
                // Read enough UTF-8 bytes for the string limit plus one truncation sentinel.
                const buffer = Buffer.alloc((MAX_STRING_LENGTH + 1) * 4);
                const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
                content = buffer.subarray(0, bytesRead).toString("utf8");
            }
            finally {
                await file.close();
            }
        }
        catch {
            return;
        }
        const payload = { path: workspacePath(real), content, ...importedBy && { imported_by: importedBy.path } };
        files.set(real, payload);
        // Imports are relative to the importing file; email addresses and inline words are not imports.
        for (const match of content.slice(0, MAX_STRING_LENGTH).matchAll(/(?:^|[\s`])@([^\s@`"'<>]+)/g)) {
            const target = match[1];
            const absolute = resolve(dirname(real), expandHome(target));
            await capture(absolute, depth + 1, payload);
            if (checks >= MAX_ENTRIES || files.size >= MAX_FILES)
                break;
        }
    }
    async function discover(directory, depth) {
        if (depth > MAX_DEPTH || entries >= MAX_ENTRIES || files.size >= MAX_FILES)
            return;
        const directories = [];
        try {
            for await (const entry of await opendir(directory)) {
                if (++entries > MAX_ENTRIES || files.size >= MAX_FILES)
                    break;
                if (excluded.has(entry.name))
                    continue;
                const path = join(directory, entry.name);
                if (entry.isDirectory())
                    directories.push(path);
                else {
                    const local = workspacePath(path);
                    if (["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"].includes(entry.name)
                        || /(?:^|\/)\.claude\/rules\/[^/]+\.md$/.test(local)
                        || /(?:^|\/)\.cursor\/rules\/[^/]+\.mdc$/.test(local))
                        await capture(path, 0);
                }
            }
        }
        catch { /* Unreadable directories cannot supply instruction evidence. */ }
        for (const directory of directories.sort())
            await discover(directory, depth + 1);
    }
    await discover(root, 0);
    return [...files.values()].map((payload) => ({ event_type: "instructions.file", actor: "system", payload }));
}
