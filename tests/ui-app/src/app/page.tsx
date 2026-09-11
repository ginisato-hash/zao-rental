'use client';
import {LedgerWorkspace} from '../../../../apps/web/src/components/ledger/LedgerWorkspace';
import {fixtureClient} from '../../fixture-client';
// This test-only app is a separate Playwright webServer. Not a route or auth mode in apps/web.
export default function Page(){return <LedgerWorkspace client={fixtureClient} canEdit testNotice/>;}
