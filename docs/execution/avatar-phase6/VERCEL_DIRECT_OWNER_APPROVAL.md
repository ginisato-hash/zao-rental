【Owner Direct Approval｜AVATAR PHASE 6 Dedicated Vercel Project】

継続指示 §7 の専用Vercel project作成を正式に承認する。

対象:
zao-rental-avatar-preview

許可範囲:

- 新規Vercel project作成: 最大1件
- 用途: AVATAR PHASE 6 protected Preview専用
- Vercel Authentication / Deployment Protection: ON
- Preview-only env設定: 許可
- Preview deploy: 最大2回
- custom domain: 0
- Production deploy: 0
- Production alias: 0
- main merge: 0

明示禁止:

- 既存 `zao-rental` projectへのPhase6 deploy
- SQUARE_* env
- PAYMENT_* env
- REFUND_* env
- WEBHOOK_* env
- Production secrets
- public bypass/share URL
- paid upgrade / paid add-on
- Production環境への変更

この承認は、過去の「Vercel mutation禁止」を
上記Phase6専用projectの範囲に限って明示的に上書きする。

上記範囲内では追加のOwner確認は不要。

project作成
→ Preview-only env
→ Square env count 0確認
→ Deployment Protection確認
→ protected Preview deploy
→ Hosted GuestBooking E2E
→ Claude final review

まで継続してよい。

Phase7へは自動継続しない。
