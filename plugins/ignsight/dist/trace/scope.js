import { execFile } from "node:child_process";
import { glob, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { isInside } from "../workspace.js";
import { isObject } from "./event.js";
// Tool content is captured only for files inside the workspace root (decision D3)
// and never for credential or gitignored files. A scoped-out event is kept; its file content
// and tool output are replaced by a marker.
export const OUT_OF_WORKSPACE = "[OUT_OF_WORKSPACE]";
export const SENSITIVE_FILE = "[REDACTED_SENSITIVE_FILE]";
// Keys whose string values locate files rather than carry their content. `workdir` is
// resolved separately, once, against the hook cwd.
const pathKeys = new Set(["file_path", "filePath", "path", "notebook_path", "cwd"]);
const commandKeys = new Set(["command", "cmd"]);
// Tool-input keys that survive when content is dropped.
const locatorKeys = new Set([...pathKeys, ...commandKeys, "workdir", "pattern"]);
// Upper bound on filesystem checks for command arguments and glob matches, to stay inside the
// hook budget. Past it the remaining paths are unverified, so the content is dropped.
const MAX_PATH_CHECKS = 1_024;
// .env*, *.env, SSH keys, *.pem, *.key, auth rc files, and cloud credential stores.
const sensitiveFile = /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]+\.env|id_(?:rsa|dsa|ecdsa|ed25519)[^/]*|[^/]+\.(?:pem|key)|\.npmrc|\.netrc|_netrc|\.pgpass|\.git-credentials|\.aws\/(?:credentials|sso\/cache\/[^/]+)|\.docker\/config\.json|\.kube\/config|\.config\/gcloud\/.+|\.azure\/.+|AppData\/Roaming\/(?:gcloud|npm)(?:\/.*)?)$/i;
// Only the null device is skipped; any other `\\.\` or `\\?\` path names a real file and is checked.
const windowsNull = /^(?:\\\\[.?]\\)?nul$/i;
const unresolvedRoot = /^(?:\$(?:\{?\w+\}?|\(|env:\w+)|%\w+%)/i;
// Git Bash mounts that map outside the drive path Node resolves (`/tmp` is %TEMP%, `/usr` the Git install).
const gitBashMount = /^\/(?:tmp|etc|usr|bin|mingw32|mingw64|proc|cygdrive|home|var|opt)(?:\/|$)/i;
/** Return the hook payload with tool content removed when it touches files outside `root`, credential files or gitignored files. */
export async function scopePayload(payload, cwd, root, withholdToolContent = false, windows = process.platform === "win32") {
    // Name-only attribution is allowed; neither a skill read's command/path nor its output is evidence.
    if (withholdToolContent)
        return { ...payload, tool_input: OUT_OF_WORKSPACE, tool_response: OUT_OF_WORKSPACE, error: OUT_OF_WORKSPACE };
    if (!("tool_input" in payload) && !("tool_response" in payload))
        return payload;
    const input = isObject(payload.tool_input) ? payload.tool_input : {};
    const pathApi = windows ? win32 : { resolve };
    const base = typeof input.workdir === "string" ? pathApi.resolve(cwd, input.workdir) : cwd;
    const paths = { locators: typeof input.workdir === "string" ? [base] : [], mentions: [] };
    collect(payload.tool_input, undefined, paths, windows);
    collect(payload.tool_response, undefined, paths, windows);
    const marker = await classify(paths, base, root, windows);
    if (!marker)
        return payload;
    const scoped = { ...payload };
    if (isObject(payload.tool_input))
        scoped.tool_input = dropContent(payload.tool_input, marker);
    else if ("tool_input" in payload)
        scoped.tool_input = marker;
    if ("tool_response" in payload)
        scoped.tool_response = marker;
    return scoped;
}
function collect(value, key, paths, windows) {
    if (typeof value === "string") {
        if (isPatch(value))
            paths.locators.push(...patchPaths(value));
        else if (key && pathKeys.has(key))
            paths.locators.push(value);
        else if (key && commandKeys.has(key))
            paths.mentions.push(...commandArguments(value, windows));
        else if (key === "pattern" && /^(?:[/~\\]|[A-Za-z]:)/.test(value))
            paths.mentions.push(value);
    }
    else if (Array.isArray(value)) {
        // An argv array: each argument is a word, and a `sh -c` script is parsed as a command.
        if (key && commandKeys.has(key) && value.every((item) => typeof item === "string"))
            paths.mentions.push(...pathWords(value.slice(1), windows), ...value.flatMap((item) => commandArguments(item, windows)));
        else
            for (const item of value)
                collect(item, undefined, paths, windows);
    }
    else if (isObject(value)) {
        for (const [name, item] of Object.entries(value))
            collect(item, name, paths, windows);
    }
}
async function classify(paths, base, root, windows) {
    const absolutePath = (path) => windows ? win32.resolve(base, expandHome(path, true).replace(/^\/([a-z])(?=\/)/i, "$1:")) : resolve(base, expandHome(path));
    const inside = (path) => windows ? (path.toLowerCase() === root.toLowerCase() || path.toLowerCase().startsWith(win32.resolve(root).toLowerCase().replace(/[\\/]+$/, "") + "\\")) : isInside(path, root);
    let sensitive = false;
    const inRoot = new Set();
    let checks = 0;
    // Explicit file locators are checked even when the file does not exist yet (a Write).
    for (const path of paths.locators) {
        if (++checks > MAX_PATH_CHECKS)
            return OUT_OF_WORKSPACE;
        const absolute = absolutePath(path);
        if (windows && windowsNull.test(path))
            continue;
        // shortcut: on non-Windows hosts a win32 path cannot be realpath'd, so tests compare it lexically; real Windows always resolves.
        const real = windows && process.platform !== "win32" ? absolute : await resolveReal(absolute);
        if (!inside(real))
            return OUT_OF_WORKSPACE;
        inRoot.add(real);
        sensitive ||= isSensitiveFile(absolute) || isSensitiveFile(real);
    }
    // Command arguments are only paths when they exist; `grep "/api/"` must not scope out an event.
    const mentions = [...new Set(paths.mentions)];
    // A root Node cannot resolve fails closed: a leading shell variable other than home, or a Git Bash mount.
    if (mentions.some((mention) => unresolvedRoot.test(expandHome(mention, windows)) || (windows && gitBashMount.test(mention))))
        return OUT_OF_WORKSPACE;
    for await (const absolute of mentionTargets(mentions, base, windows)) {
        if (windows && windowsNull.test(absolute))
            continue;
        if (++checks > MAX_PATH_CHECKS)
            return OUT_OF_WORKSPACE;
        const real = await realpath(absolute).catch(() => null);
        if (real && !real.startsWith("/dev/") && !inside(real))
            return OUT_OF_WORKSPACE;
        if (real && inside(real))
            inRoot.add(real);
        sensitive ||= isSensitiveFile(absolute) || Boolean(real && isSensitiveFile(real));
    }
    // `cat .env*` names credential files even when nothing matches.
    sensitive ||= mentions.some((mention) => isSensitiveFile(mention) || isSensitiveFile(mention.replace(/[*?]/g, "")));
    // shortcut: on non-Windows hosts a win32 path cannot be realpath'd, so tests compare it lexically; real Windows always resolves.
    const ignored = !(windows && process.platform !== "win32") && inRoot.size > 0 && await hasIgnoredPaths([...inRoot], root);
    return sensitive || ignored ? SENSITIVE_FILE : null;
}
// Plain check-ignore preserves tracked files even when they match an ignore rule.
async function hasIgnoredPaths(paths, root) {
    return new Promise((resolve) => {
        const child = execFile("git", ["-C", root, "check-ignore", "--stdin", "-z"], { timeout: 1_000 }, (error, stdout) => {
            // shortcut: unavailable Git leaves existing credential filtering in place; no extra evidence is recorded.
            resolve(!error && stdout.length > 0);
        });
        child.stdin?.on("error", () => { });
        child.stdin?.end(paths.join("\0") + "\0");
    });
}
// Absolute paths a command may read. A glob yields the directory it lists and every match,
// so a matched symlink cannot escape the root.
async function* mentionTargets(mentions, base, windows) {
    const target = (path) => windows ? win32.resolve(base, expandHome(path, true).replace(/^\/([a-z])(?=\/)/i, "$1:")) : resolve(base, expandHome(path));
    for (const mention of mentions) {
        if (windows && windowsNull.test(mention))
            continue;
        const absolute = target(mention);
        if (!/[*?[{]/.test(mention)) {
            yield absolute;
            continue;
        }
        yield target(globBase(mention));
        try {
            yield* glob(absolute);
        }
        catch { /* The command cannot read an unreadable directory either. */ }
    }
}
// Keep locators (paths, commands) and non-string scalars; everything else may be file content.
function dropContent(input, marker) {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => {
        const locator = locatorKeys.has(key) && (typeof value === "string"
            ? !isPatch(value)
            : Array.isArray(value) && value.every((item) => typeof item === "string"));
        const scalar = value === null || ["number", "boolean"].includes(typeof value);
        return [key, locator || scalar ? value : marker];
    }));
}
// Shell arguments that may name files, skipping each command's program name and `VAR=` prefixes.
function commandArguments(command, windows = process.platform === "win32") {
    return shellCommands(command, windows).flatMap((words) => pathWords(words.slice(words.findIndex((word) => !/^\w+=/.test(word)) + 1), windows));
}
// Arguments that look like paths; `--flag=path` is checked by its value. A bare `name.ext` counts
// too, so `cat secrets.json` is checked against .gitignore; only existing files are used.
function pathWords(words, windows) {
    return words.flatMap((token) => {
        const word = token.startsWith("-") ? token.slice(token.indexOf("=") + 1 || token.length) : token;
        return word && !word.includes("://") && (/^[~./]/.test(word) || word.includes("/") || (windows && (word.includes("\\") || /^(?:[a-z]:|\$env:USERPROFILE|%USERPROFILE%)/i.test(word))) || /^[^\s/]+\.\w+$/.test(word) || isSensitiveFile(word)) ? [word] : [];
    });
}
// Split a script into simple commands, honoring quotes and POSIX backslash escapes.
// The target of an output redirection is a write, not a read, and is dropped.
export function shellCommands(script, windows = process.platform === "win32") {
    const commands = [[]];
    let word = null;
    let redirected = false;
    const endWord = () => {
        if (word !== null && !redirected)
            commands.at(-1).push(word);
        if (word !== null)
            redirected = false;
        word = null;
    };
    for (let index = 0; index < script.length; index++) {
        const char = script[index];
        if (char === "\\" && !windows)
            word = (word ?? "") + (script[++index] ?? "");
        else if (char === "'" || char === '"') {
            word ??= "";
            for (index++; index < script.length && script[index] !== char; index++) {
                if (!windows && char === '"' && script[index] === "\\")
                    index++;
                word += script[index] ?? "";
            }
        }
        else if (char === ">") {
            if (word !== null && /^\d+$/.test(word))
                word = null; // `2>`: a descriptor, not an argument
            endWord();
            redirected = true;
        }
        else if ("|;&()`\n".includes(char)) {
            endWord();
            redirected = false;
            commands.push([]);
        }
        else if (char === "<" || /\s/.test(char))
            endWord();
        else
            word = (word ?? "") + char;
    }
    endWord();
    return commands;
}
export function isPatch(text) {
    return text.includes("*** Begin Patch");
}
function patchPaths(patch) {
    return [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((match) => match[1].trim());
}
/** Credential files are excluded from tool content and usage transcript reads. */
export function isSensitiveFile(path) {
    return sensitiveFile.test(path.replaceAll("\\", "/"));
}
export function expandHome(path, windows = process.platform === "win32") {
    const home = (windows ? /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[\\/]|$)/i : /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/).exec(path);
    return home ? (windows ? win32.join(process.env.USERPROFILE ?? homedir(), path.slice(home[0].length)) : join(homedir(), path.slice(home[0].length))) : path;
}
// `~/.ssh/*` is checked as `~/.ssh/`.
function globBase(path) {
    const glob = path.search(/[*?[{]/);
    return glob === -1 ? path : path.slice(0, Math.max(path.lastIndexOf("/", glob), path.lastIndexOf("\\", glob)) + 1) || ".";
}
// Resolve symlinks through the deepest existing ancestor, so a new file resolves like its directory.
export async function resolveReal(path) {
    const rest = [];
    let current = path;
    while (true) {
        try {
            return join(await realpath(current), ...rest);
        }
        catch {
            const parent = dirname(current);
            if (parent === current)
                return path;
            rest.unshift(basename(current));
            current = parent;
        }
    }
}
