import type {StaffLocale} from './staff-i18n';

// Error and result codes returned by the staff APIs, in both languages (Issue #47: no raw internal codes on screen).
// Screens may still add their own, more specific wording; anything unknown falls back to a plain sentence that keeps
// the code as a reference for support, never as the message itself.
const E:Record<string,[string,string]>={
 UNAUTHENTICATED:['ログインが必要です。','Please sign in.'],AUTHENTICATION_REQUIRED:['ログインが必要です。','Please sign in.'],
 SESSION_CHANGED:['セッションが変わりました。開き直してください。','Your session changed. Please open the screen again.'],
 FORBIDDEN:['この操作の権限がありません。','You do not have permission for this.'],STORE_FORBIDDEN:['担当外の店舗です。','This station is outside your scope.'],
 STORE_SCOPE_REQUIRED:['担当店舗が設定されていません。','No station is assigned to you.'],INVALID_STORE:['店舗を選択してください。','Choose a station.'],
 INVALID_INPUT:['入力内容を確認してください。','Check the entries.'],INVALID_QUERY:['条件を確認してください。','Check the filters.'],
 INVALID_DATE:['有効な日付を入力してください。','Enter a valid date.'],INVALID_TIME:['有効な日本時間の日時を入力してください。','Enter a valid date and time (Japan time).'],
 INVALID_ID:['対象を選択してください。','Choose an item.'],INVALID_VERSION:['表示中の版が古い可能性があります。開き直してください。','What you see may be out of date. Please reopen it.'],
 REASON_REQUIRED:['理由を入力してください（160文字以内）。','Enter a reason (up to 160 characters).'],
 NOT_FOUND:['見つかりませんでした。','Not found.'],CONFLICT:['ほかの操作と競合しました。最新の内容を確認してください。','This conflicted with another change. Check the latest version.'],
 OPERATION_CONFLICT:['ほかの操作と競合しました。最新の内容を確認してください。','This conflicted with another change. Check the latest version.'],
 FLOW_CONFLICT:['ほかの操作と競合しました。最新の内容を確認してください。','This conflicted with another change. Check the latest version.'],
 STALE_VERSION:['ほかの更新がありました。開き直してから操作してください。','Something else changed it. Reopen it and try again.'],
 STALE_SELECTION:['ほかの操作で対象が変わりました。再読み込みしてください。','The selection changed elsewhere. Reload and try again.'],
 STALE_HOLD_VERSION:['仮押さえがほかの操作で変わりました。開き直してください。','The hold changed elsewhere. Please reopen it.'],
 IDEMPOTENCY_MISMATCH:['同じ要求番号で内容が異なります。新しく操作し直してください。','The same request was sent with different content. Start the action again.'],
 INDETERMINATE:['判定できませんでした（混雑または上限）。時間をおいて再確認してください。売り切れとは限りません。','Could not be decided (busy or over a limit). Check again shortly; it is not necessarily sold out.'],
 OPERATION_FAILED:['処理を完了できませんでした。','The operation could not be completed.'],OPERATIONS_FAILED:['処理を完了できませんでした。','The operation could not be completed.'],
 OPERATIONS_UNCONNECTED:['この機能は現在接続されていません。','This function is not connected right now.'],
 CONSTRAINT_VIOLATION:['登録済みの参照先・BSL・数量を確認してください。','Check the referenced records, BSL and quantities.'],
 DUPLICATE_RECORD:['同じ識別子または出典が登録されています。','The same identifier or source is already registered.'],
 STORAGE_NOT_CONNECTED:['台帳の接続準備中です。','The ledger is not connected yet.'],LEDGER_OPERATION_FAILED:['台帳を取得・保存できませんでした。','The ledger could not be read or saved.'],
 INVALID_CONDITIONS:['利用日と全構成品のサイズを選択してください。','Choose the dates and every item size.'],
 INVALID_PERIOD:['利用区分に合う1〜10日の期間を指定してください。','Choose a 1–10 day period that matches the rental type.'],
 VARIANT_MISMATCH:['選択したサイズ・区分を確認してください。','Check the chosen size and type.'],
 INSUFFICIENT:['全期間・全構成品を満たす在庫が不足しています。','There is not enough stock for the whole period and every item.'],
 TRANSFER_PLAN_REQUIRED:['店舗間移動の計画が必要です。','A station transfer has to be planned.'],
 PAYMENT_RECONCILIATION_REQUIRED:['決済状態の照合が必要です。内容は変更していません。','The payment state needs reconciling. Nothing was changed.'],
 PAYMENT_NOT_CONNECTED_CHARGE_DISABLED:['決済は現在接続されていません。','Payment is not connected right now.'],
 BATCH_CLOSED:['この便には追加できません。未発送の便と日付を確認してください。','This run is closed. Check the runs not yet dispatched and their dates.'],
 TRANSFER_CONFLICT:['ほかの確保または移動と競合しました。最新の記録を確認してください。','This conflicted with another hold or transfer. Check the latest records.'],
 SOURCE_PROMISE_CONFLICT:['元店舗の予約に必要な用品です。別の用品を選択してください。','This item is needed for a booking at the source station. Choose another.'],
 SOURCE_NOT_RETURNED_OR_READY:['未返却または準備確認が必要な用品を含むため発送できません。','Cannot dispatch: an item is not returned or not checked ready.'],
 DISPATCH_NOT_ALLOWED:['発送可能な日付・17時以降・便の状態を確認してください。','Check the dispatch date, the 17:00 rule and the run state.'],
 INVALID_READY_ESTIMATE:['準備完了の見込みと必要期限の前後関係を確認してください。','Check that the ready estimate is before the needed-by time.'],
 STOCK_NOT_READY:['元店舗で準備済みの用品を選択してください。','Choose an item that is ready at the source station.'],
 STOCK_CONSTRAINED:['整備・貸出などの制約があります。現物と予定を確認してください。','The item is constrained (maintenance, rental, …). Check the item and schedule.'],
 NOTIFICATION_RATE_LIMITED:['短時間に送信が続いたため止めています。時間をおいてください。','Sending is paused after too many attempts. Please wait.'],
};
export function staffError(code:string|null|undefined,locale:StaffLocale):string{
 if(!code)return '';const hit=E[code];if(hit)return hit[locale==='en'?1:0];
 return locale==='en'?`The operation could not be completed (reference: ${code}).`:`処理を完了できませんでした（参照コード：${code}）。`;
}
export const hasStaffError=(code:string)=>code in E;
