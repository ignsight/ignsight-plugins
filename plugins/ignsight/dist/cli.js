import { MINIMUM_NODE_MAJOR, supportedNode } from "./node-version.js";
if (!supportedNode(process.versions.node)) {
    console.error(`Ignsight needs Node.js ${MINIMUM_NODE_MAJOR} or newer; found v${process.versions.node}. Install it, then restart your coding agent.`);
}
else {
    await import("./cli-run.js");
}
