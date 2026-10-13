/** Owner-approved alpine starting point; the technician confirms the physical fit. */
export function suggestPole(heightCm:number,knownSizes:number[]=[]){
 if(!Number.isFinite(heightCm)||heightCm<50||heightCm>250)return null;
 const target=heightCm*0.7,sizes=[...new Set(knownSizes.filter(n=>Number.isFinite(n)&&n>0))];
 // Equal distance chooses the shorter pole, independent of catalogue order.
 return sizes.length?sizes.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b)[0]!:Math.round(target/5)*5;
}
