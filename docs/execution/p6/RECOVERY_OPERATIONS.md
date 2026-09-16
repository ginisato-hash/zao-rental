# 予約確認の復旧配送・運用案

状態: provider未選定/未接続、実配送0、support policy未承認。read-only summary/QR以外の権限は追加しない。

| 候補 | 運用上の評価 | 接続前に閉じること |
|---|---|---|
| Resend email API | 小さなNode実装に合わせやすい。API idempotencyを提供する | key保持は24hなのでアプリ側のdurable照合を置換しない。応答喪失時に自前messageIdから配送を証明できるlookup/event対応が必要 |
| Amazon SES | AWSのsecret/監査を採用する場合に管理先をまとめられる | identity/DKIM、sandbox制約、production access、送信event処理が必要。send自体が同一キー冪等であると仮定しない |
| SMS（後日候補） | メールを失ったケースの代替候補にはなる | 電話番号検証、番号変更/SIM乗取、費用、同意、国/配送制約。今の連絡先から番号を捏造せず、契約も行わない |

Resendのkeyは24h保持。[公式idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)。SESはregionごとのsandbox/送信承認条件を持つ。[公式SES手順](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)。いずれも実providerの所有・到達性・費用は未確認。

## 採用候補の運用フロー（Owner承認待ち）

- 元の認証済guestが有効confirmed bookingの保存済み連絡先へ復旧手段を準備する。browser指定の任意宛先へ送らない。
- 配送は専用transactional template、追跡pixel/link rewriting OFF、SPF/DKIM/DMARC、bounce/complaint抑止、合成allowlist配送から検証する。API acceptedと実到達/DELIVEREDを分ける。
- raw codeをURL/query/analyticsへ入れず、固定の確認画面で入力する方式を維持。providerログ/サポート画面の本文保持・redaction/retentionも選定条件。repoへ本文や宛先を記録しない。
- `BookingRecoveryDelivery`はmessageIdによるdedupとlookupが必須。送信前durable行を確保済みで、crash/timeout後はlookupだけ。providerが配送を証明できなければUNKNOWNのまま人の調査へ渡し、別キーで自動再送しない。
- 交換は一回限り、同一exchange keyの応答喪失照合だけ元結果を返す。別キー・失効・revoke・期限切れは拒否し、guest/HOLD期限を延長しない。
- 予約の返却期限を超えたら使えない。期限切れ対応が必要なら予約内容を再発行する権限をこのcapabilityに付けず、別の本人確認/サポート業務へ分離する。
- 将来cancelを実装する時はcancelとcapability/recovery失効を原子的に行う。現booking stateにcancel処理がない点は未実装として残す。現DBがCONFIRMED以外を拒否することだけでcancel運用完了とはしない。

## lost-device / lost-proofとsupport

復旧codeを事前に受け取っていれば、元Cookieを失った端末でも同じread-only交換へ進める。
元Cookieもcodeも失った場合、現実装はメールアドレス/予約番号だけでは新しいcodeを発行しない。本人確認済みsupportによる再発行手順・権限・記録は追加の承認/実装が必要。
候補: 登録済み連絡先の支配確認を独立に行い、担当staff/理由/対象booking/旧cap失効を監査する。browserの連絡先上書き、最初の申請者、予約QRの所持だけを本人確認としない。返金/予約変更/在庫操作は別権限のまま。
support受付時間、復旧期限後の閲覧可否、代替本人確認基準、宛先変更の審査基準はOWNER_PENDING。コードへ推測値を入れない。

## rate/abuseの提案（未設定・未実装）

新しい配送再発行の候補はbooking単位60秒間隔・1時間3回を上限とし、失敗認証/配送bounce/全体日額予算で抑止。これはBALANCED guest入力180/min・1200/minとは別の案で、即時有効化しない。
同じrequest key照合を新規配送回数として消費せず、booking有無を公開レスポンスで識別させない。proof総当たり、宛先爆撃、同一NAT家族、複数instanceを接続前に再現する。
現guard未接続のまま公開せず、provider・support policy・配送上限・retention・本番compositionの承認と実証が揃うまで503を維持する。
