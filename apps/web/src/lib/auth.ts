import 'server-only';
import type { Principal } from '@rental/contracts';
// E05 will connect a maintained OIDC/session library. E01 has no login or trusted identities.
export async function getPrincipal(): Promise<Principal | null> { return null; }
