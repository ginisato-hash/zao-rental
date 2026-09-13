import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guestSecurityPolicy} from '../../packages/contracts/src/guest-security';
import {approvedGuestConfiguration} from '../../packages/contracts/src/production-guest';
test('Owner P4 BALANCED values are adopted without approving ingress or production composition',()=>{
 const input=JSON.parse(readFileSync('config/production/guest.p4-approved-policy.json','utf8')),p=guestSecurityPolicy(input.policy),decisions=JSON.parse(readFileSync('config/production/p4-owner-decisions.json','utf8'));
 assert.deepEqual([p.contextSeconds,p.absoluteSeconds,p.recoverySeconds,p.replaySeconds,p.retentionSeconds,p.windowSeconds,p.peerRequests,p.globalRequests],[3600,86400,43200,600,86400,60,180,1200]);
 assert.equal(input.purpose,'GUEST_DRAFT_CHECKOUT_ONLY');assert.equal(input.productionActivation,false);assert.equal(decisions.trustedIngressVerified,false);assert.equal(decisions.independentCouponEnabled,false);assert.equal(decisions.sandbox.actualPaymentCount,0);assert.equal(decisions.sandbox.actualRefundCount,0);
 const pending=JSON.parse(readFileSync('config/production/guest.pending.json','utf8'));assert.throws(()=>approvedGuestConfiguration(pending.configuration,pending.approvedConfigurationSha256));
});
