export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN' | 'MANAGER' | 'VIEWER';
export type Principal = { subject: string; role: Role };
export type TelemetryEventName = 'foundation.ready' | 'foundation.probe';
export const foundationStatus = {
  service: 'zao-rental', stage: 'foundation', bookingAvailable: false,
} as const;
