import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {FetchSquareS1Transport} from '../../packages/core/src/payment/square-transport';
import {SquareS1Service} from '../../packages/core/src/payment/square-s1';
import {createSquareS1Acceptance} from '../../apps/web/src/lib/square-s1-acceptance';
import {SQUARE_SANDBOX_ORIGIN, SQUARE_VERSION} from '../../packages/core/src/payment/square-sandbox';

type FixtureCall = {url: string; init: RequestInit};
type QueueResponse = (url: string, init: RequestInit) => Promise<Response> | Response;

type CallFixture = {
  calls: FixtureCall[];
  fetch: (url: string, init: RequestInit) => Promise<Response>;
};

function makeFetch(responses: QueueResponse[]): CallFixture {
  const calls: FixtureCall[] = [];
  let i = 0;
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({url, init});
      const response = responses[i++];
      if (!response) {
        throw new Error('UNEXPECTED_SQUARE_CALL');
      }
      return response(url, init);
    },
  };
}

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});

const malformedResponse = (status = 200) =>
  new Response('not-json', {status, headers: {'content-type': 'application/json'}});

const synthetic = () => randomBytes(32).toString('base64url');

const acceptanceEnv = (values: Record<string, string | undefined> = {}) => ({
  VERCEL_ENV: 'preview',
  SQUARE_ENVIRONMENT: 'SANDBOX',
  SQUARE_API_VERSION: SQUARE_VERSION,
  SQUARE_SANDBOX_APPLICATION_ID: 'synthetic-app',
  SQUARE_SANDBOX_LOCATION_ID: 'synthetic-location',
  SQUARE_SANDBOX_MERCHANT_ID: 'synthetic-merchant',
  SQUARE_SANDBOX_ACCESS_TOKEN: synthetic(),
  ...values,
});

const merchant = (overrides: Record<string, unknown> = {}) => ({
  id: 'synthetic-merchant',
  main_location_id: 'synthetic-location',
  status: 'ACTIVE',
  country: 'JP',
  currency: 'JPY',
  ...overrides,
});

const location = (overrides: Record<string, unknown> = {}) => ({
  id: 'synthetic-location',
  merchant_id: 'synthetic-merchant',
  status: 'ACTIVE',
  country: 'JP',
  currency: 'JPY',
  capabilities: ['CREDIT_CARD_PROCESSING'],
  ...overrides,
});

test('Square S1 service performs only exact two read-only Sandbox lookups on happy path', async () => {
  const f = makeFetch([
    () => jsonResponse({merchant: merchant()}),
    () => jsonResponse({locations: [location()]}),
  ]);

  const service = new SquareS1Service('synthetic-location', new FetchSquareS1Transport(() => synthetic(), f.fetch));
  const result = await service.run();

  assert.equal(result.result, 'S1_PASS');
  assert.equal(result.requestCount, 2);
  assert.equal(result.mainLocationMatch, true);
  assert.equal(result.configuredLocationMatch, true);
  assert.equal(result.cardProcessingCapability, true);
  assert.equal(result.httpResults.merchant, 200);
  assert.equal(result.httpResults.locations, 200);
  assert.deepEqual(f.calls.map((c) => c.url), [
    SQUARE_SANDBOX_ORIGIN + '/v2/merchants/me',
    SQUARE_SANDBOX_ORIGIN + '/v2/locations',
  ]);
});

test('Square S1 service fails fast on merchant lookup auth/429/5xx/network/timeout/schema and does not call locations', async () => {
  const token = synthetic();

  const run = async (response: QueueResponse, timeoutMs?: number) => {
    const f = makeFetch([response]);
    const service = new SquareS1Service('synthetic-location', new FetchSquareS1Transport(() => token, f.fetch), timeoutMs);
    const result = await service.run();
    return {result, calls: f.calls.length};
  };

  const failures = [
    {response: () => jsonResponse({merchant: {oops: true}}, 401), expected: 'AUTH_FAILED'},
    {response: () => jsonResponse({merchant: {oops: true}}, 403), expected: 'AUTH_FAILED'},
    {response: () => jsonResponse({merchant: {oops: true}}, 429), expected: 'RATE_LIMITED'},
    {response: () => jsonResponse({merchant: {oops: true}}, 500), expected: 'PROVIDER_FAILURE'},
  ];

  for (const failure of failures) {
    const {result, calls} = await run(failure.response);
    assert.equal(result.requestCount, 1);
    assert.equal(result.reason, failure.expected);
    assert.equal(result.result, 'S1_FAIL');
    assert.equal(calls, 1);
  }

  {
    const {result, calls} = await run(() => {
      throw new Error('synthetic network');
    });
    assert.equal(result.requestCount, 1);
    assert.equal(result.reason, 'NETWORK_FAILURE');
    assert.equal(calls, 1);
  }

  {
    const {result, calls} = await run(() => new Promise<Response>(() => {}), 30);
    assert.equal(result.requestCount, 1);
    assert.equal(result.reason, 'NETWORK_FAILURE');
    assert.equal(calls, 1);
  }

  {
    const {result, calls} = await run(() => malformedResponse());
    assert.equal(result.requestCount, 1);
    assert.equal(result.reason, 'SCHEMA_MISMATCH');
    assert.equal(calls, 1);
  }
});

test('Square S1 service enforces merchant active/Japanese/JPY and configured main location', async () => {
  const cases = [
    {merchant: merchant({status: 'INACTIVE'}), expected: 'MERCHANT_INACTIVE'},
    {merchant: merchant({country: 'US'}), expected: 'SANDBOX_COUNTRY_MISMATCH'},
    {merchant: merchant({currency: 'USD'}), expected: 'CURRENCY_MISMATCH'},
    {merchant: merchant({main_location_id: 'other-location'}), expected: 'LOCATION_ID_MISMATCH'},
  ];

  for (const c of cases) {
    const f = makeFetch([() => jsonResponse({merchant: c.merchant})]);
    const service = new SquareS1Service('synthetic-location', new FetchSquareS1Transport(() => synthetic(), f.fetch));
    const result = await service.run();

    assert.equal(result.requestCount, 1);
    assert.equal(result.reason, c.expected);
    assert.equal(result.result, 'S1_FAIL');
  }
});

test('Square S1 service validates configured location state/currency/country/merchant and card capability', async () => {
  const cases = [
    {locations: [], expected: 'LOCATION_NOT_FOUND'},
    {locations: [location({id: 'other-location'})], expected: 'LOCATION_ID_MISMATCH'},
    {locations: [location(), location()], expected: 'SCHEMA_MISMATCH'},
    {locations: [location({status: 'INACTIVE'})], expected: 'LOCATION_INACTIVE'},
    {locations: [location({country: 'US'})], expected: 'SANDBOX_COUNTRY_MISMATCH'},
    {locations: [location({currency: 'USD'})], expected: 'CURRENCY_MISMATCH'},
    {locations: [location({merchant_id: 'other-merchant'})], expected: 'MERCHANT_MISMATCH'},
    {locations: [location({capabilities: []})], expected: 'CAPABILITY_MISSING', warning: true},
  ];

  for (const c of cases) {
    const f = makeFetch([
      () => jsonResponse({merchant: merchant()}),
      () => jsonResponse({locations: c.locations}),
    ]);
    const service = new SquareS1Service('synthetic-location', new FetchSquareS1Transport(() => synthetic(), f.fetch));
    const result = await service.run();

    assert.equal(result.requestCount, 2);
    assert.equal(result.reason, c.expected);
    if (c.warning) {
      assert.equal(result.result, 'S1_WARNING');
      assert.equal(result.cardProcessingCapability, false);
    } else {
      assert.equal(result.result, 'S1_FAIL');
    }
  }
});

test('Square S1 transport rejects non-identity endpoints, queries, and payment paths before credential read', async () => {
  let credentialRead = 0;
  const transport = new FetchSquareS1Transport(() => {
    credentialRead++;
    return synthetic();
  }, async () => {
    throw new Error('unexpected network access');
  });
  const requests = [
    {url: 'https://connect.squareup.com/v2/merchants/me', method: 'GET'},
    {url: SQUARE_SANDBOX_ORIGIN + '/v2/merchants/me?next=evil', method: 'GET'},
    {url: 'https://connect.squareupsandbox.com.evil.invalid/v2/locations', method: 'GET'},
    {url: SQUARE_SANDBOX_ORIGIN + '/v2/payments', method: 'POST'},
    {url: SQUARE_SANDBOX_ORIGIN + '/v2/refunds', method: 'POST'},
    {url: SQUARE_SANDBOX_ORIGIN + '/v2/payments/id', method: 'GET'},
  ] as const;

  for (const r of requests) {
    await assert.rejects(
      transport.send({
        method: r.method,
        url: r.url,
        version: SQUARE_VERSION,
        signal: new AbortController().signal,
      }),
      {code: 'SQUARE_REQUEST_REJECTED'}
    );
  }

  assert.equal(credentialRead, 0);
});

test('Square S1 acceptance blocks non-sandbox, non-POST, missing intent, and body/query inputs before fetch', async () => {
  const calls: FixtureCall[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({url, init});
    return jsonResponse({});
  };

  const production = createSquareS1Acceptance(
    acceptanceEnv({SQUARE_ENVIRONMENT: 'PRODUCTION', SQUARE_SANDBOX_ACCESS_TOKEN: synthetic()}),
    fetch
  );
  const previewMissingToken = createSquareS1Acceptance(
    acceptanceEnv({SQUARE_SANDBOX_ACCESS_TOKEN: ''}),
    fetch
  );
  const preview = createSquareS1Acceptance(acceptanceEnv(), fetch);

  const envResponse = await production(new Request('https://fixture.invalid', {method: 'POST', headers: {'X-ZAO-Acceptance': 'SQUARE_S1_V1'}}));
  assert.equal(envResponse.status, 404);

  const methodResponse = await preview(new Request('https://fixture.invalid', {method: 'GET'}));
  assert.equal(methodResponse.status, 405);

  const intentResponse = await preview(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: {'sec-fetch-site': 'cross-site'},
  }));
  assert.equal(intentResponse.status, 400);

  const queryResponse = await preview(new Request('https://fixture.invalid?next=1', {
    method: 'POST',
    headers: {'X-ZAO-Acceptance': 'SQUARE_S1_V1'},
  }));
  assert.equal(queryResponse.status, 400);

  const bodyResponse = await preview(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: {'X-ZAO-Acceptance': 'SQUARE_S1_V1', 'content-type': 'application/json'},
    body: '{}',
  }));
  assert.equal(bodyResponse.status, 400);

  const missingTokenResponse = await previewMissingToken(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: {'X-ZAO-Acceptance': 'SQUARE_S1_V1'},
  }));
  const missingBody = await missingTokenResponse.json();

  assert.equal(missingTokenResponse.status, 503);
  assert.equal(missingBody.error, 'S1_CREDENTIAL_UNCONFIGURED');
  assert.equal(calls.length, 0);
});

test('Square S1 acceptance rejects VERCEL_ENV=production even when SQUARE_ENVIRONMENT is SANDBOX', async () => {
  const calls: FixtureCall[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({url, init});
    return jsonResponse({});
  };

  const handler = createSquareS1Acceptance(
    acceptanceEnv({VERCEL_ENV: 'production'}),
    fetch
  );
  const response = await handler(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: {'X-ZAO-Acceptance': 'SQUARE_S1_V1'},
  }));

  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});

test('Square S1 transport enforces strict identity headers/credentials and rejects redirect responses before body parse', async () => {
  const token = synthetic();
  const f = makeFetch([
    () => new Response('redirected', {status: 302, headers: {'content-type': 'text/plain'}}),
  ]);

  const service = new SquareS1Service('synthetic-location', new FetchSquareS1Transport(() => token, f.fetch));
  const result = await service.run();

  assert.equal(result.requestCount, 1);
  assert.equal(result.result, 'S1_FAIL');
  assert.equal(result.reason, 'PROVIDER_FAILURE');
  assert.equal(result.httpResults.merchant, 302);
  assert.equal(result.httpResults.locations, null);

  const first = f.calls[0]!;
  const headers = new Headers(first.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer ' + token);
  assert.equal(headers.get('square-version'), SQUARE_VERSION);
  assert.equal(first.init.redirect, 'error');
  assert.equal(first.init.credentials, 'omit');
  assert.equal(first.init.cache, 'no-store');
});

test('Square S1 acceptance redacts its actual injected synthetic token reflected in merchant identity', async () => {
  const token=synthetic();
  const f=makeFetch([
    ()=>jsonResponse({merchant:merchant({id:token})}),
    ()=>jsonResponse({locations:[location({merchant_id:token})]}),
  ]);
  const handler=createSquareS1Acceptance(acceptanceEnv({SQUARE_SANDBOX_ACCESS_TOKEN:token}),f.fetch);
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'X-ZAO-Acceptance':'SQUARE_S1_V1'}}));
  const result=await response.json();
  assert.equal(response.status,422);assert.equal(result.result,'S1_FAIL');assert.equal(result.reason,'SCHEMA_MISMATCH');
  assert.equal(result.requestCount,2);assert.deepEqual(result.httpResults,{merchant:200,locations:200});assert.equal(JSON.stringify(result).includes(token),false);
});

test('Square S1 transport fails closed on oversized location payload', async () => {
  const large = 'x'.repeat(1024 * 1024 + 1);
  const f = makeFetch([
    () => jsonResponse({merchant: merchant()}),
    () => new Response(large, {status: 200, headers: {'content-type': 'application/json'}}),
  ]);

  const result = await new SquareS1Service('synthetic-location', new FetchSquareS1Transport(() => synthetic(), f.fetch)).run();

  assert.equal(result.requestCount, 2);
  assert.equal(result.result, 'S1_FAIL');
  assert.equal(result.reason, 'SCHEMA_MISMATCH');
  assert.equal(result.httpResults.merchant, 200);
  assert.equal(result.httpResults.locations, 200);
});

test('Square S1 transport fails schema when provider content-type is not application/json', async () => {
  const f = makeFetch([
    () => new Response(JSON.stringify({merchant: merchant()}), {status: 200, headers: {'content-type': 'text/plain'}}),
  ]);

  const result = await new SquareS1Service('synthetic-location', new FetchSquareS1Transport(() => synthetic(), f.fetch)).run();
  assert.equal(result.requestCount, 1);
  assert.equal(result.result, 'S1_FAIL');
  assert.equal(result.reason, 'SCHEMA_MISMATCH');
});

test('Square S1 acceptance never exposes raw provider diagnostic body', async () => {
  const token = synthetic();
  const f = makeFetch([
    () => new Response(JSON.stringify({errors: [{code: 'TOKEN_LEAK', detail: token}]}), {status: 200, headers: {'content-type': 'application/json'}}),
  ]);
  const handler = createSquareS1Acceptance(acceptanceEnv(), f.fetch);
  const response = await handler(new Request('https://fixture.invalid', {method: 'POST', headers: {'X-ZAO-Acceptance': 'SQUARE_S1_V1'}}));
  const body = await response.json();
  const encoded = JSON.stringify(body);

  assert.equal(response.status, 422);
  assert.equal(body.result, 'S1_FAIL');
  assert.equal(body.reason, 'SCHEMA_MISMATCH');
  assert.equal(body.requestCount, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(body.httpResults.merchant, 200);
  assert.equal(encoded.includes(token), false);
  assert.equal(Object.hasOwn(body, 'raw'), false);
  assert.equal(Object.hasOwn(body, 'errors'), false);
  assert.equal(Object.hasOwn(body, 'merchant'), false);
});

test('Square S1 acceptance hides secret fields and does not surface raw provider payload in response', async () => {
  const f = makeFetch([
    () => {
      const response = jsonResponse({merchant: merchant(), raw: 'sensitive-provider-field', secret: 'synthetic-token-field'});
      return response;
    },
    () => jsonResponse({locations: [location({capabilities: []})]}),
  ]);

  const handler = createSquareS1Acceptance(acceptanceEnv(), f.fetch);
  const response = await handler(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: {
      'X-ZAO-Acceptance': 'SQUARE_S1_V1',
      'Content-Type': 'application/json',
    },
  }));
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.reason, 'CAPABILITY_MISSING');
  assert.equal(body.result, 'S1_WARNING');
  assert.equal(body.cardProcessingCapability, false);
  assert.equal(Object.hasOwn(body, 'raw'), false);
  assert.equal(Object.hasOwn(body, 'secret'), false);
  assert.equal(Object.hasOwn(body, 'SQUARE_SANDBOX_ACCESS_TOKEN'), false);
  assert.equal(Object.hasOwn(body, 'errors'), false);
  assert.equal(f.calls.length, 2);
});

test('Square S1 acceptance applies an in-instance once guard without distributed semantics', async () => {
  const f = makeFetch([
    () => jsonResponse({merchant: merchant()}),
    () => jsonResponse({locations: [location()]}),
  ]);

  const handler = createSquareS1Acceptance(acceptanceEnv(), f.fetch);
  const request = new Request('https://fixture.invalid', {method: 'POST', headers: {'X-ZAO-Acceptance': 'SQUARE_S1_V1'}});

  const first = await handler(request.clone());
  const second = await handler(request.clone());

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error, 'S1_ALREADY_ATTEMPTED');
  assert.equal(f.calls.length, 2);
});

test('Square S1 accepts an empty streamed POST from Next Node adapter; concurrent duplicate never sends more than two calls in one instance',async()=>{
 const f=makeFetch([()=>jsonResponse({merchant:merchant()}),()=>jsonResponse({locations:[location()]})]);
 const handler=createSquareS1Acceptance(acceptanceEnv(),f.fetch);
 const request=()=>new Request('https://fixture.invalid',{method:'POST',headers:{'X-ZAO-Acceptance':'SQUARE_S1_V1'},body:new ReadableStream({start(c){c.close();}}),duplex:'half'} as RequestInit);
 const responses=await Promise.all([handler(request()),handler(request())]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(f.calls.length,2);
});
