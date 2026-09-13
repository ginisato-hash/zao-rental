# Guest policy options — all unapproved, documentation only

候補値はこの文書にだけ置く。本番env／configへコピーせず、Owner承認hashと接続先がないproduction compositionは拒否を維持する。数字は当店の実トラフィック測定値でもOWASPの指定値でもなく、Codexの比較提案。

| field | 厳しめ | BALANCED推奨候補 | 入力余裕重視 | 実装上の意味とトレードオフ |
|---|---:|---:|---:|---|
| contextSeconds |1800|3600|7200|作成／復旧時からの固定session有効秒。idle timeoutでも自動スライドでもない。20人の入力・離席と盗用可能時間を交換する |
| absoluteSeconds |43200|86400|172800|作成時からの絶対上限。復旧でも延長なし。長いほど共有端末／漏洩リスク増 |
| recoverySeconds |21600|43200|86400|登録時からの復旧コード期限、absoluteで上限。1回消費。SMS／email本人確認は未接続 |
| replaySeconds |120|600|900|同一復旧code＋同一requestIdの応答喪失回復。新しいcodeの再利用許可ではない。長いほど同じ復旧結果を取得できる窓が広がる |
| retentionSeconds |43200|86400|172800|absolute期限に加算した後にretain対象。即時／全個人情報削除の値ではない |
| windowSeconds |60|60|60|DB共有の固定窓。境界前後には短時間で最大2窓分が通る。平滑化／bot検知ではない |
| peerRequests |60|180|240|canonical peer単位／窓。携帯NAT・ホテルWi-Fiでは別客が同じ枠を共有。IP変化やdistributed botには不十分 |
| globalRequests |600|1200|2400|全replica合計／窓。負荷上限の暫定候補。DBで耐えられる実証済みRPSと解釈しない |

現在のschemaは整数>0、context/recovery<=absolute、replay<=context、global>=peer、window<=3600を要求する。候補3組は満たすが、それは運用承認ではない。HOLD600秒、受付締切、見積・在庫保護・予約確定の寿命は変更しない。

推奨理由：1時間なら家族／20人入力の合間の計測・訂正・スマホ中断を比較しやすく、無期限cookieを避ける。20名で60–100 HTTP要求という仮説を置くとpeer180に余裕があるが、**実画面の要求数・同一NAT人数・混在負荷は未測定**。global1200/分は最大20req/sという予算換算だけで、処理能力保証ではない。初回接続前に1/5/20名、2タブ、3G相当、同一NAT10端末、境界burst、分散peer、復旧誤入力の合成試験を実施し、429率／入力完了率／p95とDB待機を測ってOwnerが決める。新しい課金botサービスは導入しない。

実装制約：contextは通常アクセスで延長しない。absolute後は復旧も不可だが確定済み予約／在庫を失効させる根拠にはならない。**BALANCEDでは24時間後に顧客が再びQR／予約を開く経路をこのguest cookieだけで保証できない。** 長期セルフサービスが必要なら独立した本人確認・復旧方針が必要。単にHOLDやTTLを延ばさない。今は予約の保存とスタッフ権限での引継ぎを別扱いにする。

retainは現在、recovery/replay情報と未送信（preview_id／booking_idなし）draftを限定消去する有限処理。送信済み入力、予約、監査、在庫はこの値では消去しない。未起動なら自動消去されない。実行主体／頻度／失敗監視と送信済み個人情報の法的保管は別Owner gate。P3はスケジュールを作らない。復旧codeやCookieをログ／URL／画像へ残さず、共有端末ではログアウト・失効を案内する。

根拠：server側期限とsecurity/usabilityの均衡は[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)を参照（2026-09-13確認）。OWASPのidle例を、現在の固定context TTLの要件として誤用しない。数値決定は上記の当店用仮説・未実施試験を含むOwner判断。
