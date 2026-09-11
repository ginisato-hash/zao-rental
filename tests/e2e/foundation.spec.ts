import { expect, test } from '@playwright/test';
test('development shell is honest and customer flow stays closed', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { level: 1 })).toContainText('蔵王のレンタル');
  await expect(page.getByText('この画面は開発用の基盤です。予約受付はまだ開始していません。')).toBeVisible();
  await page.getByRole('link', { name: 'お客様', exact: true }).click(); await expect(page).toHaveURL(/\/customer$/); await expect(page.getByRole('heading', { level: 1 })).toHaveText('予約受付は準備中です');
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
