"""Validate operational seed/configuration, NOT runtime business transactions.

Actual concurrency, authorization, device, transport and Square integration
scenarios are a future implementation gate in OPERATIONAL_ACCEPTANCE.md.
"""
import hashlib
import json
import re
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class OperationsSeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy = json.loads((ROOT / 'config/operations/zao-ops-v1.draft.json').read_text(encoding='utf-8'))
        cls.pricing = json.loads((ROOT / 'config/pricing/zao-2026-27-v1.draft.json').read_text(encoding='utf-8'))

    def test_not_a_production_activation(self):
        p = self.policy
        self.assertEqual(p['status'], 'DRAFT')
        self.assertFalse(p['production_activated'])
        self.assertIsNone(p['effective_from'])

    def test_timezone_and_two_store_scope(self):
        self.assertEqual(self.policy['timezone'], 'Asia/Tokyo')
        self.assertEqual(self.policy['stores'], ['MOUNTAIN_BASE', 'ONSEN_BASE'])
        self.assertEqual(self.policy['stores'], self.pricing['stores'])

    def test_hours_and_no_new_cutoff(self):
        h = self.policy['business_hours']
        self.assertEqual((h['open'], h['close']), ('08:30', '17:00'))
        self.assertIsNone(h['separate_final_checkout_cutoff'])
        self.assertFalse(h['previous_day_pickup_allowed'])

    def test_rental_windows_and_ten_day_limit(self):
        w = self.policy['rental_windows']
        self.assertEqual(w['HALF_DAY_AM'], {'starts_at_local': '08:30', 'return_due_local': '12:00'})
        self.assertEqual(w['HALF_DAY_PM'], {'starts_at_local': '13:00', 'return_due_local': '17:00'})
        self.assertEqual(w['WHOLE_DAY']['minimum_days'], 1)
        self.assertEqual(w['WHOLE_DAY']['maximum_days'], 10)
        for spec in w.values():
            self.assertLess(datetime.strptime(spec['starts_at_local'], '%H:%M'),
                            datetime.strptime(spec['return_due_local'], '%H:%M'))

    def test_future_gap_does_not_enable_rotation(self):
        w = self.policy['rental_windows']
        gap = (datetime.strptime(w['HALF_DAY_PM']['starts_at_local'], '%H:%M') -
               datetime.strptime(w['HALF_DAY_AM']['return_due_local'], '%H:%M')).total_seconds() / 60
        t = self.policy['turnaround']
        self.assertEqual(gap, 60)
        self.assertFalse(t['same_day_re_rental_enabled'])
        self.assertEqual(t['initial_booking_capacity_policy'], 'WHOLE_RENTAL_DATE_PER_UNIT')
        future = t['future_enablement']
        self.assertTrue(future['supported_in_design'])
        self.assertEqual(future['minimum_planned_am_pm_gap_minutes'], gap)
        self.assertIsNone(future['turnaround_minutes_by_family'])
        self.assertTrue(future['requires_audited_policy_publication'])
        self.assertTrue(future['requires_revalidation_of_existing_commitments'])
        self.assertTrue(future['requires_actual_return_and_inspection_before_checkout'])

    def test_day_block_and_inspection_survive_location_change(self):
        t = self.policy['turnaround']
        self.assertTrue(t['returned_quantity_remains_blocked_same_day'])
        self.assertTrue(t['block_follows_asset_across_stores'])
        self.assertTrue(t['next_day_release_requires_inspection'])
        self.assertTrue(t['same_rental_exchange_is_not_second_customer_rental'])

    def test_transfer_schedule_is_not_guaranteed_ten_minute_readiness(self):
        t = self.policy['transfer']
        self.assertEqual(t['daily_batch_starts_at_local'], '17:00')
        self.assertEqual(t['travel_minutes_estimate'], 10)
        self.assertIsNone(t['loading_and_inspection_minutes'])
        self.assertFalse(t['automatic_receipt_from_clock'])
        self.assertTrue(t['actual_departure_and_receipt_recorded'])
        self.assertTrue(t['receiving_inspection_required'])

    def test_transfer_future_commitment_and_no_retroactive_departure(self):
        t = self.policy['transfer']
        self.assertTrue(t['cross_store_return_allowed'])
        self.assertTrue(t['inter_store_transfer_allowed'])
        self.assertTrue(t['future_capacity_requires_committed_feasible_transfer'])
        self.assertTrue(t['physical_receipt_confirmation_required'])
        self.assertFalse(t['post_departure_additions_allowed'])
        self.assertFalse(t['unreceived_stock_is_pickup_available'])
        self.assertFalse(t['same_day_emergency_transfer_automatically_promised'])

    def test_customer_length_choices_preserve_original_bounds(self):
        s = self.policy['length_choice']
        self.assertEqual(s['choices'], ['RECOMMENDED', 'SHORTER', 'LONGER'])
        self.assertEqual(s['height_offset_cm'], -20)
        self.assertEqual(s['absolute_tolerance_cm'], 15)
        self.assertEqual(s['alternatives_relative_to'], 'INITIAL_RECOMMENDED_AVAILABLE_LENGTH')
        self.assertEqual(s['tolerance_anchor'], 'ORIGINAL_BODY_DERIVED_TARGET')
        self.assertTrue(s['require_actual_candidate_availability'])
        self.assertTrue(s['require_entire_interval_and_pickup_store_feasibility'])
        self.assertEqual(s['unavailable_choice_behavior'], 'DISABLED_WITH_EXPLANATION')

    def test_age_and_tier_isolation_preserved(self):
        s = self.policy['length_choice']
        self.assertFalse(s['cross_age_category_allowed'])
        self.assertFalse(s['silent_tier_change_allowed'])
        self.assertFalse(self.pricing['age_category_policy']['cross_category_substitution_allowed'])
        self.assertEqual(self.pricing['age_category_policy']['adult_min_age_years'], 13)

    def test_hold_swap_and_selected_length_contract(self):
        s = self.policy['length_choice']
        self.assertTrue(s['explicit_customer_choice_required'])
        self.assertTrue(s['hold_only_selected_choice'])
        self.assertTrue(s['swap_hold_atomically'])
        self.assertTrue(s['retain_old_hold_if_replacement_fails'])
        self.assertTrue(s['selection_does_not_extend_hold_ttl'])
        self.assertFalse(s['silent_selected_length_substitution_allowed'])
        self.assertTrue(s['final_staff_fit_confirmation_required'])

    def test_no_automatic_refund_or_price_rewrite_on_early_return(self):
        r = self.policy['refund']
        self.assertFalse(r['early_return_auto_refund'])
        self.assertFalse(r['early_return_reprices_original_booking'])
        self.assertTrue(r['inventory_release_independent_of_refund'])

    def test_selected_staff_permission_not_hidden_bypass(self):
        r = self.policy['refund']
        self.assertTrue(r['exception_refund_allowed'])
        self.assertEqual(r['permission'], 'REFUND_OVERRIDE')
        self.assertTrue(r['permission_can_be_granted_to_staff'])
        self.assertFalse(r['ordinary_staff_has_permission_by_default'])
        self.assertTrue(r['unconfigured_permissions_fail_closed'])
        self.assertIsNone(r['role_amount_limits_jpy'])
        self.assertTrue(r['audit_required'])

    def test_refund_amounts_requests_and_uncertainty_guardrails(self):
        r = self.policy['refund']
        self.assertTrue(r['reason_required'])
        self.assertTrue(r['amount_jpy_positive_integer'])
        self.assertTrue(r['partial_refund_supported'])
        self.assertTrue(r['full_refund_supported'])
        self.assertEqual(r['refund_cap'], 'COLLECTED_MINUS_COMPLETED_AND_RESERVED_PENDING_REFUNDS')
        self.assertTrue(r['idempotent_request_required'])
        self.assertTrue(r['unknown_outcome_blocks_new_unrelated_retry'])
        self.assertFalse(r['medical_details_required'])

    def test_owner_facing_hours_and_documents_are_synchronized(self):
        summary = (ROOT / 'docs/PRICING_SUMMARY_JA.md').read_text(encoding='utf-8')
        pricing = (ROOT / 'docs/PRICING.md').read_text(encoding='utf-8')
        self.assertIn('AM（8:30–12:00）', summary)
        self.assertNotIn('AM（8:30–13:00）', summary)
        self.assertIn('AM: 08:30–12:00.', pricing)
        self.assertNotIn('AM: 08:30–13:00.', pricing)
        for name in ['OPERATIONS', 'INVENTORY_RULES', 'RECOMMENDATION_ENGINE', 'REFUND_POLICY', 'STATE_MACHINES']:
            self.assertIn('v0.4', (ROOT / f'docs/{name}.md').read_text(encoding='utf-8'))

    def test_runtime_acceptance_is_not_claimed_as_executed(self):
        text = (ROOT / 'docs/OPERATIONAL_ACCEPTANCE.md').read_text(encoding='utf-8')
        self.assertIn('have NOT been executed', text)
        codes = re.findall(r'^O(\d{2})\.', text, flags=re.M)
        self.assertEqual(codes, [f'{n:02}' for n in range(1, 33)])


if __name__ == '__main__':
    unittest.main()
