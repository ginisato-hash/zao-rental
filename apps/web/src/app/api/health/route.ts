import { foundationStatus } from '@rental/contracts';
// Liveness only; deliberately does not claim DB or business readiness.
export function GET() { return Response.json(foundationStatus); }
