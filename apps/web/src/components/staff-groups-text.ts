import {staffError} from './staff-errors';
import type {StaffLocale} from './staff-i18n';

// Administrator screens for group orders (Issue #47 B1/B4/B5). One dictionary, JA/EN. There is deliberately no wording about a deadline,
// an extension or an expiry anywhere: a hold ends only by an administrator's explicit release (or a formal cancellation after confirmation).
type Pair=readonly [string,string];
export const G={
 title:['団体予約','Group orders'],
 listHelp:['お客様が確認依頼を送信した団体です。仮押さえは、管理者が確約または解除するまで続きます。','Groups whose representative sent a review request. A hold stays until an administrator confirms or releases it.'],
 filterStatus:['状態','Status'],filterStore:['店舗','Station'],search:['団体番号・団体名で検索','Search by number or group name'],sort:['並べ替え','Sort'],
 sAll:['受付済みすべて','All submitted'],sHeld:['仮押さえ中（確認待ち・差戻し中）','Holding (awaiting review / changes requested)'],sPending:['確認待ち','Awaiting review'],sChanges:['差戻し中','Changes requested'],sConfirmed:['確約済み','Confirmed'],sReleased:['解除','Released'],sCancelled:['取消','Cancelled'],sDraft:['申請中（未送信）','In progress (not sent)'],
 allStores:['すべての店舗','All stations'],
 oldest:['受信が古い順','Oldest first'],newest:['受信が新しい順','Newest first'],startDate:['利用日が近い順','Usage date'],size:['人数が多い順','Most people'],amount:['金額が大きい順','Highest amount'],
 cNumber:['団体番号','Number'],cName:['団体名','Group'],cStatus:['状態','Status'],cReceived:['受信日時','Received'],cDays:['経過日数','Days held'],cUse:['利用日','Usage date'],cPeople:['人数','People'],cAmount:['金額（税込）','Amount (tax incl.)'],cSettle:['精算','Settlement'],cRequests:['要確認','To check'],cStock:['在庫占有','Stock held'],cStore:['店舗','Station'],cConfirmedBy:['確約者','Confirmed by'],
 none:['該当する団体はありません。','No matching groups.'],loadFailed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],loading:['読み込み中…','Loading…'],
 days:['日','d'],attentionPassed:['利用日経過（要対応）','Usage date passed (action needed)'],attentionSoon:['利用日接近','Usage date soon'],passedDays:['日経過','days ago'],
 held:['占有中','Held'],notHeld:['—','—'],estimate:['暫定','Estimate'],confirmedAmount:['確定','Final'],
 'st.DRAFT':['申請中','Draft'],'st.QUOTED':['見積確認中','Quoted'],'st.REVIEW_HELD':['確認待ち（仮押さえ中）','Awaiting review (held)'],'st.CHANGES_REQUESTED':['差戻し中（仮押さえ中）','Changes requested (held)'],'st.CONFIRMED':['確約済み','Confirmed'],'st.RELEASED':['解除済み','Released'],'st.CANCELLED':['取消済み','Cancelled'],
 'se.UNPAID':['現地精算・未精算','Pay on site · unpaid'],'se.PARTIALLY_PAID':['現地精算・一部受領','Pay on site · partly received'],'se.PAID':['現地精算・受領済み','Pay on site · received'],'se.NO_CHARGE':['0円（精算なし）','No charge'],'se.NOT_APPLICABLE':['確約前','Before confirmation'],
 // entrance
 entTitle:['団体の入口','Group entrance'],entHelp:['お客様に案内する団体専用の入口です。承認も利用回数の制限もなく、いつでも使えます。停止・再発行は管理者の任意操作です。URLは発行した直後にだけ表示できます（保存されているのは照合用の値だけです）。','The single entrance link you give to groups. It needs no approval, has no use limit and always works until you stop it; stopping and reissuing are optional administrator actions. The URL can only be shown right after issuing (only a verification value is stored).'],
 entState:['現在の状態','Current state'],entNone:['未発行','Not issued'],entOn:['受付中','Open'],entOff:['停止中','Stopped'],entGen:['世代','Generation'],
 entReason:['操作の理由（200文字以内）','Reason (up to 200 characters)'],entIssue:['入口URLを発行する','Issue the entrance URL'],entReissue:['入口URLを再発行する','Reissue the entrance URL'],entStop:['入口を停止する','Stop the entrance'],entResume:['入口を再開する','Resume the entrance'],
 entConfirmRotate:['再発行すると、これまでの入口URLは使えなくなります。既存の団体の申請や仮押さえは変わりません。よろしいですか？','Reissuing makes the current entrance URL stop working. Existing applications and holds are not affected. Continue?'],
 entConfirmStop:['入口を停止します。新しい団体の申請だけが止まり、既存の団体の閲覧・仮押さえは変わりません。よろしいですか？','The entrance will be stopped. Only new applications stop; existing groups and holds are unchanged. Continue?'],
 entConfirmResume:['入口を再開します。よろしいですか？','The entrance will be resumed. Continue?'],
 entUrl:['入口URL（この表示を閉じると再表示できません）','Entrance URL (it cannot be shown again after you leave this view)'],entCopy:['URLをコピー','Copy URL'],entCopied:['コピーしました。','Copied.'],entDone:['入口を更新しました。','Entrance updated.'],entHistory:['履歴','History'],
 // detail
 back:['団体予約の一覧へ','Back to group orders'],notFound:['団体が見つかりません。','Group not found.'],
 members:['参加者と用品','Participants and equipment'],mNo:['No.','No.'],mName:['表示名','Label'],mProfile:['プロフィール','Profile'],mItems:['用品とサイズ','Equipment and size'],mFit:['適合','Fit'],mStock:['在庫','Stock'],mPrice:['金額','Price'],mEdit:['サイズを変更','Change sizes'],
 stockHeld:['確保中','Held'],stockNone:['確保なし','Not held'],
 fitEdge:['取扱サイズの端','Edge size'],fitNearest:['最も近い在庫','Nearest available'],fitManual:['店舗確認が必要','Store confirmation required'],fitAdmin:['管理者が選択','Chosen by administrator'],fitNormal:['範囲内','In range'],
 priceBase:['基準','Base'],priceMember:['個別割引','Member discount'],priceGroup:['団体割引','Group discount'],
 editTitle:['サイズ・用品の変更','Change sizes / equipment'],editApply:['変更を適用して在庫を再確保','Apply changes and re-reserve stock'],editCancel:['編集をやめる','Discard edits'],editDiff:['変更内容（変更前 → 変更後）','Changes (before → after)'],
 editNote:['適用すると新しい内容で全員分を1つの取引で確保し直します。確保できない場合は元の仮押さえがそのまま残ります。お客様の再承諾が必要になります。','Applying re-reserves everyone in one transaction. If the new set cannot be reserved the existing hold stays as it is. The representative must accept the re-computed estimate.'],
 editNoChange:['変更はありません。','No changes.'],editApplied:['変更を適用し、全員分を確保し直しました。お客様の再承諾後に確約できます。','Changes applied and everyone was re-reserved. You can confirm after the representative re-accepts.'],
 sizeLabel:['サイズ','Size'],variantsFailed:['サイズ候補を読み込めませんでした。','Could not load size choices.'],
 // summary
 summary:['申込内容','Application'],rep:['代表者','Representative'],email:['メール','Email'],phone:['電話','Phone'],period:['期間','Period'],stations:['受取 / 返却','Pickup / return'],people:['人数','People'],language:['言語','Language'],received:['受信日時','Received'],heldAt:['仮押さえ','Held since'],
 openRequests:['お客様からの依頼','Requests from the representative'],reqChange:['変更の依頼','Change request'],reqDecline:['辞退の依頼','Decline request'],reqAdmin:['管理者からの差戻し','Sent back by administrator'],reqOpen:['未対応','Open'],reqApplied:['適用済み','Applied'],reqRejected:['却下','Rejected'],
 reqHint:['お客様の依頼だけでは何も解放されません。内容を確認し、サイズ変更の適用または仮押さえ解除を管理者が実行します。','A request never releases anything by itself. An administrator applies the change or releases the hold.'],
 attention:['利用予定日を過ぎています。自動では解放されません。日程の再相談、確約、または仮押さえ解除を判断してください。','The usage date has passed. Nothing is released automatically. Decide whether to reschedule, confirm or release the hold.'],
 // quote
 quote:['見積・精算','Quote and settlement'],qSubtotal:['明細合計（税込）','Subtotal (tax incl.)'],qBundle:['セット割引','Set discount'],qMember:['個別割引（管理者）','Member discounts (admin)'],qGroup:['団体割引（管理者）','Group discount (admin)'],qTotal:['合計（税込）','Total (tax incl.)'],
 qProvisional:['現在の見積合計（確約前の暫定額）','Current quote total (provisional, before confirmation)'],qConfirmedTotal:['確定金額（税込）','Confirmed amount (tax incl.)'],
 payOnSite:['お支払い：現地精算のみ','Payment: on site only'],noOnline:['この団体にオンライン決済・前払はありません。','There is no online payment or prepayment for groups.'],
 qReceived:['実際に受領した金額','Received on site'],qOutstanding:['未収','Outstanding'],qNotIncome:['見積・確定額は売上の見込みであり、受領した金額ではありません。受領は下の「現地入金の記録」で記録したものだけです。','Quote and confirmed amounts are expected revenue, not money received. Only receipts recorded below count as received.'],
 consent:['お客様の承諾上限','Representative consent limit'],noConsent:['現在の見積に対するお客様の承諾がありません（確約できません）。','The representative has not accepted the current estimate (cannot be confirmed).'],
 // discount
 disc:['割引','Discounts'],discHelp:['参加者ごと（1人に1方式）→ 団体全体（1方式）の順に、各対象の残額まで。理由が必須です。保存前にプレビューで前後の金額を確認します。','Per participant (one method each), then one group-wide discount, up to each target’s remainder. A reason is required. Preview the before/after amounts before saving.'],
 dNone:['なし','None'],dFixed:['定額（円）','Fixed (JPY)'],dPercent:['割合（%）','Percent (%)'],dValue:['値','Value'],dReason:['理由（200文字以内）','Reason (up to 200 characters)'],dGroupRow:['団体全体','Whole group'],dMemberRow:['参加者','Participant'],dMethod:['方式','Method'],
 dPreview:['プレビュー','Preview'],dSave:['割引を保存','Save discounts'],dReset:['入力をやめる','Reset'],dBefore:['割引前','Before'],dAfter:['割引後','After'],dSaved:['割引を保存しました。','Discounts saved.'],dInvalid:['割引の入力を確認してください（値・理由）。','Check the discount entries (value and reason).'],
 dPreviewFirst:['保存の前に「プレビュー」で内容を確認してください。','Preview before saving.'],dPreviewStale:['入力を変えました。もう一度プレビューしてください。','Entries changed. Preview again.'],dZero:['合計が0円になります。保存後の確約では、0円の確約をあらためて確認します。','The total becomes 0 yen. Confirming will ask you to confirm a no-charge booking explicitly.'],dCurrent:['保存済みの割引','Saved discounts'],dBy:['担当','By'],
 // confirm
 confirmTitle:['確約してメール送信','Confirm and send email'],confirmHelp:['確約すると、予約が確定し、最終金額と下のメッセージを記載した確約メールが代表者へ1通送信されます。支払いは現地精算（未精算）です。','Confirming makes the booking final and sends one confirmation email to the representative with the final amount and the message below. Payment is on site (unpaid).'],
 message:['メッセージ（任意・テキストのみ・2000文字まで）','Message (optional, plain text, up to 2000 characters)'],messageCount:['文字','chars'],
 confirmWill:['確約の内容','What will be confirmed'],confirmBtn:['予約を確約してメール送信','Confirm booking and send email'],confirmNoCharge:['合計が0円です。0円の団体予約として確約することを確認しました。','The total is 0 yen. I confirm this as a no-charge group booking.'],
 confirmFit:['店舗での適合確認が必要な参加者です。確認したうえで確約します：','These participants need a store fit check. Acknowledge them to confirm:'],
 confirmDone:['予約を確約しました。確約メールが1通キューに入りました。','Booking confirmed. One confirmation email was queued.'],confirmDoneReplay:['すでに確約済みです（同じ操作の再送）。','Already confirmed (the same request was replayed).'],
 confirmFinal:['この内容で確約します。','Confirm with these terms.'],
 changesTitle:['差戻し（お客様に変更を依頼）','Send back (ask for changes)'],changesHelp:['仮押さえは変わりません。メッセージ（必須）がお客様に送られます。','The hold stays. The message (required) is sent to the representative.'],changesBtn:['差し戻す','Send back'],changesDone:['差し戻しました。','Sent back.'],changesNeed:['メッセージを入力してください。','Enter a message.'],
 // release
 releaseTitle:['仮押さえ解除','Release the hold'],releaseHelp:['この団体の仮押さえをすべて解放します。確約前にだけ使えます。','Releases every hold of this group. Only before confirmation.'],releaseOpen:['仮押さえを解除…','Release the hold…'],
 releaseConfirmTitle:['解除する内容の確認','Confirm what will be released'],releaseTarget:['対象団体','Group'],releaseWhen:['日程','Dates'],releaseEquip:['用品','Equipment'],releaseResult:['解除すると','Result'],
 releaseEffect:['全員分の確保をまとめて解放し、同じ日程・用品を他の予約が確保できるようになります。一部だけの解除はありません。解除後はこの団体を確約できません（必要なら新しい申請になります）。代表者には解除のお知らせが1通送られます。','Every participant’s reservation is released together and the same dates and equipment become available to other bookings. There is no partial release. This group can no longer be confirmed afterwards (a new application is needed). One release notice is sent to the representative.'],
 releaseReason:['解除の理由（必須・300文字以内）','Reason (required, up to 300 characters)'],releaseMsg:['お客様へのメッセージ（任意）','Message to the representative (optional)'],releaseRun:['解除を実行','Release now'],releaseCancel:['やめる','Cancel'],releaseDone:['仮押さえを解除しました。在庫はすぐに他の予約へ戻りました。','The hold was released. The stock is immediately available to other bookings.'],
 releaseNeed:['理由を入力してください。','Enter a reason.'],
 // cancel confirmed
 cancelTitle:['確約済みの取消','Cancel a confirmed group'],cancelHelp:['確約済みの団体の正式な取消です。在庫を解放します。現地で受領済みの金額があっても、この画面では返金しません（手動で対応してください）。','Formal cancellation of a confirmed group. It releases the stock. Money already received on site is not refunded here (handle it manually).'],
 cancelOpen:['確約を取り消す…','Cancel the confirmed group…'],cancelReason:['取消の理由（必須）','Reason (required)'],cancelRun:['取消を実行','Cancel now'],cancelDone:['取り消しました。','Cancelled.'],cancelRefund:['受領済みの金額（返金は手動）','Received (refund is manual)'],
 // receipts
 payTitle:['現地入金の記録','On-site receipts'],payHelp:['店舗で実際に受け取った金額だけを記録します。訂正は、記録を取り消してから正しい金額を記録し直します。','Record only money actually received at the station. To correct, reverse the entry and record the right amount.'],
 payAmount:['受領金額（円）','Amount received (JPY)'],payMethod:['支払手段','Method'],payAt:['受領日時（日本時間）','Received at (JST)'],payNote:['メモ（任意）','Note (optional)'],payRecord:['受領を記録','Record receipt'],payDone:['受領を記録しました。','Receipt recorded.'],
 mCash:['現金','Cash'],mCard:['店頭のカード','Card at the counter'],mOther:['その他（現地）','Other (on site)'],
 payList:['記録','Entries'],payNone:['受領の記録はまだありません。','No receipts recorded yet.'],payRev:['訂正（取消）','Reverse'],payRevReason:['取消の理由（必須）','Reason (required)'],payRevRun:['この受領を取り消す','Reverse this receipt'],payRevDone:['受領を取り消しました。','Receipt reversed.'],payReversed:['取消済み','Reversed'],payKindReceipt:['受領','Receipt'],payKindReversal:['取消（訂正）','Reversal'],
 payInvalid:['金額（1円以上の整数）と日時を確認してください。','Check the amount (whole yen, at least 1) and the date and time.'],
 // notifications, events
 notif:['メール配送の状態','Email delivery'],notifNone:['まだメールはありません。','No emails yet.'],
 'ev.GROUP_REVIEW_HELD':['仮押さえ受付メール','Review request received'],'ev.GROUP_CONFIRMED':['確約メール','Confirmation'],'ev.GROUP_CHANGES_REQUESTED':['差戻しメール','Changes requested'],'ev.GROUP_RELEASED':['解除メール','Release notice'],'ev.GROUP_CANCELLED':['取消メール','Cancellation'],
 'ns.PENDING':['送信待ち','Queued'],'ns.SENDING':['送信中','Sending'],'ns.SENT':['送信済み','Sent'],'ns.RETRYABLE_FAILURE':['再試行待ち','Will retry'],'ns.PERMANENT_FAILURE':['送信失敗','Failed'],'ns.SUPPRESSED':['送信しない（古い状態）','Suppressed (stale state)'],'ns.UNKNOWN':['配送不明（照合待ち）','Unknown (to be reconciled)'],
 history:['履歴','History'],evActor:['担当','By'],
 noPerm:['この操作の権限がありません。','You do not have permission for this.'],
 busy:['処理中…','Working…'],lostResponse:['応答を受け取れませんでした。同じ操作をもう一度押すと同じ要求として安全に再送されます（二重には実行されません）。','No response was received. Pressing the same action again re-sends the same request safely (it will not run twice).'],
 stale:['ほかの操作で内容が変わりました。最新の内容を読み込みました。確認してからもう一度操作してください。','The group was changed elsewhere. The latest content was loaded. Check it and try again.'],
 reload:['最新の内容に更新','Refresh'],
} as const satisfies Record<string,Pair>;
export type GKey=keyof typeof G;
export const gt=(l:StaffLocale,k:GKey)=>G[k][l==='en'?1:0];

const GE:Record<string,Pair>={
 STALE_REVISION:G.stale,INVALID_STATE:['この状態ではできない操作です。最新の状態を確認してください。','This action is not available in the current state. Check the latest state.'],
 INSUFFICIENT_STOCK:['在庫が不足しているため、全員分を確保できません。元の仮押さえはそのまま残っています。','There is not enough stock for everyone. The existing hold is unchanged.'],
 HOLD_NOT_PROTECTED:['仮押さえの状態が確約の条件に合いません。','The hold no longer meets the confirmation conditions.'],CLAIMS_CHANGED:['確保した在庫の内容が変わっています。','The reserved stock changed.'],
 TRANSFER_RECONCILIATION_REQUIRED:['店舗間移動の照合が必要です。','A station transfer must be reconciled first.'],SALES_STOPPED:['売り止めの日が含まれます。','The dates include a sales stop.'],
 FIT_CONFIRMATION_REQUIRED:['店舗確認が必要な参加者を確認済みにしてください。','Acknowledge the participants who need a store fit check.'],
 CONSENT_REQUIRED:['お客様が現在の見積を承諾していません。','The representative has not accepted the current estimate.'],
 RECONSENT_REQUIRED:['現在の金額がお客様の承諾した内容（上限額）を超えているか、内容が変わっています。お客様の再承諾が必要です。','The current total exceeds what the representative accepted, or the content changed. Re-acceptance is needed.'],
 NO_CHARGE_CONFIRMATION_REQUIRED:['0円で確約するには、確認のチェックが必要です。','Tick the confirmation to confirm a 0-yen booking.'],
 ADJUSTMENT_INVALID:G.dInvalid,ADJUSTMENT_REASON_REQUIRED:['割引の理由を入力してください。','Enter a reason for each discount.'],
 ADJUSTMENT_EXCEEDS_REMAINDER:['割引が対象の残額を超えています。','A discount exceeds what remains of its target.'],ADJUSTMENT_ONE_METHOD_PER_TARGET:['1つの対象に使える割引は1つです。','Only one discount per target.'],ADJUSTMENT_TARGET_UNKNOWN:['割引の対象が見つかりません。','The discount target was not found.'],
 MESSAGE_INVALID:['メッセージを確認してください（2000文字まで、制御文字は使えません）。','Check the message (up to 2000 characters, no control characters).'],REASON_REQUIRED:['理由を入力してください。','Enter a reason.'],
 GROUP_REVERSAL_INVALID:['この受領はすでに取り消されています。','This receipt was already reversed.'],GROUP_NOT_CONNECTED:['団体予約は現在この環境に接続されていません。','Group orders are not connected in this environment.'],
 GROUP_PARTS_INCOMPLETE:['仮押さえの構成が不完全です。','The hold is incomplete.'],ENTRANCE_NOT_CONFIGURED:['入口がまだ発行されていません。','The entrance has not been issued yet.'],
 GROUP_TOO_LARGE:['人数が上限を超えています。','Too many participants.'],GROUP_EMPTY:['参加者がいません。','There are no participants.'],
 IDEMPOTENCY_MISMATCH:['同じ要求番号で内容が異なります。画面を更新してやり直してください。','The same request was sent with different content. Refresh and try again.'],
 INVALID_ID:['対象が正しくありません。','The target is invalid.'],
};
export function groupError(code:string|null|undefined,locale:StaffLocale,detail?:unknown):string{
 if(code&&GE[code]){let t=GE[code][locale==='en'?1:0];
  if(code==='RECONSENT_REQUIRED'&&detail&&typeof detail==='object'){const d=detail as {consentedMaxJpy?:number;totalJpy?:number};if(typeof d.consentedMaxJpy==='number'&&typeof d.totalJpy==='number')t+=locale==='en'?` (accepted up to ¥${d.consentedMaxJpy.toLocaleString('en-US')}, now ¥${d.totalJpy.toLocaleString('en-US')})`:`（承諾上限 ¥${d.consentedMaxJpy.toLocaleString('ja-JP')}／現在 ¥${d.totalJpy.toLocaleString('ja-JP')}）`;}
  return t;}
 return staffError(code,locale);
}
