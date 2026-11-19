// Staff/admin UI language (Issue #47 §3). One dictionary for the shared shell, inbox and settings; screens add their own
// keys here as they are converted. Business dates and cancellation boundaries stay JST whatever the display language.
export type StaffLocale='ja'|'en';
export const STAFF_LOCALE_COOKIE='zao_staff_locale';
export const staffLocaleFrom=(v:string|undefined|null):StaffLocale=>v==='en'?'en':'ja';

const D={
 newOrder:['新規予約','New order'],dashboard:['ダッシュボード','Dashboard'],calendar:['カレンダー','Calendar'],
 orders:['予約','Orders'],customers:['顧客','Customers'],inventory:['在庫','Inventory'],documents:['書類','Documents'],
 reports:['レポート','Reports'],bulk:['一括操作','Bulk operations'],scan:['スキャン','Scan'],settings:['設定','Settings'],
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
 browserAlertsHelp:['画面を開いている間だけ表示されます。閉じている間はメールと受信箱で確認できます。','Shown only while this page is open. When it is closed, use email and the inbox.'],
 browserBlocked:['ブラウザ設定で通知が拒否されています。','Notifications are blocked in this browser’s settings.'],
 emailTitle:['新規予約メール','New booking emails'],
 emailOn:['新しい予約が確定したら、自分のログイン用メールアドレスに送る','Email me at my sign-in address when a new booking is confirmed'],
 emailHelp:['予約番号・店舗・受取日時・人数と、ログインが必要な詳細リンクだけを送ります。','Only the booking number, station, pickup date and party size are sent, with a link that requires sign-in.'],
 emailLocale:['メールの言語','Email language'],save:['保存','Save'],saved:['保存しました。','Saved.'],
 saveFailed:['保存できませんでした。もう一度お試しください。','Could not save. Please try again.'],
 staffUsers:['スタッフと権限','Staff and permissions'],stations:['店舗','Stations'],
 search:['予約を検索','Search orders'],
} as const;
export type StaffKey=keyof typeof D;
export const st=(l:StaffLocale,k:StaffKey)=>D[k][l==='en'?1:0];
