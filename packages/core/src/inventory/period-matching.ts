import {HoldError} from '../../../contracts/src/hold';
export type Demand={key:string;start:string;end:string;candidates:string[]};
export type Placement={key:string;unit:string;start:string;end:string};
// Resource capacity is tested over all interval endpoints. Asset capacity=1; pole capacity=pairs.
export function fitIntervals(items:Pick<Placement,'start'|'end'>[],capacity:number){
 const changes=new Map<string,number>();for(const p of items){changes.set(p.start,(changes.get(p.start)??0)+1);const after=p.end==='9999-12-31'?'~':new Date(Date.parse(p.end+'T00:00:00Z')+86400000).toISOString().slice(0,10);changes.set(after,(changes.get(after)??0)-1);}
 let used=0;for(const [,delta] of [...changes].sort(([a],[b])=>a<b?-1:a>b?1:0)){used+=delta;if(used>capacity)return false;}return true;
}
export function matchPeriods(demands:Demand[],capacities:Map<string,number>,fixed:Placement[],maxVisits=100000):Placement[]|null{
 const ordered=[...demands].sort((a,b)=>a.candidates.length-b.candidates.length||a.key.localeCompare(b.key));
 const assigned=[...fixed];let visits=0;
 const visit=()=>{if(++visits>maxVisits)throw new HoldError('INDETERMINATE',503);};
 // Necessary capacitated Hall checks at interval starts prune proven shortages
 // (including 9 identical units / 10 people) before factorial witness search.
 // A successful day match is NOT a period witness: the search below still chooses
 // one physical unit for the whole inclusive interval and preserves reallocation.
 const points=[...new Set([...demands.map(d=>d.start),...fixed.map(p=>p.start)])].sort();
 for(const day of points){const active=ordered.filter(d=>d.start<=day&&d.end>=day);if(!active.length)continue;
  const usage=new Map<string,number>();for(const p of fixed)if(p.start<=day&&p.end>=day)usage.set(p.unit,(usage.get(p.unit)??0)+1);
  const owners=new Map<string,number[]>();
  function augment(index:number,seen:Set<string>):boolean{
   const candidates=active[index]!.candidates;
   // Prefer residual free capacity before attempting a displacement chain.
   for(const unit of candidates){visit();if(seen.has(unit))continue;const capacity=(capacities.get(unit)??0)-(usage.get(unit)??0),current=owners.get(unit)??[];
    if(current.length<capacity){current.push(index);owners.set(unit,current);return true;}}
   for(const unit of candidates){visit();if(seen.has(unit))continue;seen.add(unit);const current=owners.get(unit)??[];
    for(let j=0;j<current.length;j++)if(augment(current[j]!,seen)){current[j]=index;return true;}}
   return false;
  }
  for(let i=0;i<active.length;i++)if(!augment(i,new Set()))return null;
 }

 function search(i:number):boolean{if(i===ordered.length)return true;const d=ordered[i]!;
  for(const unit of d.candidates){visit();const p={key:d.key,unit,start:d.start,end:d.end};
   if(!fitIntervals([...assigned.filter(x=>x.unit===unit),p],capacities.get(unit)??0))continue;
   assigned.push(p);if(search(i+1))return true;assigned.pop();
  }return false;
 }
 return search(0)?assigned.slice(fixed.length):null;
}
