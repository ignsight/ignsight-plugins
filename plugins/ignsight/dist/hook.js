import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oldNodeAgents } from "./agents/old-node.js";
import { connectToken } from "./connect-token.js";
import { MINIMUM_NODE_MAJOR, supportedNode } from "./node-version.js";
if (!supportedNode(process.versions.node)) {
    const id = process.argv[2] ?? "";
    const agent = oldNodeAgents[id];
    const name = agent?.displayName ?? "your coding agent";
    const text = `Ignsight needs Node.js ${MINIMUM_NODE_MAJOR} or newer; found v${process.versions.node}. Install it, then restart ${name}.${agent ? ` Run ${agent.statusCommand} in ${name} for details.` : ""}`;
    console.error(text);
    if (agent) {
        let input = {};
        try {
            input = JSON.parse(readFileSync(0, "utf8")) ?? {};
        }
        catch { /* Input is optional. */ }
        const commands = Object.values(oldNodeAgents).map((entry) => entry.connectCommand);
        if (connectToken(input.prompt, commands)) {
            // Block a connect prompt so the unspent pairing code never reaches the model.
            console.log(JSON.stringify(agent.blockPrompt(`${text} Your pairing code was not used.`)));
        }
        else if (agent.notice) {
            const session = input.session_id;
            let show = true;
            if (typeof session === "string" && session) {
                try {
                    writeFileSync(join(tmpdir(), `ignsight-old-node-${id}-${Buffer.from(session).toString("hex")}`), "", { flag: "wx" });
                }
                catch (error) {
                    if (error.code === "EEXIST")
                        show = false;
                }
            }
            if (show)
                console.log(JSON.stringify({ systemMessage: text }));
        }
    }
}
else {
    try {
        await import("./hook-run.js");
    }
    catch (error) {
        console.error(`Ignsight hook failed: ${error instanceof Error ? error.name : "Error"}`);
        process.exitCode = 0;
    }
}
