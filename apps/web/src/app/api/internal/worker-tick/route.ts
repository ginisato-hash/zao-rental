import {runScheduledWorkerTick} from '../../../../lib/worker-tick';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Hard ceiling for one tick; the plan's own deadline (50 s) stops new work earlier. */
export const maxDuration = 60;
export async function GET(request: Request) {
  const {status, body} = await runScheduledWorkerTick(request);
  return Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
}
