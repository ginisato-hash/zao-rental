import {HoldError} from '../../../contracts/src/hold';
export type ScopeNode={id:string;start:string;end:string;variants:string[]};
// Group-level transitive closure is conservative: any shared variant at intersecting
// custody intervals connects the whole group, including its other components.
// Cross-store promises extend to infinity until actual custody reconciliation, as in
// the allocator. Never restrict to only the initial day/variants or current witnesses.
export function dependencyScope(candidate:ScopeNode,nodes:ScopeNode[],maxEdges=1000000){
 const buckets=new Map<string,ScopeNode[]>();for(const n of nodes)for(const v of new Set(n.variants)){const b=buckets.get(v)??[];b.push(n);buckets.set(v,b);}
 const selected=new Set<string>(),queue=[candidate];let visited=0;
 for(let i=0;i<queue.length;i++){const n=queue[i]!;for(const v of new Set(n.variants))for(const other of buckets.get(v)??[]){
  if(++visited>maxEdges)throw new HoldError('INDETERMINATE',503);
  if(!selected.has(other.id)&&other.start<=n.end&&other.end>=n.start){selected.add(other.id);queue.push(other);}
 }}return [...selected];
}
