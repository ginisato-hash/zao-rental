import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {publicPages} from '../../packages/core/src/content/public-pages';
import {PUBLICATION_ORIGIN} from '../../packages/auth/src/publication-authority';

// Owner decision (Issue 47, 2026-10-04): the current price list is the consumption-tax-inclusive final payment total.
// This changes wording only; price tables, digests, arithmetic and snapshots are untouched (their own tests pin that).
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');

test('guest, saved-booking and public price pages state that prices include consumption tax in both languages', async () => {
  const guest = await read('apps/web/src/components/GuestBooking.tsx');
  assert.ok(guest.includes('表示料金はすべて税込です。') && guest.includes('All prices include Japanese consumption tax.'));
  const access = await read('apps/web/src/components/BookingAccess.tsx');
  assert.ok(access.includes('予約金額（税込）') && access.includes('Booking total (tax included)'));
  const prices = publicPages.filter(p => p.path === 'prices');
  assert.deepEqual(prices.map(p => p.locale).sort(), ['en', 'ja']);
  assert.ok(prices.find(p => p.locale === 'ja')!.summary.includes('表示料金はすべて税込です。'));
  assert.ok(prices.find(p => p.locale === 'en')!.summary.includes('All prices include Japanese consumption tax.'));
});

test('no customer or staff screen still says the tax basis is unconfirmed or pending', async () => {
  const stale = [/税区分未確認/, /税区分は未確認/, /税区分・利用規約/, /税込・税別の表示基準/, /tax display basis remains/i, /Tax display and terms/, /Price, tax and public approval/];
  const files: string[] = [];
  for (const dir of ['apps/web/src', 'config/content']) {
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await readdir(new URL(relative + '/', root), {withFileTypes: true})) {
        const next = join(relative, entry.name);
        if (entry.isDirectory()) await walk(next); else if (/\.(tsx?|json)$/.test(entry.name)) files.push(next);
      }
    };
    await walk(dir);
  }
  assert.ok(files.length > 50);
  for (const file of files) { const text = await read(file); for (const pattern of stale) assert.ok(!pattern.test(text), `${file} still matches ${pattern}`); }
});

test('the public origin is exactly the Owner-decided host and the retired host is gone from source', async () => {
  assert.equal(PUBLICATION_ORIGIN, 'https://salomon-rental.yuge-zao.com');
  const source = await read('packages/auth/src/publication-authority.ts');
  assert.ok(!source.includes('salomonzao'));
});
