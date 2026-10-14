/** V1.3 keeps only sizing or binding inputs used by the selected product. */
export function profileFields(sport:string,itemFamily?:string|null){return {height:sport!=='WEAR'&&!itemFamily?.endsWith('_BOOT'),foot:sport!=='WEAR'&&(!itemFamily||itemFamily.endsWith('_BOOT')),ski:sport==='SKI'&&(!itemFamily||itemFamily==='SKI')};}
