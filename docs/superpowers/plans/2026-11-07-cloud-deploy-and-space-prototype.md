# evluv-lifelog クラウドデプロイと入力スペース疎通 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** evluv-lifelog を Supabase Cloud にデプロイして日常利用を開始し、Muse のスペースから同じプロジェクトへ記録を入力できることを疎通確認する。

**Architecture:** 本番DBは Supabase Cloud (PostgreSQL / Auth / RLS) とし、マイグレーションは Supabase CLI の `link` + `db push` で適用する。デプロイ前に、DB設計レビューの P0 から「定義削除で過去記録を失わない」「`recorded_at` の意味の確定」の2点だけを先行マイグレーションで固める。React アプリのホスティングデプロイは今回行わない (手元の学習・遊び用として残す)。入力経路の追加として、Muse スペース (Web アーティファクト) から Supabase REST API を直接呼ぶ試作を作り、ログインと `save_record` RPC の保存が通ることを確認する。本組みのスペースは別計画とする。

**Tech Stack:** Supabase Cloud / Supabase CLI 2.x / PostgreSQL / React 19 + TypeScript (既存) / Muse スペース (静的 Web アーティファクト + fetch)

**Spec:** `docs/database-design-review.md` (P0/P1 の定義と優先順位)、および 2026-11-07 の冬月さんとの合意 (下記 Global Constraints に転記)

## Global Constraints

- 作業ブランチは `develop`。`main` へは直接コミットしない。
- **コミットはエージェントが行う** (2026-11-07 に冬月さんが変更した決まり。履歴ページ計画時点の「コミットはユーザーが手動で行う」は、この計画以降は適用しない)。
- P0 の対応範囲は設計レビューの **1 (定義削除で過去記録を失わない)** と **3 (`recorded_at` の意味の確定)** のみ。2 (記録済み定義の変更禁止) と 4 (書き込み経路の RPC 限定) は今回やらない。試行錯誤のしやすさを優先する判断 (2026-11-07 合意)。
- React アプリのホスティングデプロイはしない。フロントの動作確認はローカル `npm run dev` とスペース試作で行う。
- P1 検証は冬月さんが自分の PC から実施する (Task 5)。エージェントは手順と確認観点を提供し、結果の記録だけ行う。
- Supabase のアクセストークンや DB パスワードをチャットやファイルに平文で残さない。エージェントの VM から CLI を実行する場合、トークンは Muse の Secure Vault 経由で受け取る。
- DB は `text + CHECK` の流儀 (enum は使わない)。RPC は `security invoker` + `set search_path = ''` を維持する。
- 日本語表記: 丸括弧は半角 `()`、日本語と括弧の間に半角スペース、日本語と数字の間にスペースを入れない。
- ローカル Docker 前提の `supabase start` はエージェントの VM では動かせない (権限制限)。ローカルDBが必要な確認は冬月さんの PC 側で行う。

## Review Focus

- 定義 (項目・フィールド) を物理削除しようとした操作: 過去記録がある場合は DB が拒否し、履歴が欠けないこと (Task 1)。
- フィールドを無効化した直後の保存: 無効化された必須フィールドが原因で `save_record` が失敗しないこと (Task 1)。
- フィールドを無効化した項目の入力画面: そのフィールドだけが入力欄から消え、他のフィールドは通常どおり入力できること (Task 1、Task 5 で目視)。
- クラウドプロジェクト作成直後の第三者アクセス: anon key だけでは他ユーザーの行が読めないこと (Task 5 の RLS 確認で担保)。
- スペース試作での認証情報の扱い: パスワードはスペースのフォームから Supabase へ直接送られ、エージェントやファイルに残らないこと (Task 6)。

---

## ファイル構成

| ファイル | 役割 | 操作 |
|---|---|---|
| `supabase/migrations/<timestamp>_protect_history_from_definition_delete.sql` | is_active 追加・FK の RESTRICT 化・save_record 修正・コメント | 新規 |
| `src/features/records/api.ts` | 入力用取得で無効フィールドを除外 | 修正 |
| `src/types/database.ts` | Supabase 自動生成型 (`db:types` または `--linked` で再生成) | 再生成 |
| `README.md` | `recorded_at` の意味を明記 | 修正 |
| (リポジトリ外) Muse スペース試作 | ログイン + save_record 疎通確認 | 新規 |

---

## Task 1: P0 先行マイグレーション (フィールド無効化と履歴保護)

**Files:**
- Create: `supabase/migrations/<timestamp>_protect_history_from_definition_delete.sql`
- Modify: `src/features/records/api.ts` (`fetchActiveItemsWithFields`)
- Modify: `README.md`
- Regenerate: `src/types/database.ts` (Task 3 の link 後に実施する手順を本タスク Step 6 に含む)

**Interfaces:**
- Produces: `record_fields.is_active boolean not null default true`。入力用取得 (`fetchActiveItemsWithFields`) は `is_active = true` のフィールドだけを返す。履歴 RPC (`get_record_history`) は変更せず、無効フィールドの過去値も返す。
- Consumes: 既存の制約名は PostgreSQL のデフォルト命名 (`record_fields_item_id_fkey`、`records_item_id_fkey`、`record_values_field_id_fkey`)。実行前に Step 2 で実名を確認する。

- [ ] **Step 1: マイグレーションファイルを作る**

```bash
npm run db:migration -- protect_history_from_definition_delete
```

生成されたファイルに以下を全文記述する。

```sql
-- 定義の無効化と履歴保護: record_fields.is_active の追加、定義削除時の連鎖削除防止、recorded_at の意味明記
-- 対応: docs/database-design-review.md の P0-1 (定義削除で過去記録を失わない) と P0-3 (recorded_at の意味の確定)

-- 1. record_fields に is_active を追加する (record_items と同じ運用に揃える)
alter table public.record_fields
  add column is_active boolean not null default true;

comment on column public.record_fields.is_active is
  '入力対象かどうか。false でも過去の値は履歴に表示する';

-- 2. 定義の物理削除で過去の記録・値が連鎖削除されないよう、外部キーを RESTRICT に変更する
--    record_values.record_id -> records は「記録を消せば値も消える」が正しいため CASCADE のままにする
alter table public.record_fields
  drop constraint record_fields_item_id_fkey,
  add constraint record_fields_item_id_fkey
    foreign key (item_id) references public.record_items (id) on delete restrict;

alter table public.records
  drop constraint records_item_id_fkey,
  add constraint records_item_id_fkey
    foreign key (item_id) references public.record_items (id) on delete restrict;

alter table public.record_values
  drop constraint record_values_field_id_fkey,
  add constraint record_values_field_id_fkey
    foreign key (field_id) references public.record_fields (id) on delete restrict;

-- 3. recorded_at の意味を明記する (P0-3)
comment on column public.records.recorded_at is
  'ユーザーが保存操作を行った時刻。daily 項目の再保存で更新される。出来事の発生時刻ではない';

-- 4. save_record の必須フィールド検証から無効フィールドを除外する
--    init マイグレーションの save_record を全文 create or replace し、
--    必須チェックの where 句に `and f.is_active` を追加したものにする。
--    変更点はその1行のみ。他は init の定義と完全に一致させる。
```

`save_record` の再定義では、必須チェック部分が次の形になること。

```sql
  select f.field_key into v_missing_field
    from public.record_fields f
    where f.item_id = p_item_id
      and f.is_required
      and f.is_active
      and not exists (
        select 1 from public.record_values v
        where v.record_id = v_record_id and v.field_id = f.id
      )
    limit 1;
```

- [ ] **Step 2: 制約名が実在するか確認する**

冬月さんの PC のローカル DB、または Task 3 の link 後に SQL エディタで確認する。

```sql
select conname from pg_constraint
where conname in ('record_fields_item_id_fkey', 'records_item_id_fkey', 'record_values_field_id_fkey');
```

Expected: 3行返る。異なる名前が返った場合は、マイグレーション側の名前を実名に合わせて直す。

- [ ] **Step 3: 入力用取得で無効フィールドを除外する**

`src/features/records/api.ts` の `fetchActiveItemsWithFields` のクエリに、埋め込み側のフィルタを1行追加する。

```typescript
  const { data, error } = await supabase
    .from("record_items")
    .select("*, record_fields(*)")
    .eq("is_active", true)
    .eq("record_fields.is_active", true)
    .order("sort_order")
    .order("sort_order", { referencedTable: "record_fields" });
```

- [ ] **Step 4: README に `recorded_at` の意味を追記する**

`README.md` の「データモデル概要」にある `records.recorded_on` と `recorded_at` の説明行に、次の趣旨を1行追加する。

```text
- `recorded_at` はユーザーが保存操作を行った時刻 (daily 項目の再保存で更新される) であり、出来事の発生時刻ではない。発生時刻が必要になった場合は `occurred_at` を別途追加する
```

- [ ] **Step 5: 型チェックと lint**

```bash
npm run build && npm run lint
```

Expected: 型エラー・lint エラーなし (`is_active` の型は Step 6 の再生成後に揃う。再生成までは `record_fields` の行型に `is_active` が無くても、埋め込みフィルタは文字列指定のため型エラーにはならない)。

- [ ] **Step 6: 型を再生成する (Task 3 の link 完了後に実施)**

```bash
supabase gen types typescript --linked > src/types/database.ts
```

Expected: `record_fields` の Row / Insert / Update に `is_active: boolean` が含まれる。再度 `npm run build` が通る。

- [ ] **Step 7: コミット (エージェントが実施)**

```bash
git add supabase/migrations/ src/features/records/api.ts src/types/database.ts README.md
git commit -m "feat: フィールド無効化と定義削除からの履歴保護を追加"
```

---

## Task 2: Supabase Cloud プロジェクトの作成 (冬月さんの作業)

**Files:** なし (外部サービスの操作)

**Interfaces:**
- Produces: プロジェクトの `Project ref` と API URL (`https://<ref>.supabase.co`)、anon key。後続タスクとスペース試作がこれを使う。
- 注意: DB パスワードとアクセストークンはチャットに貼らない。エージェントが CLI を実行する場合は Secure Vault 経由で渡す。

- [ ] **Step 1: プロジェクトを作成する**

supabase.com にサインインし、New project で作成する。設定値:
- Name: `evluv-lifelog` (任意)
- Region: Northeast Asia (Tokyo)
- プラン: Free

- [ ] **Step 2: メール確認の設定を確認する**

Authentication の設定で、実アカウント作成時にメール確認を挟まない運用にする (Confirm email をオフにするか、Step 1 のアカウントはダッシュボードから直接作成する。Task 4 で実施)。

- [ ] **Step 3: Project ref をエージェントへ共有する**

Project ref と API URL だけを共有する (anon key はプロジェクトの API 設定画面で後から参照できるため、この時点では Project ref のみでよい)。

---

## Task 3: マイグレーションの本番適用 (link + db push)

**Files:** なし (CLI 操作)。`supabase/config.toml` は変更しない。

**Interfaces:**
- Consumes: Task 1 のマイグレーション3本 (init、add_record_history、本計画の新規1本)、Task 2 の Project ref。
- Produces: 本番 DB に全マイグレーションが適用済みの状態。これが設計レビュー P1 の「空の環境へ全マイグレーションを順に適用できる」「本番へ `db push` できる」の確認を兼ねる。

- [ ] **Step 1: アクセストークンを受け取る**

Secure Vault 経由で Supabase のアクセストークン (Account → Access Tokens で発行) を受け取り、環境変数 `SUPABASE_ACCESS_TOKEN` としてのみ使う。ファイルに書き残さない。

- [ ] **Step 2: link する**

```bash
supabase link --project-ref <Project ref>
```

Expected: `Finished supabase link.` と表示される。

- [ ] **Step 3: 適用前の状態を確認する**

```bash
supabase migration list --linked
```

Expected: ローカル3本がすべて未適用 (Remote が空) で表示される。

- [ ] **Step 4: db push する**

```bash
supabase db push
```

Expected: 3本のマイグレーションが順に適用され、エラーなく完了する。

- [ ] **Step 5: 適用後の状態を確認する**

```bash
supabase migration list --linked
```

Expected: 3本すべてに Remote のタイムスタンプが入る。あわせて Task 1 の Step 6 (型再生成) と Step 7 (コミット) をここで実施する。

---

## Task 4: 実アカウントの作成と初期項目の確認

**Files:** なし (ダッシュボードと SQL の操作)

**Interfaces:**
- Consumes: Task 3 の適用済みプロジェクト (初期項目作成トリガーを含む)。
- Produces: 冬月さんの実アカウントと、初期3項目 (外出 / 純アルコール量 / 歯磨き)。

- [ ] **Step 1: ダッシュボードからユーザーを作成する**

Authentication → Users → Add user で冬月さんのメールアドレスとパスワードで作成する (メール確認を挟まない作成方法を選ぶ)。

- [ ] **Step 2: 初期項目が作られていることを SQL で確認する**

SQL エディタで実行する。

```sql
select i.item_key, i.name, i.frequency, f.field_key, f.value_type,
       f.history_aggregation, f.unit, f.is_active
from public.record_items i
join public.record_fields f on f.item_id = i.id
order by i.sort_order, f.sort_order;
```

Expected: 外出 (done=boolean / note=text)、純アルコール量 (amount=number、sum、g)、歯磨き (score=score、点) の行が返り、`is_active` はすべて true。

---

## Task 5: P1 検証 (冬月さんが自分の PC から実施)

**Files:** なし (検証と結果記録のみ)

**Interfaces:**
- Consumes: Task 4 までの本番プロジェクト、冬月さんの PC のローカル環境。
- Produces: 設計レビュー「初回デプロイ前のDB検証項目」のうち P1 範囲の実施結果。結果はこの計画ファイル末尾にチェックを入れて記録し、エージェントがコミットする。

- [ ] **Step 1: ローカルで全マイグレーションの新規適用を確認する**

```bash
npm run db:reset
```

Expected: 3本のマイグレーションがエラーなく適用される (P1-7 のローカル側確認。本番側は Task 3 で確認済み)。

- [ ] **Step 2: 記録保存の基本動作を確認する**

ローカルまたは本番で、次を確認する (設計レビューの「記録保存」節)。
- daily 項目の初回保存と、再保存で同じ record が更新されること
- multiple 項目を同日に複数保存できること
- 必須フィールド不足、値型不一致、min/max 超過、文字数上限超過が拒否されること

- [ ] **Step 3: 履歴の表示を確認する**

履歴ページ計画の Task 5 の観点を流用する。純アルコール量が合計で表示されること、歯磨きが各回表示されること、「もっと見る」のページング、無効化した項目の過去記録が表示されること (P1-8)。

- [ ] **Step 4: フィールド無効化の動作を確認する**

いずれかのフィールドを SQL で `is_active = false` にし、次を確認する。
- 入力画面からそのフィールドだけが消えること
- その項目の保存が必須チェックで失敗しないこと (対象が必須フィールドの場合)
- 履歴では無効化前の値が表示され続けること

- [ ] **Step 5: 定義の物理削除が拒否されることを確認する**

記録が存在する項目またはフィールドを SQL で delete し、外部キー違反で拒否されることを確認する。あわせて、記録の存在しない定義同士でも、フィールドが残る項目は削除できない (RESTRICT) ことを確認する。

- [ ] **Step 6: RLS と不正保存を確認する (本番)**

本番プロジェクトにテスト用ユーザーBを追加で作成し、ユーザーBのセッションから次を確認する (P1-6)。
- ユーザーA (冬月さん) の項目・記録が読めないこと
- ユーザーAの `item_id` / `field_id` を指定した `save_record` が拒否されること
- 確認後、テスト用ユーザーBとそのデータを削除する

- [ ] **Step 7: daily の同時保存を確認する (P1-5)**

同じ daily 項目への保存を二重に実行し、重複行が作られないこと、エラーが利用者に理解不能な状態を残さないことを確認する。結果によっては、保存ボタンの二重送信防止を別タスクとして切り出す。

---

## Task 6: 入力スペースの疎通試作

**Files:**
- Create: Muse スペース (静的 Web アーティファクト)「ライフログ入力 (試作)」を1つ

**Interfaces:**
- Consumes: Task 2 の API URL と anon key、Task 4 の実アカウント。
- Produces: 「スペースから Supabase へログインし、`save_record` で1件保存できるか」の可否と、失敗した場合はその段階 (通信 / 認証 / RPC) の切り分け結果。本組みスペースの別計画を作るかどうかは、この結果で判断する。

- [ ] **Step 1: 試作スペースを作る**

静的スペースに次だけを実装する (UI の作り込みはしない)。
- メールアドレスとパスワードの入力欄とログインボタン
- `POST https://<ref>.supabase.co/auth/v1/token?grant_type=password` に anon key を `apikey` ヘッダーに付けて送り、返った `access_token` をメモリ上に保持する
- ログイン後、「外出を記録する」ボタンで `POST https://<ref>.supabase.co/rest/v1/rpc/save_record` に `Authorization: Bearer <access_token>` を付けて呼び、今日の日付と外出項目の `item_id` (事前に SQL で確認した値)、`p_values` として done フィールドの `field_id` と `value_bool: true` を送る

- [ ] **Step 2: 疎通を確認する**

冬月さんが試作スペースを開いてログインし、ボタンを押す。Expected: エラーなく完了し、SQL エディタで `records` に今日の外出記録が1件増えている。

- [ ] **Step 3: 結果を記録する**

成功した場合は「スペース本組み」の別計画を作成する。失敗した場合は、失敗した段階とエラー内容をこの計画に記録し、代替案 (ローカル React の利用継続など) を冬月さんと相談する。

---

## 完了の定義

- 本番プロジェクトに全マイグレーションが適用され、冬月さんの実アカウントで初期3項目が確認できる。
- Task 5 の P1 検証がすべて実施され、結果が記録されている。
- スペース試作の疎通結果 (可否と切り分け) が記録されている。
- React アプリのデプロイと、P0 の 2 と 4、スペース本組みは本計画の対象外 (別計画または後続判断)。
