/** Staff Q&A (Owner 2026-11-20): every explanation that used to be scattered over the staff screens lives here, once.
 * Screens show only titles, data, controls, states and errors. Each answer is the screen's former wording (JA/EN). */
type Pair=readonly [string,string];
export type QaItem={q:Pair;a:Pair};
export type QaSection={id:string;title:Pair;items:QaItem[]};
export const STAFF_QA:QaSection[]=[
 {id:'account',title:['ログイン・アカウント','Sign-in and account'],items:[
  {q:['どのアカウントでログインしますか？','Which account do I sign in with?'],a:['管理者が登録した個別のスタッフアカウントでログインします。自由な新規登録はできません。パスワード再設定のメール送信は未接続です。','Sign in with the personal staff account an administrator created for you. There is no self sign-up. Password-reset emails are not connected.']},
  {q:['パスワードの条件は？','What makes a valid password?'],a:['15〜128文字。ほかのサービスと同じものは使わないでください。','15 to 128 characters. Do not reuse one from another service.']},
  {q:['パスワードを変更するとどうなりますか？','What happens when I change my password?'],a:['この端末を含むすべての端末でログアウトします。新しいパスワードでログインし直してください。','You are signed out on every device, including this one. Sign in again with the new password.']},
  {q:['スタッフを作成するときの初期パスワードは？','How is the initial password handled for a new staff member?'],a:['初期パスワードは本人へ安全な方法で伝え、本人が変更してください。画面やログへ再表示しません。','Give the initial password to the person securely and have them change it. It is never shown again on screen or in logs.']},
  {q:['担当業務ごとの標準の権限は？','What does each role allow by default?'],a:['受付担当・責任者・管理者は担当店舗の予約閲覧と返金が標準で可能です（取り消し不可）。閲覧担当の標準は台帳閲覧のみ。料金版設定は全店の管理者への明示付与が必要です。権限の付与と決済・返金・通知の実行は別の操作です。','Front desk, managers and administrators can view bookings and refund at their stations by default (cannot be revoked). Viewers can only view the ledger by default. Setting price versions needs an explicit grant to an all-station administrator. Granting a permission is separate from carrying out payments, refunds or notifications.']},
 ]},
 {id:'today',title:['ダッシュボード・当日作業','Dashboard and today'],items:[
  {q:['「本日の業務」には何が出ますか？','What is under “Today’s work”?'],a:['選んだ店舗・営業日の貸出・返却・検品タスクです。実際の操作は貸出・返却の画面で行います。','Pickup, return and inspection tasks for the chosen station and day. Do the actual work on the pickup/return screen.']},
  {q:['「新着予約」の並びと範囲は？','How are “New bookings” listed?'],a:['受け付けた予約の新しい順（最大20件、利用日に関係なく表示）。決済前の下書きは含みません。自動更新はしないため、「更新」で最新にしてください。','Received bookings, newest first (up to 20, regardless of the rental date). Unpaid drafts are not included. It does not refresh by itself; use Refresh.']},
  {q:['「本日の予約」は入出庫予定表ですか？','Is “Today’s bookings” the full movement schedule?'],a:['本日が利用期間に含まれる予約です。完全な入出庫予定表ではありません。','Bookings whose rental period includes today. It is not a complete movement schedule.']},
  {q:['運用上の注意はどこで確認しますか？','Where do I see operational issues?'],a:['本日の業務カードの「要注意」表示、または運用例外の画面で確認してください。','Check the “Attention” mark on today’s work cards, or the operations exceptions screen.']},
 ]},
 {id:'scan',title:['スキャン・予約検索','Scan and booking search'],items:[
  {q:['何を読み取れますか？','What can I scan?'],a:['読み取る対象（予約／用品）を選び、予約QR、または予約番号を入力します。','Choose what you are scanning (booking or item), then scan a booking QR or enter the booking number.']},
 ]},
 {id:'calendar',title:['カレンダー','Calendar'],items:[
  {q:['バーは何を表していますか？','What do the bars show?'],a:['予定（予約・仮押さえ）と現物（貸出・返却・点検）を分けて表示します。ここでは日程を変更できません。','Planned (booked, hold) and physical (out, returned, care) are shown separately. Dates cannot be changed here.']},
 ]},
 {id:'inventory',title:['在庫・台帳','Inventory and ledger'],items:[
  {q:['「貸出可」とは？','What does “Available now” mean?'],a:['今この店にあり、点検済みで貸せる数です。期間の予約可否は商品詳細で確認します。','What is here, inspected and rentable now. Check bookability for dates on the product page.']},
  {q:['台帳数量は予約できる数ですか？','Is the ledger quantity what can be booked?'],a:['いいえ。台帳数量は予約可能数ではありません。予約可否は期間・店舗を指定して確認してください。','No. Ledger quantities are not bookable quantities. Check bookability for a period and station.']},
  {q:['台帳で何が見られますか？','What can I open in the ledger?'],a:['一覧の「見る」から、個体ID、出典、BSLの確認状況と変更履歴を開けます。','Use View in the list to open the item ID, source, BSL check and change history.']},
  {q:['スキー左右のラベルは？','How are the two ski labels counted?'],a:['スキー左右のラベルは同じIDです。2枚貼っても、台帳は1ペアです。','Both ski labels carry the same ID. Two labels, still one pair in the ledger.']},
  {q:['ウェアの管理方法は？','How is wear tracked?'],a:['ウェアは上下・サイズ別の数量管理です。衣類の個体IDやQRは発行しません。','Wear is counted by top/bottom and size. No item IDs or QR codes are issued for clothing.']},
 ]},
 {id:'documents',title:['書類','Documents'],items:[
  {q:['予約確認書とは？','What is the booking confirmation?'],a:['予約番号で予約を開き、内容を表示・印刷します。領収書・請求書ではありません。','Open a booking by its number to view and print it. It is not a receipt or an invoice.']},
  {q:['作業リストは？','What is the work list?'],a:['店舗と期間を選び、貸出予定・返却予定を印刷します。全件を含められない期間は印刷できません。','Choose a station and period to print going-out and coming-back lists. A period that cannot be printed complete cannot be printed.']},
  {q:['見積・用品ラベルはどこで印刷しますか？','Where are quotes and item labels printed?'],a:['保存した見積は見積の画面で確認できます（作成者・店舗の範囲内）。個体を台帳で開くと、そのQRラベルを印刷できます。','Saved quotes are on the quotes screen (within your own and your stations’ scope). Open an item in the ledger to print its QR label.']},
 ]},
 {id:'reports',title:['レポート','Reports'],items:[
  {q:['「予約」レポートの金額は入金額ですか？','Is the Bookings amount money received?'],a:['いいえ。作成日ごとの予約数（受取店舗）で、予約金額は確定・完了した予約の予約時金額です。','No. It counts bookings by creation date at the pickup station; the amount is the booked price of confirmed or completed bookings.']},
  {q:['「貸出」「返却」レポートの基準は？','What do Pickups and Returns count?'],a:['実際に貸し出した日・店舗ごとの予約数、用品数、ウェア枚数。返却は実際に受領した日・店舗ごとの用品数とウェア枚数です。','Orders, gear items and wear pieces handed out by actual date and station; returns count items received by actual date and station.']},
  {q:['「入金・返金」レポートの基準は？','What does Payments and refunds show?'],a:['実際に動いたお金だけです。入金は完了日、返金は依頼日で集計し、完了・処理中・失敗を分けます。予約金額とは別です。','Only money that actually moved. Payments by completion date, refunds by request date, split into completed, processing and failed. Separate from booked amounts.']},
  {q:['期間の上限は？','How long can the period be?'],a:['最大92日まで。点検待ちのレポートは現在の状態で、期間は使いません。','Up to 92 days. The inspection/care report is the current state and uses no period.']},
 ]},
 {id:'rentals',title:['仮押さえ・見積・貸出返却','Holds, quotes, pickups and returns'],items:[
  {q:['在庫照会の結果は確定ですか？','Is an availability check final?'],a:['照会は参考値です。在庫確保時に再確認します。仮押さえは予約確定・決済・貸出ではありません。期限は10分、条件変更では延長しません。','Checks are estimates and are re-checked when stock is held. A hold is not a booking, payment or loan. It lasts 10 minutes and changing conditions does not extend it.']},
  {q:['サイズの複数選択とは？','What does choosing several sizes mean?'],a:['複数選択は許容する代替候補です。安全適合の自動判定はしません。','Several choices are acceptable alternatives. Safety fit is not judged automatically.']},
  {q:['予備在庫を使うと？','What happens when the reserve stock is used?'],a:['通常販売に残す予備在庫を消費します。店舗権限と承認権限を保存時に再確認します。','It uses the stock kept back from general sale. Station and approval permissions are re-checked on save.']},
  {q:['見積の料金と効力は？','What does a quote mean?'],a:['表示料金は税込です。見積は支払額の確定・在庫確保・請求ではありません。早割は前日15時までの決済完了が必要で、見積では適用見込みのみ確認します。未設定の割引併用は許可せず、クーポンの利用回数は見積では消費しません。条件が仮押さえと異なる場合は拒否し、見積作成で仮押さえを延長しません。','Prices include tax. A quote does not fix the amount, hold stock or charge. The early discount needs payment by 15:00 the day before; a quote only shows whether it would apply. Unconfigured discount combinations are not allowed and coupon uses are not consumed by a quote. Differing conditions from the hold are refused, and creating a quote does not extend the hold.']},
  {q:['料金版の管理は？','How are price versions managed?'],a:['登録済みの料金版と適用期間を確認できます。新しい料金は下書きで編集し、内容を確認してから適用します。正本の価格をコピーしても、その期間を営業日・販売期間として公開しません。過去の予約金額は変わりません。','Registered price versions and their periods are listed. Edit new prices as a draft, review, then apply. Copying the master prices does not publish the period as trading/sales days. Past booking amounts never change.']},
  {q:['サイズ推薦で予約は完了しますか？','Does the size recommendation complete a booking?'],a:['いいえ。候補の照会だけでは在庫を確保しません。全員分を選んでから一括確認します。変更しても10分の期限は延長しません。','No. Checking options does not hold stock. Choose for everyone, then confirm together. Changes do not extend the 10-minute limit.']},
  {q:['返却・検品と返金の関係は？','How do returns, inspection and refunds relate?'],a:['返却受領、検品、同日再貸出の制限は別です。早期返却で自動返金はしません。','Receiving a return, inspection and the same-day re-rental limit are separate. Early returns are not refunded automatically.']},
  {q:['予約変更・返金依頼はどこで？','Where are changes and refund requests made?'],a:['予約変更・返金の画面で行います。早期返却による自動返金はありません。返金状況は「入金と返金残額」で確認してください。','On the changes and refunds screen. Early returns are never refunded automatically. Check refund status under “Payments and refund balance”.']},
 ]},
 {id:'transfers',title:['店舗間移動','Transfers'],items:[
  {q:['移動予定と所在地の関係は？','How do transfer plans relate to location?'],a:['17時便の移動予定と実所在地は別の記録です。自動受領はありません。受領後も準備完了の確認が必要です。','The 17:00 run plan and the actual location are separate records. There is no automatic receipt. After receipt, readiness still has to be confirmed.']},
  {q:['到着見込みの入力は？','When do I enter an arrival estimate?'],a:['担当者が運搬・積込・準備の成立を確認してから入力します。未確認の時間や臨時便を約束しないでください。','Only after checking transport, loading and preparation. Do not promise unconfirmed times or extra runs.']},
 ]},
 {id:'wear',title:['ウェアの貸出・返却','Wear loans and returns'],items:[
  {q:['ウェアの返却手順は？','How are wear returns recorded?'],a:['予約番号で貸出を確認し、ジャケット・パンツそれぞれの返却数量を記録します。候補の保存では返却を確定しません。受領数量を確認して一括確定してください。古い候補は別の貸出へ付け替えません。','Find the loan by booking number and record returned jackets and pants separately. Saving candidates does not confirm the return; check the received quantities and confirm together. Old candidates are never moved to another loan.']},
  {q:['確定に必要なものは？','What does confirming need?'],a:['実際の数量・受領店舗と理由が必要です。移動予定だけで到着数は増えません。','The actual quantity, receiving station and a reason. A transfer plan alone does not add arrivals.']},
  {q:['予約不明の衣類は？','What about clothing without a booking?'],a:['保管し、予約と数量が確認できた場合だけ貸出明細へ結び付けます。確認前は貸出可能数に加算しません。','Keep it aside and link it to a loan only when the booking and quantity are confirmed. Until then it is not added to rentable stock.']},
  {q:['ウェア返却で返金されますか？','Are wear returns refunded?'],a:['返却で自動返金はしません。道具の個体返却とウェア数量返却は、同じ予約・利用者へ別々の受領記録として残します。','Returns are never refunded automatically. Equipment and wear returns are recorded separately for the same booking and person.']},
 ]},
 {id:'admin',title:['管理・公開準備','Administration and launch'],items:[
  {q:['棚卸・CSV取込で在庫は変わりますか？','Does stocktaking or a CSV import change stock?'],a:['照合だけでは在庫を変更しません。所在不明は要確認、異なる店舗で見つかった用品は通常の移動・受領で処理します。取込はファイルを選び、内容を確認してから登録します。','Counting alone never changes stock. Missing items need checking; items found at another station go through the normal transfer and receipt. For imports, choose a file and review it before registering.']},
  {q:['CSV取込の項目ルールは？','What are the CSV import rules?'],a:['個体IDは明示し、不明なBSLは空欄にします。manufacturer_skuは空欄。source_document / source_row は同じ受入れ元で固定します。登録済みの暫定在庫を受領する場合は、その受入元IDを指定し、実物へ移した数量を暫定枠から同時に差し引きます。別の受入元はファイルを分けます。','Give item IDs explicitly and leave unknown BSL empty; manufacturer_sku stays empty; keep source_document / source_row fixed per source. When receiving registered provisional stock, give its source ID; the quantity moved to physical stock is deducted from the provisional bucket at the same time. Use separate files for separate sources.']},
  {q:['商品説明の取込は？','How are product description imports handled?'],a:['商品説明の下書きを取り込み、変更内容を確認します。この構成は合成データの操作確認用で、価格・在庫・公開内容は変更しません。照合は合成のJSON行だけで、実在庫・モデル・価格は登録しません。保存先は専用開発PostgreSQLで、外部storage・本番公開は未接続です。','Import product description drafts and review the changes. This setup is for checking operations with synthetic data and changes no prices, stock or published content. Matching uses synthetic JSON rows only and registers no real stock, models or prices. It saves to the dedicated development PostgreSQL; external storage and publication are not connected.']},
  {q:['写真の取込は？','How are photos handled?'],a:['スキー・ボード両対応。元画像は非公開保存、表示画像はEXIFを除去します。名前の完全一致は候補であり、モデル・権利の確認を代行しません。','Works for skis and boards. Originals are stored privately and displayed images have EXIF removed. An exact name match is only a candidate; it does not confirm the model or rights.']},
  {q:['予約通知の画面では何を確認しますか？','What does the booking notification screen show?'],a:['予約の成立と配送の成否を分けて確認します。結果不明の通知は、配送先へ照会するまで再送できません。','Booking confirmation and delivery are checked separately. A notification with an unknown result cannot be resent until the delivery provider is queried.']},
  {q:['予約確認メールで送る内容は？','What does the booking email contain?'],a:['予約番号・店舗・受取日時・人数と、ログインが必要な詳細リンクだけを送ります。','Only the booking number, station, pickup date and time, number of people and a details link that needs sign-in.']},
  {q:['運用例外の画面では？','What is the operations exceptions screen for?'],a:['発生した問題を確認し、担当者と対応を決めます。「確認」はスタッフが内容を確認したことの記録で、入金・返金・予約・在庫などの状態は変わりません。対応結果は各業務画面で確認します。','Review issues and decide who handles them and how. “Reviewed” only records that staff looked at it; payments, refunds, bookings and stock do not change. Check outcomes on each work screen.']},
  {q:['公開準備の画面では？','What is the launch readiness screen?'],a:['公開に必要な各項目の準備状況を確認します。状態の確認だけで、接続・公開設定は変更しません。','Shows how ready each item needed for launch is. It only shows status and changes no connection or publication settings.']},
 ]},
 {id:'new-order',title:['新規予約','New order'],items:[
  {q:['既存のお客様を選ぶと？','What happens when I choose an existing customer?'],a:['この注文はそのお客様の履歴に入ります。連絡先は次の画面でお客様ご本人に入力・確認していただきます。','The order is added to that customer’s history. Contact details are entered and confirmed by the customer on the next screens.']},
 ]},
];
