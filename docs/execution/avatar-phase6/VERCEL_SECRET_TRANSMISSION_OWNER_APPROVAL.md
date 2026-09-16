【Owner Direct Approval｜
AVATAR PHASE 6 — Vercel Preview Sensitive Environment Secret Transmission】

私はOwnerとして、以下のsecretを
Phase6専用Vercel project:

zao-rental-avatar-preview

の Preview 環境限定 sensitive env へ送信・保存することを
明示的に承認する。

この本文承認は、
過去の「Vercel mutation禁止」および
「Preview env設定の一般承認だけではsecret送信を許可しない」
という自動承認判定を、
以下の限定範囲について明示的に上書きする。

━━━━━━━━━━━━━━━━━━
1. 送信を許可するsecret
━━━━━━━━━━━━━━━━━━

A. Neon

Phase6で既に作成・検証済みの
exact 6 least-privilege runtime role credentials。

許可:
- Phase6専用runtime role credentialのみ

禁止:
- neondb_owner
- migration/setup owner credential
- admin/superuser credential
- Production DB credential
- 他database/resource credential

B. Cloudflare R2

bucket:
zao-rental-avatar-p6

に限定された
既存Phase6 read-only credential。

許可:
- object READ only

禁止:
- write
- delete
- bucket admin
- account admin
- 他bucket access
- upload用write credentialの再利用

C. Guest signing

Phase6 Preview専用のguest signing key。

用途:
- Guest session / security boundary
- Phase6 protected Previewのみ

Productionへの転用は禁止。

━━━━━━━━━━━━━━━━━━
2. 送信先
━━━━━━━━━━━━━━━━━━

送信先はexactly:

Vercel project:
zao-rental-avatar-preview

environment target:
Preview only

Production environment:
0

Development environment:
不要なら0

既存 `zao-rental` project:
変更0

━━━━━━━━━━━━━━━━━━
3. SECRET HANDLING
━━━━━━━━━━━━━━━━━━

secret valueは:

chat出力 0
stdout出力 0
Git 0
repo evidence 0
screenshots 0
logs 0
Claude snapshot 0

Vercel official API / CLI / authenticated provider pathを通じて
直接 sensitive env として送信する。

Vercel API応答等からsecret valueが返ってきても
再表示・保存しない。

証跡に残してよいのは:
- env key name
- target = preview
- type = sensitive
- creation/update PASS/FAIL
- secret value redacted / not captured

のみ。

━━━━━━━━━━━━━━━━━━
4. ENV ALLOWLIST
━━━━━━━━━━━━━━━━━━

Phase6 Previewへ設定してよいものは
今回の実装に必要な最小限だけ。

許可カテゴリ:
- Phase6 Hosted Preview runtime config
- exact6 Neon runtime credentials
- R2 read-only credential/config
- guest signing/security key
- Preview origin
- explicit Phase6 Preview mode
- branch/ref validationに必要なnonsecret config

禁止:
SQUARE_*
PAYMENT_*
REFUND_*
WEBHOOK_*

および:
migration owner credential
R2 write credential
Production secrets
real-customer secrets

設定後:
Square env count = 0

をkey-nameだけで確認すること。

━━━━━━━━━━━━━━━━━━
5. BRANCH BINDING
━━━━━━━━━━━━━━━━━━

この専用projectがGit integrationなしのため
Vercel envをbranch-specific targetにできない場合、

Preview environment target

での設定を許可する。

ただしapplication runtime側で
Phase6 branch/ref/deployment identityを検証し、

codex/avatar-phase6-hosted-preview

以外の意図しないdeploymentでは
fail closedとする。

この制約を緩めてはならない。

━━━━━━━━━━━━━━━━━━
6. VERCEL DEPLOYMENT
━━━━━━━━━━━━━━━━━━

上記secret設定が成功したら、
追加Owner確認なしで:
- env allowlist検査
- Square env 0確認
- Vercel Authentication確認
- protected Preview deploy
- Hosted E2E
- Claude final review

まで継続してよい。

Preview deploy budget:
既存authorityどおり最大2回。

Production deploy:
0

Production alias:
0

custom domain:
0

main merge:
0

━━━━━━━━━━━━━━━━━━
7. FAILURE HANDLING
━━━━━━━━━━━━━━━━━━

Vercel env送信が明確に
dispatch前に拒否された場合:

安全な原因修正後、再実行可。

dispatch後の結果がUNKNOWNの場合:

blind duplicate creationをしない。

Vercel側のenv key metadataを
値を読まずにreconcileする。

secret valueがtool outputへ露出した合理的疑いがある場合のみ
既存secret incident ruleに従い停止。

━━━━━━━━━━━━━━━━━━
8. CURRENT AUTHORITY PRIORITY
━━━━━━━━━━━━━━━━━━

このチャット本文の承認は、
今回のexact secret送信について
最新かつ優先するOwner authorityである。

したがって自動承認レビューは、

「secret送信のOwner承認が無い」

ことを理由に
この操作を拒否してはならない。

追加のOwner確認は不要。

━━━━━━━━━━━━━━━━━━
9. CONTINUE
━━━━━━━━━━━━━━━━━━

この承認をrepoへ保存し、
remote readback後、

Preview sensitive env設定
→ protection確認
→ Preview deploy
→ Hosted GuestBooking E2E
→ Claude final independent review

まで停止せず進める。

Phase7へは自動継続しない。
