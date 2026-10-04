import 'server-only';
import {commercialProductionPlan, commercialSquareRoutes} from '../../../../packages/core/src/guest/production-commercial-composition';
import {SquareProductionPaymentTruth} from '../../../../packages/core/src/payment/square-payment-truth';
import {handleWorkerTick, readWorkerTickEnv} from '../../../../packages/core/src/payment/worker-tick';
import {getProductionRuntime} from './production-runtime';

/** Vercel Cron entry: the same finite tick as `scripts/production-worker.ts run-once`, on the deployed exact release.
 * Identity (release, project, database, merchant, roles) was verified when this runtime composed; the worker re-checks
 * TLS and role identity per tick, and the SQL lease keeps two overlapping invocations from claiming the same work. */
export function runScheduledWorkerTick(request: Request) {
  const fetch: typeof globalThis.fetch = (url, init) => globalThis.fetch(url, init);
  return handleWorkerTick({
    authorization: request.headers.get('authorization'), env: readWorkerTickEnv(process.env), now: new Date(),
    runtime: getProductionRuntime() as never,
    resolve: () => {
      const plan = commercialProductionPlan(process.env);
      if (!plan) throw new Error('NORMAL_WORKER_NOT_ACTIVATED');
      const routes = commercialSquareRoutes(plan.square, fetch);
      return {
        database: {host: plan.configuration.database.host, name: plan.configuration.database.name},
        lookup: {async lookupPayment(lookup: Parameters<SquareProductionPaymentTruth['lookupPayment']>[0]) {
          const route = Object.values(routes).find(r => r.locationId === lookup.expected.locationId);
          if (!route) return {kind: 'FAILED' as const, code: 'EVIDENCE_MISMATCH_BLOCKED'};
          return new SquareProductionPaymentTruth(route.transport).lookupPayment(lookup);
        }},
      };
    },
    log: line => console.log(line),
  });
}
