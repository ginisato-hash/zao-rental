"""Pack price checks only. Does not run ZAO application's API, DB or CI."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[1]
p=json.loads((ROOT/'pricing/wear_pricebook_v1_2.proposed.json').read_text())
b=json.loads((ROOT/'pricing/base_equipment_v0_4_reference.json').read_text())
w={x['age_category']:x['prices_jpy'] for x in p['products']}
g={x['product_key']:x for x in b['products']}
count=0
results=[]
def check(name,condition):
 global count
 assert condition,name
 count+=1
 results.append({'case':name,'pass':True})
def off(amount,bps):
 if type(amount) is not int or amount<0 or type(bps) is not int or not 0<=bps<=10000:raise ValueError('invalid money/rate')
 return amount-(amount*bps+5000)//10000
check('base SHA preserved',hashlib.sha256((ROOT/'pricing/base_equipment_v0_4_reference.json').read_bytes()).hexdigest()==p['base_reference_sha256'])
check('18 existing products',len(g)==18)
check('216 existing prices',sum(len(x['prices_jpy']) for x in g.values())==216)
for age,table in w.items():
 check(age+' 12 durations',len(table)==12)
 check(age+' AM PM equal',table['HALF_DAY_AM']==table['HALF_DAY_PM'])
 ds=[table[f'DAY_{n}'] for n in range(1,11)]
 check(age+' half below daily',table['HALF_DAY_AM']<ds[0])
 check(age+' half split no cheaper day',2*table['HALF_DAY_AM']>=ds[0])
 for n,v in enumerate(ds,1):
  check(age+f' day{n} positive int',type(v)is int and v>0)
  if n>1:check(age+f' day{n} increasing',v>ds[n-2]);check(age+f' day{n} average nonincrease',v/n<=ds[n-2]/(n-1))
 for n in range(2,10):check(age+f' marginal{n} nonincrease',ds[n]-ds[n-1]<=ds[n-1]-ds[n-2])
 for i in range(1,10):
  for j in range(1,11-i):check(age+f' no split saving {i}+{j}',ds[i+j-1]<=ds[i-1]+ds[j-1])
 for slot,v in table.items():
  check(age+slot+' bundle discounted',0<off(v,2000)<v)
for e in json.loads((ROOT/'verification/golden_prices.json').read_text()):
 v=w[e['age']][e['slot']];gear=0
 if e['equipment_key']:
  prod=g[e['equipment_key']];check(e['name']+' age consistent',prod['age_category']==e['age']);gear=prod['prices_jpy'][e['slot']]
 if e['bundle']:
  check(e['name']+' eligible SET',e['equipment_key'] in p['bundle_adjustment']['qualifying_equipment_products']);v=off(v,2000)
 total=gear+v
 if e['advance']:total=off(total,500)
 check(e['name'],total==e['expected_total'])
check('discount rounding 110->104',off(110,500)==104)
check('no actual production approval',p['chargeReady'] is False and p['sales_effective_from'] is None)
check('blank production cleaning policy',p['inventory']['production_cleaning_turnaround_minutes'] is None)
report={'kind':'REFERENCE_PACK_CHECK_NOT_APPLICATION_TEST','passed':count,'failed':0,'cases':results}
(ROOT/'verification/reference_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':count,'failed':0,'kind':report['kind']}))
