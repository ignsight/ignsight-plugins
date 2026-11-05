---
name: status
description: Show whether Ignsight capture is paired and active for this workspace.
---

Show the Ignsight capture status for the current workspace. Claude Code uses:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" status
```

Codex uses `${PLUGIN_ROOT}` - the directory containing this skill's `skills/`
folder. Cursor uses `${CURSOR_PLUGIN_ROOT}`. For either, run the same command
with its respective placeholder in place of `${CLAUDE_PLUGIN_ROOT}`. If the
placeholder has not already been replaced in the text you see, write the
absolute plugin root path yourself. On Windows PowerShell or cmd, never use
`$VAR`, `$env:` or `%VAR%`; use the absolute path.

The command checks the pairing store and data directory. In
Codex it may report that it could not finish ending an attempt; that is
expected and the cached state is still accurate.

Report the Checks block and the output verbatim: producer, workspace root, attempt ID, state
(`paired`, `waiting for the test to start`, `capturing`, or `ended at <time>`),
valid until, last successful upload, buffered count, credential storage and
last error. If capture has ended, include the end reason and uploaded and
dropped event counts. Status shows the newest pairing per host; use
`status --all` to list older attempts and `status --json` for machine-readable
output.

Tell the candidate to check the candidate portal for the matching producer
and attempt, such as "Claude Code: Connected" or "Codex: Connected". If a host
is missing, they pair it with `/ignsight:connect <code>` in Claude Code or
`$ignsight:connect <code>` in Codex.

In Cursor, use /status. If pairing hooks did not run, enable Ignsight
in /plugin, reload the window, and get a fresh code. After pairing, start
a new chat immediately: blocked prompts remain in chat history.
