import Image from 'next/image';
import {logos,BRAND_NAME} from './brand';
/** Received SALOMON rental station ZAO logo: horizontal on desktop, SALOMON wordmark below 768px (aspect kept). */
export function BrandMark(){return <><Image className="pc-logo-d" src={logos.horizontal} alt={BRAND_NAME} unoptimized priority/><Image className="pc-logo-m" src={logos.wordmark} alt="" aria-hidden="true" unoptimized priority/></>;}
