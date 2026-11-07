# クラウドデプロイと入力スペース疎通 実装計画レビュー

- レビュー日: 2026-11-07
- 対象: `docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md`
- 対象ブランチ: `develop`
- 対象コミット: [`36f702a61f982df26168228fe5cb2ec3cdb43e85`](https://github.com/everyonelovesyou/evluv-lifelog/commit/36f702a61f982df26168228fe5cb2ec3cdb43e85)
- 方法: 計画書を既存のマイグレーション・保存処理・関連資料と照合した静的レビュー

## 結果

実行前に修正したい点が4件あります。

本レビューの P1 / P2 は各指摘の重要度を示します。計画書が参照する DB 設計レビュー内の対応区分とは別です。

## 1. [P1] daily の再保存で、無効フィールドの過去値が消える

対象: [Task 1: 保存処理の変更範囲 (99–102行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/36f702a61f982df26168228fe5cb2ec3cdb43e85/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L99-L102)

既存の `save_record` は、daily 更新時にその記録の値を全件削除してから再登録します。計画では入力取得から無効フィールドを除外するため、再保存するとその値は再登録されず、履歴から失われます。

例えば「外出＋メモ」を保存後、メモを無効化して同じ日を更新するとメモが消えます。`RecordItemCard` が既存値を draft に保持していても、`buildSaveValues` は渡された有効フィールドだけを処理するため、無効フィールドの値は送信されません。

根拠:

- [既存 RPC の daily 更新・全値削除処理](https://github.com/everyonelovesyou/evluv-lifelog/blob/36f702a61f982df26168228fe5cb2ec3cdb43e85/supabase/migrations/20260711000000_init.sql#L288-L321)
- [入力値の組み立て処理](https://github.com/everyonelovesyou/evluv-lifelog/blob/36f702a61f982df26168228fe5cb2ec3cdb43e85/src/features/records/buildSaveValues.ts#L8-L15)

### 修正案

無効フィールドの既存値を保持するよう RPC を変更し、次の順序で回帰確認を追加してください。

1. daily 項目に複数フィールドの値を保存する。
2. 値が存在するフィールドの1つを無効化する。
3. 同じ記録対象日の有効フィールドを更新する。
4. 無効フィールドの既存値が DB と履歴の両方に残ることを確認する。

必須チェックへの1行追加だけでは不足します。

## 2. [P1] スペースの RPC リクエストに apikey がない

対象: [Task 6: 試作スペースの通信仕様 (340–342行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/36f702a61f982df26168228fe5cb2ec3cdb43e85/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L340-L342)

ログイン側には `apikey` の記載がありますが、保存側は `Authorization` だけです。この記述どおりに実装すると、API ゲートウェイで拒否され、RPC に到達できません。

Supabase の REST API は各リクエストに API キーを要求します。

### 修正案

保存側にも `apikey: <公開キー>` を付け、JSON 送信用の `Content-Type: application/json` と引数名を明記してください。

```text
POST /rest/v1/rpc/save_record

apikey: <公開キー>
Authorization: Bearer <access_token>
Content-Type: application/json
```

本文には `p_item_id`、`p_recorded_on`、`p_values` を指定します。

参考: [Supabase: Creating API Routes](https://supabase.com/docs/guides/api/creating-routes)

## 3. [P2] 空の本番 DB では、制約名の事前確認が成立しない

対象: [Task 1: 制約名の確認 (120–129行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/36f702a61f982df26168228fe5cb2ec3cdb43e85/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L120-L129)

「Task 3 の link 後」の SQL エディタでも確認可能としていますが、`link` はマイグレーションを適用しません。新規プロジェクトでは対象テーブル自体が未作成なので、期待する3行は返りません。

また、提示されたクエリは想定した制約名だけを検索するため、名前が異なる制約も発見できません。

### 修正案

事前確認は既存ローカル DB または init SQL で行い、本番での確認は適用後に移してください。

実 DB の制約を調査する場合は、想定した名前だけで絞らず、対象テーブル・スキーマから外部キーと参照先を列挙してください。

## 4. [P2] RESTRICT 追加後のユーザー削除手順が不足している

対象:

- [Task 1: 外部キー変更 (78–93行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/36f702a61f982df26168228fe5cb2ec3cdb43e85/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L78-L93)
- [Task 5: テストユーザーの削除 (315–320行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/36f702a61f982df26168228fe5cb2ec3cdb43e85/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L315-L320)

既存の全4テーブルは `auth.users` から `CASCADE` で削除されます。ここに定義間の `RESTRICT` を加えると、ユーザー削除に伴う連鎖削除が、まだ残っている子行への参照で拒否される懸念があります。

これは静的レビューからの指摘で、実 DB では未検証です。

### 修正案

ユーザー削除の検証を追加し、必要なら値 → 記録 → フィールド → 項目 → ユーザーの順に削除する手順を定めてください。

定義の直接削除と、ユーザー全体の削除を両立させる必要があります。

参考: [Supabase: Cascade Deletes](https://supabase.com/docs/guides/database/postgres/cascade-deletes)

## レビューの前提と検証範囲

- DB 設計レビューの P0-2 (記録済み定義の変更禁止) と P0-4 (書き込み経路の RPC 限定) を今回は見送る判断は、計画内の合意として扱っています。上記はその判断を変更せずに対応できる指摘です。
- レビューは静的確認のみです。DB 適用、実 DB での再現確認、スペースの疎通試験は行っていません。
- 本文は対象コミット時点のレビュー結果です。レビュー保存のために行う資料移動・コミットは、計画の実装や指摘の修正を意味しません。

---

## 再レビュー (2026-11-07)

- 対象コミット: [`a72bb6ad31a83b98fa85d4d89c7f1703f15575c6`](https://github.com/everyonelovesyou/evluv-lifelog/commit/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6)
- 対象: 同じ実装計画の指摘反映後の内容
- 方法: 修正差分と既存の保存処理を照合した静的レビュー

### 前回指摘の確認結果

| 前回の指摘 | 計画上の対応状況 |
| --- | --- |
| 1. daily 再保存時の無効フィールド値の消失 | 有効フィールドの値だけを削除し、無効フィールドの既存値を保持する方針と回帰確認が追加されています。通常の再保存経路は改善していますが、無効化前の画面からの再送について下記 R2 が残っています。 |
| 2. RPC リクエストの apikey 欠落 | 認証・RPC の両方に `apikey` と `Content-Type: application/json` が明記され、計画上対応済みです。 |
| 3. 空の本番 DB に対する制約名の事前確認 | 事前確認は init SQL または既存ローカル DB で行い、本番確認は適用後に移され、計画上対応済みです。 |
| 4. ユーザー削除手順の不足 | 記録を持つテストユーザーの削除検証と、失敗時の手動削除順序が追加され、手順不足は計画上対応済みです。削除動作自体は実 DB 検証待ちです。 |

前回の修正は反映されていますが、保存処理に追加で2件の指摘があります。外部キー変更の説明にも訂正が必要です。

### R1. [P1] 試作ボタンが、同日の既存メモを削除する

対象: [Task 6: 送信内容と疎通確認 (390–405行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L390-L405)

試作は `done=true` だけを送ります。一方、修正後の RPC も有効フィールドの値は削除して再登録するため、同日の外出記録に有効なメモがあれば消えます。

再現条件:

1. 同日の外出記録に `done` と `note` の値が存在し、両フィールドが有効な状態にします。
2. 試作スペースの「外出を記録する」を実行します。
3. RPC は既存の有効フィールド値を削除し、送信された `done` だけを再登録するため、`note` が失われます。

既存値を取得して保持したうえで送信するか、既存記録がある場合は試作の保存を止めてください。同日再保存では行数も増えないため、「1件増える」という確認条件も調整が必要です。

根拠: [既存 RPC の daily 更新と値の再登録処理](https://github.com/everyonelovesyou/evluv-lifelog/blob/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6/supabase/migrations/20260711000000_init.sql#L288-L321)

### R2. [P2] 無効化前から開いていた画面で保存すると、一意制約違反になる

対象: [Task 1: 無効フィールド値の保持 (102–119行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L102-L119)

既存のメモを無効化した後、再読み込みしていない画面から保存すると、そのメモも再送されます。修正後は無効フィールドの既存値が残る一方、INSERT ループは変更しないため、`UNIQUE(record_id, field_id)` に衝突し、保存全体が失敗します。

再現条件:

1. daily 項目にメモを含む記録を保存し、その記録を入力画面で開いておきます。
2. 別の SQL 操作でメモのフィールドを無効化します。
3. 入力画面を再読み込みせず保存します。
4. 保持された既存メモに対して同じ `record_id` / `field_id` の INSERT が行われ、一意制約違反になります。

無効フィールドが送られた場合の扱いを RPC に追加してください。例えば既存値を保持して送信値は無視し、この条件の回帰確認を追加します。

根拠:

- [既存 RPC の値の INSERT ループ](https://github.com/everyonelovesyou/evluv-lifelog/blob/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6/supabase/migrations/20260711000000_init.sql#L305-L322)
- [record_values の一意制約](https://github.com/everyonelovesyou/evluv-lifelog/blob/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6/supabase/migrations/20260711000000_init.sql#L100-L112)
- [入力画面の送信処理](https://github.com/everyonelovesyou/evluv-lifelog/blob/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6/src/features/records/RecordItemCard.tsx#L60-L67)

### 外部キー変更の説明の訂正

対象: [Task 1: 外部キー変更のコメント (78–81行)](https://github.com/everyonelovesyou/evluv-lifelog/blob/a72bb6ad31a83b98fa85d4d89c7f1703f15575c6/docs/superpowers/plans/2026-11-07-cloud-deploy-and-space-prototype.md#L78-L81)

計画中の「RESTRICT は行ごとに即時チェック」「NO ACTION にすればユーザー削除が通る」という説明は訂正した方がよいです。

PostgreSQL では `RESTRICT` も文末で検査されます。遅延指定のない `NO ACTION` と検査時点は同じです。`NO ACTION` は制約を `DEFERRABLE` として定義することで検査をトランザクション末尾へ遅延できる一方、`RESTRICT` は遅延できません。この計画の外部キーには `DEFERRABLE` の指定がないため、検査タイミングの違いを理由に「変更すればユーザー削除が通る」とは断定できません。

前回の私の指摘4も、実 DB で削除失敗を実証したものではなく、検証・手順不足についての懸念です。`RESTRICT` から `NO ACTION` への変更自体を、必須の解決策として示すものではありません。

コメントは検証前の動作を断定しない内容に直し、追加した実 DB の削除テストで判断してください。定義の直接削除が拒否されることと、ユーザー全体の削除時に関連データが残らないことを、それぞれ確認します。

参考:

- [PostgreSQL 開発者による RESTRICT と NO ACTION の検査時点の説明](https://www.postgresql.org/message-id/4271.1233022978%40sss.pgh.pa.us)
- [PostgreSQL: CREATE TABLE (DEFERRABLE / NOT DEFERRABLE)](https://www.postgresql.org/docs/16/sql-createtable.html)

### 再レビューの検証範囲

今回も静的レビューです。計画の修正内容を確認しましたが、DB 適用、実 DB での再現確認、スペースの疎通試験は行っていません。
