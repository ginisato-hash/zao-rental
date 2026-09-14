import {FlowError} from '../../../contracts/src/rental-flow';
import {SQUARE_SANDBOX_ORIGIN, SQUARE_VERSION} from './square-sandbox';

/** P6 R2 names for Owner entry in the dedicated Vercel project's Preview scope.
 * These names did not exist in P4/P5's injected credential ports. No alias,
 * NEXT_PUBLIC export, default credential chain or process.env read is introduced. */
export const sandboxEnvironmentNames = Object.freeze({
  environment: 'SQUARE_ENVIRONMENT',
  apiVersion: 'SQUARE_API_VERSION',
  applicationId: 'SQUARE_SANDBOX_APPLICATION_ID',
  locationId: 'SQUARE_SANDBOX_LOCATION_ID',
  merchantId: 'SQUARE_SANDBOX_MERCHANT_ID',
  notificationUrl: 'SQUARE_SANDBOX_NOTIFICATION_URL',
  accessToken: 'SQUARE_SANDBOX_ACCESS_TOKEN',
  webhookSignatureKey: 'SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY',
} as const);

export const sandboxSecretEnvironmentNames = Object.freeze([
  sandboxEnvironmentNames.accessToken,
  sandboxEnvironmentNames.webhookSignatureKey,
] as const);

const invalid = () => new FlowError('SANDBOX_ENVIRONMENT_INVALID', 503);
function identifier(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw invalid();
  return value;
}

/** Metadata-only preparation, NOT activation, credential validation or readiness.
 * Secret properties are deliberately never read, returned or included in errors.
 * VERCEL_ENV is deployment metadata, not a browser/request flag or sufficient
 * authorization to make an external call. Next Preview also uses NODE_ENV=production;
 * existing production booking/charge gates must not be removed to make this parse.
 * S1 merchant/location lookup, receiver composition, lifecycle metadata, durable
 * journal and deployment approval remain separate gates. No store mapping is made. */
export function sandboxAcceptanceEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const n = sandboxEnvironmentNames;
  if (env.VERCEL_ENV !== 'preview' || env[n.environment] !== 'SANDBOX' ||
      env[n.apiVersion] !== SQUARE_VERSION ||
      Object.keys(env).some(key => /^NEXT_PUBLIC_/i.test(key) && env[key])) throw invalid();
  const applicationId = identifier(env[n.applicationId]);
  const acceptanceLocationId = identifier(env[n.locationId]);
  const merchantId = env[n.merchantId] === undefined ? null : identifier(env[n.merchantId]);
  const notificationUrl = env[n.notificationUrl] ?? null;
  if (notificationUrl !== null) {
    let url: URL;
    try { url = new URL(notificationUrl); } catch { throw invalid(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.href !== notificationUrl || notificationUrl.length > 2048) throw invalid();
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    purpose: 'SINGLE_LOCATION_SANDBOX_ACCEPTANCE' as const,
    deployment: 'VERCEL_PREVIEW' as const,
    environment: 'SANDBOX' as const,
    origin: SQUARE_SANDBOX_ORIGIN,
    apiVersion: SQUARE_VERSION,
    applicationId, acceptanceLocationId, merchantId, notificationUrl,
    accessKeyId: n.accessToken,
    webhookKeyId: n.webhookSignatureKey,
    activation: 'DISABLED' as const,
    merchantLocationVerified: false as const,
    internalStoreMapping: 'OWNER_PENDING' as const,
  });
}
