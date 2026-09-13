'use client';
import {useState} from 'react';
import {AssetQrInput} from '../../apps/web/src/components/AssetQrInput';
export default function AssetReaderFixture(){const [ids,setIds]=useState<string[]>([]),[visible,setVisible]=useState(true);return <main style={{maxWidth:640,padding:12}}><h1>SYNTHETIC QR input fixture</h1><p>Input component only. No API, candidate persistence, loan or return operation.</p>{visible&&<AssetQrInput onAsset={async id=>{setIds(old=>[...old,id]);}}/>}<button onClick={()=>setVisible(false)}>入力部品を閉じる</button><output aria-label="検出ID一覧">{ids.join(',')}</output></main>;}
