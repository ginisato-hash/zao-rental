export const MANIFEST_ROOTS:readonly string[];
export function walkManifestFiles(root:string):string[];
export function manifestDigest(root:string,files:string[]):string;
export function buildDigestFromTree(root:string):string;
