// Staff/admin UI language (Issue #47 §3). One dictionary for the shared shell, inbox and settings; screens add their own
// keys here as they are converted. Business dates and cancellation boundaries stay JST whatever the display language.
export type StaffLocale='ja'|'en';
export const STAFF_LOCALE_COOKIE='zao_staff_locale';
export const staffLocaleFrom=(v:string|undefined|null):StaffLocale=>v==='en'?'en':'ja';

const D={
 newOrder:['新規予約','New order'],dashboard:['ダッシュボード','Dashboard'],calendar:['カレンダー','Calendar'],
 orders:['予約','Orders'],customers:['顧客','Customers'],inventory:['在庫','Inventory'],documents:['書類','Documents'],
 help:['スタッフQA','Staff Q&A'],reports:['レポート','Reports'],bulk:['一括操作','Bulk operations'],scan:['スキャン','Scan'],scanQr:['QR読取','Scan QR'],scanQrLong:['QRを読み取る（予約QR・用品QR）','Scan QR (booking or item)'],scanBooking:['予約QRを読み取る','Scan a booking QR'],scanAny:['予約QR・用品QRを読み取る','Scan booking or item QR'],settings:['設定','Settings'],
 signOut:['サインアウト','Sign out'],password:['パスワード変更','Change password'],menu:['メニュー','Menu'],close:['閉じる','Close'],
 language:['表示言語','Language'],notifications:['通知','Notifications'],
 inboxTitle:['新しい予約','New bookings'],inboxEmpty:['未確認の予約はありません。','No unacknowledged bookings.'],
 inboxAllEmpty:['予約通知はまだありません。','No booking notifications yet.'],
 inboxUnavailable:['通知を読み込めませんでした。表示中の件数は最新ではない可能性があります。','Could not load notifications. The count shown may be out of date.'],
 retry:['再読み込み','Retry'],acknowledge:['確認済みにする','Mark as seen'],acknowledged:['確認済み','Seen'],
 viewAll:['すべて表示','View all'],openOnly:['未確認のみ','Unacknowledged only'],all:['すべて','All'],loadMore:['さらに表示','Show more'],
 confirmed:['予約確定','Confirmed'],paymentReview:['決済要確認','Payment needs review'],imported:['導入前の予約','Before notifications'],
 people:['名','people'],by:['確認：','Seen by '],
 nowState:['現在：','Now: '],
 browserAlerts:['このブラウザで通知を表示','Show alerts in this browser'],
 browserAlertsHelp:['このブラウザで管理画面を開いている間だけ、別のタブを見ているときに新しい予約をお知らせします（約1分ごとに確認、遅れることがあります）。ブラウザを閉じている間は届きません。受信箱とメールで確認してください。','Only while the staff screen is open in this browser: a new booking is announced when you are on another tab (checked about every minute; may be late). Nothing arrives while the browser is closed. Use the inbox and email.'],
 browserBlocked:['ブラウザ設定で通知が拒否されています。','Notifications are blocked in this browser’s settings.'],
 emailTitle:['新規予約メール','New booking emails'],
 emailOn:['新しい予約が確定したら、自分のログイン用メールアドレスに送る','Email me at my sign-in address when a new booking is confirmed'],
 emailHelp:['予約番号・店舗・受取日時・人数と、ログインが必要な詳細リンクだけを送ります。','Only the booking number, station, pickup date and party size are sent, with a link that requires sign-in.'],
 emailLocale:['メールの言語','Email language'],save:['保存','Save'],saved:['保存しました。','Saved.'],
 saveFailed:['保存できませんでした。もう一度お試しください。','Could not save. Please try again.'],
 staffUsers:['スタッフと権限','Staff and permissions'],prices:['料金','Prices'],content:['公開コンテンツ','Public content'],customerMail:['顧客メール配送','Customer email delivery'],opsConsole:['運用状況（例外）','Operations status'],launch:['公開準備状況','Launch readiness'],stations:['店舗','Stations'],
 search:['予約を検索','Search orders'],
 salesStops:['売り止め（臨時休業）','Sales stops (closures)'],
 coupons:['クーポン','Coupons'],
} as const;
export type StaffKey=keyof typeof D;
export const st=(l:StaffLocale,k:StaffKey)=>D[k][l==='en'?1:0];
