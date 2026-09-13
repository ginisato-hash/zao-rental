# Hosting / trusted ingress decision package

provider未選択。既存trusted-ingress.tsはRequestに結び付けたout-of-band metadataを受ける境界であり、request headerを読めば実装済みというものではない。実hostingでNextのRequest再生成／cloneをまたげるかは未検証。

| 候補 | 信頼可能とする前提 | strip/overwriteの担当 | アプリへ渡すidentity | fail closed条件 |
|---|---|---|---|---|
| Vercel直結 | Vercelで実行される承認済みdeploymentで、外側proxy構成を把握したplatformが付与するpeer情報 | Vercel edgeはX-Forwarded-Forを上書き。前段proxy利用時に元client IPが保たれると仮定しない | 承認済みplatform adapterがheaderの由来を保証した後、canonical peerとadapter IDをRequestに外側から束縛 | local/devへの同名header、未検証front proxy、複数値、欠損、Request cloneで束縛消失、deployment経路不明 |
| Cloudflare | 自ゾーンへの直接edge ingressと、制御されたWorker／origin経路のみ。任意Workerや直originは含めない | edge/Workerでclient由来の内部headerを除去し、検証済みpeerだけを再付与。originはCloudflare経路以外を遮断する必要 | CF-Connecting-IP由来も信頼経路確認後にcanonical化しout-of-bandで束縛。IPv6／PseudoIPv4設定を明示 | direct-origin、未承認Worker、cross-zone固定IP、PseudoIPv4解釈不明、visitor-IP removal、欠損／clone |
| 一般reverse proxy（例NGINX） | 管理する最終proxyのsocket peer／限定CIDR、認証済みorigin channel | 境界proxyで外来XFF/X-Real-IP/内部identityを破棄してoverwrite。多段時は全hopのtrust設定を明示 | 直socketのremoteAddress又は限定trusted proxyで復元した単一peer。生XFFリストは渡さない | trusted range不明、origin直接到達可、PROXY protocolを任意clientが送信可能、曖昧なchain／header |

Vercel公式は前段proxyのXFF上書き、custom trusted proxyがEnterprise機能であることを説明する。[Vercel request headers](https://vercel.com/docs/headers/request-headers)。これはプラン変更の推奨／承認ではない。VercelのWebhook署名headerを一般ブラウザrequestの証明として流用しない。

Cloudflareのsame-zone Workerはx-real-ip変更の影響を受け、cross-zone Workerでは固定値となる。XFFは追記され得るので先頭を無条件採用しない。[Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)。origin到達制御と自ゾーンWorkerの所有／変更権限を含めて審査する。

NGINXはset_real_ip_fromで信頼送信元を限定し、recursive設定で解釈が変わる。[NGINX realip module](https://nginx.org/en/docs/http/ngx_http_realip_module.html)。全インターネット／0.0.0.0/0をtrustにしない。設定例をこのPRからホストへ適用しない。

全候補で、IPv4/mappedIPv6等価・IPv6表記差・複数instance・同一NAT・攻撃者header・直接origin・proxychain・Next routeまでの同一Request／安全な再束縛をfixtureと選択後の実環境で確認する。HMAC peer keyは識別の仮名化であり本人認証でもbot検知でもない。IPをログへ出さない。

既存Next.js/pg/Argon2ネイティブ依存・sharp・DB接続数を維持した実hosting適合試験も必要。特にCloudflareへのruntime移植はP3で実施・保証しない。Vercelは移植を減らす候補だがprovider決定／公開権限はOwnerに残す。取得日2026-09-13。
