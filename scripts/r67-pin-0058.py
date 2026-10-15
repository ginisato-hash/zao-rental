# R67 helper: pin 0058's current sha256 in the reviewed bootstrap manifest (visible reviewed change).
import json,hashlib
p='config/production/bootstrap-source-manifest.json'; d=json.load(open(p))
sha=hashlib.sha256(open('packages/db/migrations/0058_provisional_catalog_bridge.sql','rb').read()).hexdigest()
d['migrations']=[m for m in d['migrations'] if m['id']!='0058']+[{'id':'0058','file':'0058_provisional_catalog_bridge.sql','sha256':sha,'runtimeGuards':0,'guard':None}]
open(p,'w').write(json.dumps(d,indent=1,ensure_ascii=False)+'\n'); print(sha)
