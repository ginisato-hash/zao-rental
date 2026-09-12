import test from 'node:test';
import assert from 'node:assert/strict';
import {matchPeriods,type Demand,type Placement} from '../../packages/core/src/inventory/period-matching';
import {dependencyScope} from '../../packages/core/src/inventory/dependency-scope';
test('transitive date/variant/group custody closure includes later chained requirements, not unrelated groups',()=>{
 const nodes=[{id:'A',start:'01',end:'02',variants:['v1','v2','boot']},{id:'B',start:'02',end:'03',variants:['v2','v3']},{id:'C',start:'03',end:'04',variants:['v3']},{id:'D',start:'05',end:'05',variants:['v1']},{id:'E',start:'01',end:'02',variants:['other']}];
 assert.deepEqual(dependencyScope({id:'candidate',start:'01',end:'01',variants:['v1']},nodes),['A','B','C']);
 nodes[0]!.end='9999-12-31';assert.ok(dependencyScope({id:'candidate',start:'05',end:'05',variants:['v1']},nodes).includes('A'));
 assert.throws(()=>dependencyScope({id:'candidate',start:'01',end:'01',variants:['v1']},nodes,1),{code:'INDETERMINATE'});
});
test('period search with Hall pruning agrees with independent exhaustive enumeration over 250 small fixed-capacity cases',()=>{
 let seed=72531;const rnd=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};const date=(d:number)=>'2038-01-0'+(d+1),units=['a','b','c'];
 for(let caseId=0;caseId<250;caseId++){const cap=new Map(units.map(u=>[u,1+rnd(2)]));const fixed:Placement[]=rnd(2)?[{key:'fixed',unit:units[rnd(3)]!,start:date(1),end:date(1)}]:[];const demands:Demand[]=Array.from({length:1+rnd(5)},(_,i)=>{const start=rnd(3);return {key:'p'+i,start:date(start),end:date(start+rnd(3-start)),candidates:units.filter(()=>rnd(3)!==0)};});
  function brute(i:number,placed:Placement[]):boolean{if(i===demands.length)return true;const d=demands[i]!;for(const unit of d.candidates){const p:Placement={key:d.key,unit,start:d.start,end:d.end};const next=[...placed,p];let valid=true;for(let day=0;day<3;day++)if(next.filter(x=>x.unit===unit&&x.start<=date(day)&&x.end>=date(day)).length>cap.get(unit)!)valid=false;if(valid&&brute(i+1,next))return true;}return false;}
  const expected=brute(0,fixed),actual=matchPeriods(demands,cap,fixed);assert.equal(actual!==null,expected,'case '+caseId);
  if(actual)for(const d of demands){const p=actual.find(x=>x.key===d.key)!;assert.ok(d.candidates.includes(p.unit));assert.equal(p.start,d.start);assert.equal(p.end,d.end);}
 }
});
test('per-day feasibility cannot replace continuous-Asset witness and explicit search limit stays indeterminate',()=>{
 const demands=[{key:'a',start:'2038-01-01',end:'2038-01-02',candidates:['x','y']}];const fixed=[{key:'f1',unit:'x',start:'2038-01-01',end:'2038-01-01'},{key:'f2',unit:'y',start:'2038-01-02',end:'2038-01-02'}];assert.equal(matchPeriods(demands,new Map([['x',1],['y',1]]),fixed),null);assert.throws(()=>matchPeriods(demands,new Map([['x',1],['y',1]]),[],1),{code:'INDETERMINATE'});
});
