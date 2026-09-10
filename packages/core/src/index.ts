import type { Principal, Role, TelemetryEventName } from '@rental/contracts';
export type Access = { allowed: true } | { allowed: false; status: 401 | 403 };
// Only a future verified server session resolver may supply Principal. Never trust headers/cookies directly.
export function authorize(principal: Principal | null, allowedRoles: readonly Role[]): Access {
  if (!principal?.subject.trim()) return { allowed: false, status: 401 };
  return allowedRoles.includes(principal.role) ? { allowed: true } : { allowed: false, status: 403 };
}
export function assertTelemetryEventName(name: string): asserts name is TelemetryEventName {
  if (name !== 'foundation.ready' && name !== 'foundation.probe') throw new Error('Unsupported telemetry event');
}
