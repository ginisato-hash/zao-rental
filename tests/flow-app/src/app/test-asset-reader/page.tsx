import {notFound} from 'next/navigation';
import AssetReaderFixture from '../../../../flow/AssetReaderFixture';
// Separate test app only; never registered by apps/web or enabled by a production flag.
export default function Page(){if(process.env.NODE_ENV!=='development'||!process.env.ZAO_TEST_FLOW_RUNTIME)notFound();return <AssetReaderFixture/>;}
