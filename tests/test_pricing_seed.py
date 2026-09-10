"""Validate the initial pricing seed, not the unimplemented booking application.

Run from the archive root:
    python3 -m unittest discover -s tests -p 'test_pricing_seed.py' -v
"""
import json
import unittest
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / 'config' / 'pricing' / 'zao-2026-27-v1.draft.json'

# Independent expected examples cover all distinct one-day base prices.
EXPECTED = {
    7500: [7500, 13800, 19600, 24900, 29600, 34200, 38300, 42000, 45200, 48000],
    9000: [9000, 16600, 23500, 29900, 35600, 41000, 46000, 50400, 54300, 57600],
    6000: [6000, 11000, 15700, 19900, 23700, 27400, 30700, 33600, 36200, 38400],
    3000: [3000, 5500, 7800, 10000, 11900, 13700, 15300, 16800, 18100, 19200],
    1500: [1500, 2800, 3900, 5000, 5900, 6800, 7700, 8400, 9000, 9600],
    4000: [4000, 7400, 10400, 13300, 15800, 18200, 20400, 22400, 24100, 25600],
    1000: [1000, 1800, 2600, 3300, 4000, 4600, 5100, 5600, 6000, 6400],
}
EXPECTED_HALF = {7500: 5600, 9000: 6800, 6000: 4500, 3000: 2300,
                 1500: 1100, 4000: 3000, 1000: 800}


class PricingSeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with SEED.open(encoding='utf-8') as stream:
            cls.seed = json.load(stream)
        cls.products = cls.seed['products']
        cls.by_key = {p['product_key']: p for p in cls.products}

    def test_product_count_uniqueness_and_duration_completeness(self):
        self.assertEqual(len(self.products), 18)
        self.assertEqual(len(self.by_key), 18)
        expected = {'HALF_DAY_AM', 'HALF_DAY_PM'} | {f'DAY_{d}' for d in range(1, 11)}
        for product in self.products:
            with self.subTest(product=product['product_key']):
                self.assertEqual(set(product['prices_jpy']), expected)

    def test_money_is_positive_integer_yen_on_100_yen_grid(self):
        for product in self.products:
            for duration, price in product['prices_jpy'].items():
                with self.subTest(product=product['product_key'], duration=duration):
                    self.assertIs(type(price), int)
                    self.assertGreater(price, 0)
                    self.assertEqual(price % 100, 0)

    def test_half_day_golden_values_and_same_am_pm(self):
        for product in self.products:
            with self.subTest(product=product['product_key']):
                values = product['prices_jpy']
                self.assertEqual(values['HALF_DAY_AM'], EXPECTED_HALF[product['one_day_jpy']])
                self.assertEqual(values['HALF_DAY_AM'], values['HALF_DAY_PM'])
                self.assertLess(values['HALF_DAY_AM'], values['DAY_1'])

    def test_whole_day_golden_values_keep_approved_curve(self):
        for product in self.products:
            with self.subTest(product=product['product_key']):
                actual = [product['prices_jpy'][f'DAY_{d}'] for d in range(1, 11)]
                self.assertEqual(actual, EXPECTED[product['one_day_jpy']])
                self.assertEqual(actual[0], product['one_day_jpy'])

    def test_generation_metadata_reproduces_initial_whole_day_table(self):
        rates = self.seed['table_generation']['duration_discount_bps']
        for product in self.products:
            for day in range(1, 11):
                value = Decimal(product['one_day_jpy']) * day * (10000 - rates[str(day)]) / 10000
                expected = int((value / 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP) * 100)
                with self.subTest(product=product['product_key'], day=day):
                    self.assertEqual(product['prices_jpy'][f'DAY_{day}'], expected)

    def test_total_increases_average_daily_price_decreases(self):
        for product in self.products:
            prices = [product['prices_jpy'][f'DAY_{d}'] for d in range(1, 11)]
            for day in range(2, 11):
                with self.subTest(product=product['product_key'], day=day):
                    self.assertGreater(prices[day - 1], prices[day - 2])
                    # Compare ratios with integer arithmetic, without float rounding.
                    self.assertLessEqual(prices[day - 1] * (day - 1), prices[day - 2] * day)

    def test_extra_day_increments_remain_positive_nonincreasing(self):
        for product in self.products:
            prices = [0] + [product['prices_jpy'][f'DAY_{d}'] for d in range(1, 11)]
            deltas = [b - a for a, b in zip(prices, prices[1:])]
            with self.subTest(product=product['product_key']):
                self.assertTrue(all(delta > 0 for delta in deltas))
                self.assertTrue(all(a >= b for a, b in zip(deltas, deltas[1:])))

    def test_sets_are_not_more_expensive_than_components(self):
        for product in self.products:
            if product['kind'] != 'SET':
                continue
            sport, category, tier = product['sport'], product['age_category'], product['tier']
            keys = [f'{sport}_EQUIPMENT_ONLY_{category}_{tier}', f'{sport}_BOOTS_ONLY_{category}_STANDARD']
            if sport == 'SKI':
                keys.append(f'SKI_POLES_ONLY_{category}_STANDARD')
            for duration, amount in product['prices_jpy'].items():
                separate = sum(self.by_key[k]['prices_jpy'][duration] for k in keys)
                with self.subTest(product=product['product_key'], duration=duration):
                    self.assertLessEqual(amount, separate)

    def test_catalog_categories_and_pole_policy(self):
        for product in self.products:
            with self.subTest(product=product['product_key']):
                self.assertFalse(product['age_category'] == 'KIDS' and product['tier'] == 'PREMIUM')
                self.assertFalse(product['sport'] == 'SNOWBOARD' and product['kind'] == 'POLES_ONLY')
        policy = self.seed['age_category_policy']
        self.assertEqual(policy['adult_min_age_years'], 13)
        self.assertFalse(policy['cross_category_substitution_allowed'])

    def test_half_day_advance_discount_examples(self):
        expected = {'SKI_SET_ADULT_REGULAR': 5320,
                    'SKI_SET_ADULT_PREMIUM': 6460,
                    'SKI_SET_KIDS_REGULAR': 2850}
        self.assertEqual(self.seed['advance_discount']['discount_bps'], 500)
        self.assertTrue(self.seed['advance_discount']['half_day_eligible'])
        for key, target in expected.items():
            price = self.by_key[key]['prices_jpy']['HALF_DAY_AM']
            self.assertEqual(price * 95 // 100, target)

    def test_no_implicit_production_publication(self):
        self.assertEqual(self.seed['status'], 'DRAFT')
        self.assertIsNone(self.seed['sales_effective_from'])
        self.assertIsNone(self.seed['rental_effective_from'])
        self.assertIsNone(self.seed['rental_effective_to'])
        self.assertEqual(self.seed['tax_display_basis'], 'PENDING_OWNER_CONFIRMATION')
        self.assertEqual(self.seed['stores'], ['MOUNTAIN_BASE', 'ONSEN_BASE'])
        self.assertTrue(self.seed['table_generation']['manual_duration_overrides_allowed'])


if __name__ == '__main__':
    unittest.main()
