import Image from 'next/image';
import {logos,BRAND_NAME} from './brand';
/** Received SALOMON rental station ZAO logo (3.png stacked, white, aspect kept): chosen in P85-03 because the header pill matches
 * the measured Palace width (401 vs 398px) while keeping the full brand name legible. */
export function BrandMark(){return <Image className="pc-logo-img" src={logos.stackedWhite} alt={BRAND_NAME} unoptimized priority/>;}
