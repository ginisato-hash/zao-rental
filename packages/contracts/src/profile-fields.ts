/** V1.3 keeps only sizing or binding inputs used by the selected product. V1.4 `items` may hold
 * several individual families of one sport; inputs are the union of what those items need. */
export function profileFields(sport:string,itemFamily?:string|null,items?:readonly string[]|null){
 if(items&&items.length)return {height:sport!=='WEAR'&&items.some(f=>f==='SKI'||f==='SNOWBOARD'||f==='POLE'),foot:sport!=='WEAR'&&items.some(f=>f.endsWith('_BOOT')),ski:sport==='SKI'&&items.includes('SKI')};
 return {height:sport!=='WEAR'&&!itemFamily?.endsWith('_BOOT'),foot:sport!=='WEAR'&&(!itemFamily||itemFamily.endsWith('_BOOT')),ski:sport==='SKI'&&(!itemFamily||itemFamily==='SKI')};
}
