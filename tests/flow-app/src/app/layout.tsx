import RootLayout from '../../../../apps/web/src/app/layout';
import {ProductionCopyProvider} from '../../../../apps/web/src/components/ProductionCopy';
export default function FixtureLayout({children}:{children:React.ReactNode}){
 if(process.env.NODE_ENV!=='development')throw new Error('TEST_COMPOSITION_FORBIDDEN');
 return <RootLayout>{process.env.ZAO_TEST_PRODUCTION_COPY==='1'?<ProductionCopyProvider>{children}</ProductionCopyProvider>:children}</RootLayout>;
}
