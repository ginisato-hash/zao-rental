import {readFileSync} from 'node:fs';
import {FakeGateway} from './fixture';
// Isolated synthetic provider process only; no DB connection, credentials or network.
const input=JSON.parse(readFileSync(0,'utf8'));const fake=new FakeGateway(()=>new Date(input.now));
if(!['create','lookup'].includes(input.operation))throw new Error('INVALID_TEST_OPERATION');
const receipt=input.operation==='create'?await fake.create(input.request):await fake.lookup(input.request);
process.stdout.write(JSON.stringify({pid:process.pid,receipt}));
