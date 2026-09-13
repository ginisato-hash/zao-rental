// JSON.stringify of the current20x5x6 contract plus request/quote wrappers plus model edition promises fits40KiB.
// Boundary/maximum UTF8 byte tests pin this derivation; no arbitrary whitespace allowance.
export const DEFAULT_JSON_BYTES=16384;
export const GROUP_JSON_BYTES=40960;
export type JsonByteLimit=typeof DEFAULT_JSON_BYTES|typeof GROUP_JSON_BYTES;
