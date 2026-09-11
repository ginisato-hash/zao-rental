import {test,expect} from '@playwright/test';
import {worktreeIdentity} from '../../scripts/worktree';
test.use({baseURL:`http://127.0.0.1:${worktreeIdentity().webPort+1}`});
test('ledger components show samples, pair labels, scope filters, BSL and readback history',async({page},info)=>{
 await page.goto('/');await expect(page.getByText('6 件の台帳記録')).toBeVisible();await expect(page.getByText('合成サンプルを使った画面テストです。実スタッフのログイン・実在庫ではありません。')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`.local/screenshots/ledger-${info.project.name}-list.png`,fullPage:true});
 await page.getByRole('combobox',{name:'年齢区分',exact:true}).selectOption('KIDS');await expect(page.getByText('1 件の台帳記録')).toBeVisible();await expect(page.getByRole('cell',{name:'子供 / Regular 100 cm',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'クラス',exact:true}).selectOption('PREMIUM');await expect(page.getByText('0 件の台帳記録')).toBeVisible();
 await page.getByRole('combobox',{name:'年齢区分',exact:true}).selectOption('');await page.getByRole('combobox',{name:'クラス',exact:true}).selectOption('');
 await page.getByLabel('サイズ',{exact:true}).fill('160CM');await expect(page.getByText('1 件の台帳記録')).toBeVisible();await expect(page.getByRole('cell',{name:'大人 / Regular 160 cm',exact:true})).toBeVisible();await page.getByLabel('サイズ',{exact:true}).fill('');
 await page.getByRole('button',{name:'詳細：検証用スキーブーツ 26.5 cm'}).click();const detail=page.getByRole('complementary',{name:'台帳詳細'});await expect(detail.getByText('要確認・未記録',{exact:true})).toBeVisible();
 await page.screenshot({path:`.local/screenshots/ledger-${info.project.name}-detail.png`,fullPage:true});
 await page.getByRole('button',{name:'基本情報を更新'}).click();const form=page.getByRole('region',{name:'更新フォーム'});await form.getByLabel('備考',{exact:true}).fill('合成サンプルの表示確認');await form.getByLabel('更新理由').fill('画面テストで確認');await form.getByRole('button',{name:'変更を保存'}).click();await expect(detail.getByText('合成サンプルの表示確認',{exact:true})).toBeVisible();await expect(detail.getByText('更新 · 画面テストで確認')).toBeVisible();
 await page.getByRole('button',{name:'ポール数量',exact:true}).click();await expect(page.getByRole('cell',{name:/6 ペア/})).toBeVisible();await expect(page.getByText('2 件の台帳記録 / 数量単位：ペア（2本）')).toBeVisible();
 await page.getByRole('button',{name:'セット構成',exact:true}).click();await page.getByRole('button',{name:/詳細：スキーセット/}).click();await expect(detail.getByText('ポール × 1 ペア')).toBeVisible();await expect(page.getByRole('cell',{name:'構成定義のみ 物理在庫を増やしません'}).first()).toBeVisible();
});
test('ledger components register a model and reopen its synthetic detail without production auth',async({page})=>{
 await page.goto('/');await expect(page.getByText('6 件の台帳記録')).toBeVisible();await page.getByRole('button',{name:'商品モデル',exact:true}).click();await page.getByRole('button',{name:'＋ 登録',exact:true}).click();const form=page.getByRole('region',{name:'登録フォーム'});
 await form.getByLabel('商品コード').fill('UI-DEMO-MODEL');await form.getByLabel('名称',{exact:true}).fill('画面テスト追加モデル');await form.getByLabel('データ区分').selectOption('SYNTHETIC');await form.getByLabel('出典文書').fill('tests/e2e/ledger-ui.spec.ts');await form.getByLabel('出典の行・セル・記録キー').fill('model-create-case');await form.getByRole('button',{name:'登録を保存'}).click();
 await expect(page.getByText('7 件の台帳記録')).toBeVisible();await page.getByRole('button',{name:'詳細：画面テスト追加モデル UI-DEMO-MODEL'}).click();await expect(page.getByRole('complementary',{name:'台帳詳細'}).getByText('model-create-case')).toBeVisible();
});

test('asset onboarding keeps unknown BSL and pole edit records pair quantity',async({page},info)=>{
 await page.goto('/');await expect(page.getByText('6 件の台帳記録')).toBeVisible();await page.getByRole('button',{name:'＋ 登録',exact:true}).click();const form=page.getByRole('region',{name:'登録フォーム'});
 await form.getByRole('combobox',{name:'サイズ・区分',exact:true}).selectOption('00000000-0000-4000-8000-000000000105');
 await form.getByRole('combobox',{name:'BSL確認状況',exact:true}).selectOption('UNVERIFIED');await form.getByLabel('データ区分').selectOption('SYNTHETIC');await form.getByLabel('出典文書').fill('tests/e2e/ledger-ui.spec.ts');await form.getByLabel('出典の行・セル・記録キー').fill('synthetic-boot-create');
 await page.screenshot({path:`.local/screenshots/ledger-${info.project.name}-registration.png`,fullPage:true});
 await form.getByRole('button',{name:'登録を保存'}).click();await expect(page.getByText('7 件の台帳記録')).toBeVisible();const detail=page.getByRole('complementary',{name:'台帳詳細'});await expect(detail.getByText('要確認・未記録',{exact:true})).toBeVisible();await expect(detail.getByText('synthetic-boot-create')).toBeVisible();
 await page.getByRole('button',{name:'ポール数量',exact:true}).click();await page.getByRole('button',{name:'詳細：検証用ポール 110 cm'}).click();await page.getByRole('button',{name:'基本情報を更新'}).click();const edit=page.getByRole('region',{name:'更新フォーム'});await edit.getByLabel('数量（ペア / 1ペア＝2本）').fill('8');await edit.getByLabel('更新理由').fill('合成サンプルの数量訂正');await edit.getByRole('button',{name:'変更を保存'}).click();await expect(detail.getByText('8 ペア（1ペア＝2本）')).toBeVisible();await expect(detail.getByText('更新 · 合成サンプルの数量訂正')).toBeVisible();
});
