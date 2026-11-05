export const MINIMUM_NODE_MAJOR = 24;
export function supportedNode(version) {
    return Number(version.split(".")[0]) >= MINIMUM_NODE_MAJOR;
}
