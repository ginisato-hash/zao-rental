import { expect, test } from '@playwright/test';
test('origin root and the legacy customer entry lead to the public site, not a development shell', async ({ page, request }) => {
  const root = await request.get('/', { maxRedirects: 0 }); expect(root.status()).toBe(307); expect(new URL(root.headers()['location']!, 'http://x').pathname).toBe('/ja');
  const customer = await request.get('/customer', { maxRedirects: 0 }); expect(customer.status()).toBe(307); expect(new URL(customer.headers()['location']!, 'http://x').pathname).toBe('/ja/book');
  await page.goto('/'); await expect(page).toHaveURL(/\/ja$/); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('この画面は開発用の基盤です')).toHaveCount(0);
});
test('scheduled worker route is closed to anonymous callers and uncacheable', async ({ request }) => {
  for (const headers of [{}, { authorization: 'Bearer not-the-secret' }, { 'x-vercel-cron-schedule': '* * * * *' }]) {
    const response = await request.get('/api/internal/worker-tick', { headers });
    expect(response.status()).toBe(401); expect(await response.json()).toEqual({ state: 'UNAUTHORIZED' });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  expect((await request.post('/api/internal/worker-tick')).status()).toBe(405);
});
test('role spoofing cannot unlock staff/admin pages or APIs', async ({ page, request }) => {
  for (const area of ['staff', 'admin']) {
    const response = await request.get(`/api/${area}`, { headers: { 'x-role': 'ADMIN', 'x-user-id': 'fake', cookie: 'role=ADMIN' } });
    expect(response.status()).toBe(401); expect(await response.json()).toEqual({ error: 'AUTHENTICATION_REQUIRED' });
    await page.goto(`/${area}`); await expect(page.getByRole('heading')).toHaveText('認証が必要です');
  }
});
test('health exposes liveness without readiness or credentials', async ({ request }) => {
  const response = await request.get('/api/health'); expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ service: 'zao-rental', stage: 'foundation', bookingAvailable: false });
  expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
});
