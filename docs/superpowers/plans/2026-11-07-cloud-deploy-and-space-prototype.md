# evluv-lifelog クラウドデプロイと入力スペース疎通 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** evluv-lifelog を Supabase Cloud にデプロイして日常利用を開始し、Muse のスペースから同じプロジェクトへ記録を入力できることを疎通確認する。

**Architecture:** 本番DBは Supabase Cloud (PostgreSQL / Auth / RLS) とし、マイグレーションは GitHub Actions のワークフローが Supabase CLI の `link` + `db push` で適用する (認証情報は GitHub Secrets にのみ置き、エージェントは受け取らない)。デプロイ前に、DB設計レビューの P0 から「定義削除で過去記録を失わない」「`recorded_at` の意味の確定」の2点だけを先行マイグレーションで固める。React アプリのホスティングデプロイは今回行わない (手元の学習・遊び用として残す)。入力経路の追加として、Muse スペース (Web アーティファクト) から Supabase REST API を直接呼ぶ試作を作り、ログインと `save_record` RPC の保存が通ることを確認する。本組みのスペースは別計画とする。

**Tech Stack:** Supabase Cloud / Supabase CLI 2.x / PostgreSQL / React 19 + TypeScript (既存) / Muse スペース (静的 Web アーティファクト + fetch)

**Spec:** `docs/reviews/database-design-review.md` (P0/P1 の定義と優先順位)、および 2026-11-07 の冬月さんとの合意 (下記 Global Constraints に転記)

## Global Constraints

- 作業ブランチは `develop`。`main` へは直接コミットしない。
- **コミットはエージェントが行う** (2026-11-07 に冬月さんが変更した決まり。履歴ページ計画時点の「コミットはユーザーが手動で行う」は、この計画以降は適用しない)。
- P0 の対応範囲は設計レビューの **1 (定義削除で過去記録を失わない)** と **3 (`recorded_at` の意味の確定)** のみ。2 (記録済み定義の変更禁止) と 4 (書き込み経路の RPC 限定) は今回やらない。試行錯誤のしやすさを優先する判断 (2026-11-07 合意)。
- React アプリのホスティングデプロイはしない。フロントの動作確認はローカル `npm run dev` とスペース試作で行う。
- P1 検証は冬月さんが自分の PC から実施する (Task 5)。エージェントは手順と確認観点を提供し、結果の記録だけ行う。
- Supabase のアクセストークンと DB パスワードは GitHub Secrets にだけ登録する。チャットやファイルに平文で残さず、エージェントは値を受け取らない・保持しない。
- DB は `text + CHECK` の流儀 (enum は使わない)。RPC は `security invoker` + `set search_path = ''` を維持する。
- 日本語表記: 丸括弧は半角 `()`、日本語と括弧の間に半角スペース、日本語と数字の間にスペースを入れない。
- ローカル Docker 前提の `supabase start` はエージェントの VM では動かせない (権限制限)。ローカルDBが必要な確認は冬月さんの PC 側で行う。

## Review Focus

- 定義 (項目・フィールド) を物理削除しようとした操作: 過去記録がある場合は DB が拒否し、履歴が欠けないこと (Task 1)。
- フィールドを無効化した直後の保存: 無効化された必須フィールドが原因で `save_record` が失敗しないこと。あわせて、daily 項目の再保存で無効フィールドの過去値が消えないこと、無効化前の画面から再送されても一意制約違反にならないこと (Task 1 で RPC を変更し、Task 5 で回帰確認する)。
- スペース試作の保存: 同日に既存の外出記録がある場合も、送信していないフィールド (メモなど) の値が消えないこと (Task 6)。
- フィールドを無効化した項目の入力画面: そのフィールドだけが入力欄から消え、他のフィールドは通常どおり入力できること (Task 1、Task 5 で目視)。
- クラウドプロジェクト作成直後の第三者アクセス: anon key だけでは他ユーザーの行が読めないこと (Task 5 の RLS 確認で担保)。
- スペース試作での認証情報の扱い: パスワードはスペースのフォームから Supabase へ直接送られ、エージェントやファイルに残らないこと (Task 6)。

---

## ファイル構成

| ファイル | 役割 | 操作 |
|---|---|---|
| `supabase/migrations/<timestamp>_protect_history_from_definition_delete.sql` | is_active 追加・FK の NO ACTION 化・save_record 修正・コメント | 新規 |
| `src/features/records/api.ts` | 入力用取得で無効フィールドを除外 | 修正 |
| `src/types/database.ts` | Supabase 自動生成型 (`db:types` または `--linked` で再生成) | 再生成 |
| `.github/workflows/supabase-deploy.yml` | マイグレーションの本番適用と型再生成を行う GitHub Actions ワークフロー | 新規 |
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
-- 対応: docs/reviews/database-design-review.md の P0-1 (定義削除で過去記録を失わない) と P0-3 (recorded_at の意味の確定)

-- 1. record_fields に is_active を追加する (record_items と同じ運用に揃える)
alter table public.record_fields
  add column is_active boolean not null default true;

comment on column public.record_fields.is_active is
  '入力対象かどうか。false でも過去の値は履歴に表示する';

-- 2. 定義の物理削除で過去の記録・値が連鎖削除されないよう、外部キーを NO ACTION に変更する
--    record_values.record_id -> records は「記録を消せば値も消える」が正しいため CASCADE のままにする
--    定義の直接削除が拒否されることと、ユーザー削除 (auth.users からの連鎖) で
--    関連データが残らないことは、実 DB の削除テストで確認する (計画 Task 5)
alter table public.record_fields
  drop constraint record_fields_item_id_fkey,
  add constraint record_fields_item_id_fkey
    foreign key (item_id) references public.record_items (id) on delete no action;

alter table public.records
  drop constraint records_item_id_fkey,
  add constraint records_item_id_fkey
    foreign key (item_id) references public.record_items (id) on delete no action;

alter table public.record_values
  drop constraint record_values_field_id_fkey,
  add constraint record_values_field_id_fkey
    foreign key (field_id) references public.record_fields (id) on delete no action;

-- 3. recorded_at の意味を明記する (P0-3)
comment on column public.records.recorded_at is
  'ユーザーが保存操作を行った時刻。daily 項目の再保存で更新される。出来事の発生時刻ではない';

-- 4. save_record を無効フィールドに対応させる (変更は次の3か所のみ)
--    init マイグレーションの save_record を全文 create or replace し、
--    下記3か所だけを変更したものにする。他は init の定義と完全に一致させる。
--    (a) daily 更新時の値の全件削除で、無効フィールドの既存値を削除対象から外す
--        (入力取得から無効フィールドが除外され再登録されないため、そのままでは過去値が消える)
--    (b) 値の INSERT ループで、正当な無効フィールドの送信値を無視する (既存値を保持する)。
--        存在しない・他ユーザー所有・別項目の field_id は、従来どおりエラーにする
--    (c) 必須フィールド検証から無効フィールドを除外する
```

`save_record` の再定義では、daily 更新時の値削除が次の形になること。

```sql
      update public.records set recorded_at = p_recorded_at where id = v_record_id;
      delete from public.record_values v
      where v.record_id = v_record_id
        and exists (
          select 1 from public.record_fields f
          where f.id = v.field_id and f.is_active
        );
```

値の INSERT ループは、冒頭に次の判定を入れる (変数宣言に `v_field public.record_fields%rowtype` を追加する。空値スキップと insert 本体は init のまま維持する)。

```sql
  for v_value in select * from jsonb_array_elements(p_values) loop
    select * into v_field from public.record_fields
      where id = (v_value ->> 'field_id')::uuid;

    -- 存在しない field_id は従来どおりエラー (RLS のため他ユーザーのフィールドも not found になる)
    if not found then
      raise exception 'record field % not found', v_value ->> 'field_id';
    end if;

    -- 別項目の field_id は従来どおりエラー
    if v_field.item_id <> p_item_id or v_field.user_id <> auth.uid() then
      raise exception 'field % does not belong to item %', v_field.id, p_item_id;
    end if;

    -- 正当な無効フィールドの送信値だけを無視する (既存値は (a) で保持される)
    if not v_field.is_active then
      continue;
    end if;
    -- 以降、空値スキップと insert は init のまま
```

必須チェック部分が次の形になること。

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

本番プロジェクトは空で、`link` の時点では対象テーブル自体が存在しないため、本番では事前確認できない。事前確認は次のどちらかで行う。
- 静的確認: init マイグレーションのインライン参照は PostgreSQL のデフォルト命名 (`<テーブル名>_<カラム名>_fkey`) で制約が作られるため、想定名は SQL から確定できる。
- 実DB確認: 冬月さんの PC のローカル DB で確認する。想定名だけで絞ると実名が異なる場合に発見できないため、対象テーブルの外部キーを列挙するクエリを使う。

```sql
select tc.table_name, kcu.column_name, tc.constraint_name,
       ccu.table_name as foreign_table_name, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in ('record_fields', 'records', 'record_values');
```

Expected: 想定した3つの制約名が含まれ、`delete_rule` がすべて `CASCADE`。異なる名前があった場合は、マイグレーション側の名前を実名に合わせて直す。本番での確認は Task 3 の適用後に移す (Task 3 Step 6)。

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

- [ ] **Step 6: 型を再生成する (Task 3 の GitHub Actions ワークフローが実施)**

ワークフローが `db push` の直後に次を実行して検証し、差分があれば `src/types/database.ts` をコミットして戻す。

```bash
supabase gen types typescript --linked > src/types/database.ts
```

Expected: `record_fields` の Row / Insert / Update に `is_active: boolean` が含まれる。ワークフロー内の `npm run build` が通る。

- [ ] **Step 7: コミット (エージェントが実施)**

```bash
git add supabase/migrations/ src/features/records/api.ts README.md
git commit -m "feat: フィールド無効化と定義削除からの履歴保護を追加"
```

(`src/types/database.ts` は Step 6 のワークフローが別コミットで戻す)

---

## Task 2: Supabase Cloud プロジェクトの作成 (冬月さんの作業)

**Files:** なし (外部サービスの操作)

**Interfaces:**
- Produces: プロジェクトの `Project ref` と API URL (`https://<ref>.supabase.co`)、anon key。後続タスクとスペース試作がこれを使う。
- 注意: DB パスワードとアクセストークンはチャットに貼らない。CLI 実行用の認証情報は GitHub Secrets に登録する (Task 3)。

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

## Task 3: マイグレーションの本番適用 (GitHub Actions)

**Files:**
- Create: `.github/workflows/supabase-deploy.yml`

**Interfaces:**
- Consumes: Task 1 のマイグレーション3本 (init、add_record_history、本計画の新規1本)、Task 2 の Project ref。
- Produces: 本番 DB に全マイグレーションが適用済みの状態と、本番スキーマから再生成された `src/types/database.ts` のコミット。これが設計レビュー P1 の「空の環境へ全マイグレーションを順に適用できる」「本番へ `db push` できる」の確認を兼ねる。
- 認証情報の扱い: アクセストークンと DB パスワードは GitHub Secrets にのみ置く。エージェントは値を受け取らず、ワークフローの実行ログで結果だけを確認する。

- [ ] **Step 1: GitHub Secrets を登録する (冬月さんの作業)**

リポジトリの Settings → Secrets and variables → Actions で、次を New repository secret として登録する。
- `SUPABASE_ACCESS_TOKEN`: Supabase の Account → Access Tokens で発行したアクセストークン
- `SUPABASE_DB_PASSWORD`: プロジェクト作成時に決めた DB パスワード

- [ ] **Step 2: ワークフローファイルを作成する (エージェントがコミット)**

`.github/workflows/supabase-deploy.yml` を次の内容で作成する。`db push` の後に型を再生成してビルド検証し、差分があればコミットして戻す。型コミットは `supabase/migrations/**` を変更しないため、このワークフローは再実行されない。

```yaml
name: Deploy migrations to Supabase

on:
  workflow_dispatch:
  push:
    branches: [develop]
    paths:
      - "supabase/migrations/**"

permissions:
  contents: write

env:
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
  SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
  PROJECT_REF: qlxklpgglbalmrwrpfpq

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.58.5
      - name: Link project
        run: supabase link --project-ref "$PROJECT_REF" -p "$SUPABASE_DB_PASSWORD"
      - name: Migrations before push
        run: supabase migration list --linked
      - name: Push migrations
        run: supabase db push
      - name: Migrations after push
        run: supabase migration list --linked
      - name: Regenerate types
        run: supabase gen types typescript --linked > src/types/database.ts
      - name: Verify build with regenerated types
        run: |
          npm ci
          npm run build
      - name: Commit regenerated types
        run: |
          if git diff --quiet -- src/types/database.ts; then
            echo "types unchanged"
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add src/types/database.ts
          git commit -m "chore: 本番DBから型を再生成"
          git push
```

- [ ] **Step 3: 初回実行する**

Actions タブから `Deploy migrations to Supabase` を Run workflow で実行する (2回目以降は、マイグレーションファイルのプッシュでも自動実行される)。

Expected: `Migrations before push` ではローカル3本がすべて未適用、`Push migrations` がエラーなく完了し、`Migrations after push` では3本すべてに Remote のタイムスタンプが入る。あわせて Task 1 の Step 6 (型再生成) がワークフロー内で実施され、差分があれば `chore: 本番DBから型を再生成` のコミットが develop に増える。

- [ ] **Step 4: 本番の外部キー設定を確認する (冬月さんの作業)**

ダッシュボードの SQL エディタで Task 1 Step 2 と同じ列挙クエリを実行する。

Expected: `record_fields.item_id`、`records.item_id`、`record_values.field_id` の `delete_rule` が `NO ACTION` になっている。`record_values.record_id` は `CASCADE` のまま。

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

次の順序で回帰確認する (daily 項目の再保存で無効フィールドの過去値が消えないことの確認を含む)。
1. daily 項目 (例: 外出) に、複数フィールドの値 (外出した=はい、メモ=任意の文) を保存する。
2. 値が存在するフィールドの1つ (メモ) を SQL で `is_active = false` にする。
3. 入力画面で、そのフィールドだけが消えていることを確認する。
4. 同じ記録対象日で、有効フィールド (外出した) を更新して保存する。
5. 無効化したフィールドの既存値が、DB の `record_values` と履歴表示の両方に残っていることを確認する。
6. 必須フィールドを無効化した場合は、その項目の保存が必須チェックで失敗しないこともあわせて確認する。
7. 無効化したフィールドの値を含む `p_values` で `save_record` を直接呼んでも、一意制約違反にならず、既存値が保持されることを確認する (無効化前の画面からの再送を想定した回帰確認)。
8. 存在しない `field_id`、別項目の `field_id` を含む `save_record` の呼び出しは、従来どおりエラーになることを確認する。

- [ ] **Step 5: 定義の物理削除が拒否されることを確認する**

記録が存在する項目またはフィールドを SQL で delete し、外部キー違反で拒否されることを確認する。あわせて、記録の存在しない定義同士でも、フィールドが残る項目は削除できない (NO ACTION) ことを確認する。

- [ ] **Step 6: RLS と不正保存を確認する (本番)**

本番プロジェクトにテスト用ユーザーBを追加で作成し、ユーザーBのセッションから次を確認する (P1-6)。
- ユーザーA (冬月さん) の項目・記録が読めないこと
- ユーザーAの `item_id` / `field_id` を指定した `save_record` が拒否されること
- 確認後、ユーザーBに記録を数件作ってから、ダッシュボードでユーザーBを削除する。定義間の外部キーが NO ACTION でも、`auth.users` からの連鎖削除でユーザーごと削除できることと、Bのデータが残らないことを確認する (削除できない場合は、値 → 記録 → フィールド → 項目 → ユーザーの順に手動削除する手順を定める)

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

静的スペースに次だけを実装する (UI の作り込みはしない)。Supabase の REST API は全リクエストに `apikey` ヘッダーを要求するため、認証と RPC の両方に付ける。

- メールアドレスとパスワードの入力欄とログインボタン
- ログインは次のリクエストで行い、返った `access_token` をメモリ上に保持する。

```text
POST https://<ref>.supabase.co/auth/v1/token?grant_type=password

apikey: <anon key>
Content-Type: application/json

{"email": "<メールアドレス>", "password": "<パスワード>"}
```

- ログイン後、「外出を記録する」ボタンは次の順序で動作する。`save_record` は daily 項目では送信されなかった有効フィールドの値を保持しないため、既存値を先に取得して含める (メモなどの値を消さないため)。

  1. 当日の外出記録とその値を、次のリクエストで取得する。`p_item_id` 相当の `<外出の item_id>` とフィールドの ID は事前に SQL で確認した値、`recorded_on` は今日の日付 (YYYY-MM-DD)。

```text
GET https://<ref>.supabase.co/rest/v1/records?select=id,record_values(field_id,value_bool,value_number,value_text)&item_id=eq.<外出の item_id>&recorded_on=eq.<今日の日付>

apikey: <anon key>
Authorization: Bearer <access_token>
```

  2. 取得した既存値を RPC の入力形式 (`{"field_id": ..., "value_bool": ...}` の配列。null の値は含めない) に変換し、done フィールドのエントリだけを `value_bool: true` に上書きする (なければ追加する)。
  3. 次のリクエストで保存する。

```text
POST https://<ref>.supabase.co/rest/v1/rpc/save_record

apikey: <anon key>
Authorization: Bearer <access_token>
Content-Type: application/json

{"p_item_id": "<外出の item_id>", "p_recorded_on": "<今日の日付>",
 "p_values": [<既存値の配列 (done は true に上書き済み)>]}
```

- [ ] **Step 2: 疎通を確認する**

冬月さんが試作スペースを開いてログインし、ボタンを押す。Expected: エラーなく完了し、SQL エディタで次を確認できる。
- 当日の外出記録が存在しない状態では、`records` に今日の外出記録が1件増える。
- 当日の外出記録 (メモ付き) が既にある状態で再度押しても、同じ record が更新されるだけで行は増えず、メモの値が消えていない。

- [ ] **Step 3: 結果を記録する**

成功した場合は「スペース本組み」の別計画を作成する。失敗した場合は、失敗した段階とエラー内容をこの計画に記録し、代替案 (ローカル React の利用継続など) を冬月さんと相談する。

---

## 完了の定義

- 本番プロジェクトに全マイグレーションが適用され、冬月さんの実アカウントで初期3項目が確認できる。
- Task 5 の P1 検証がすべて実施され、結果が記録されている。
- スペース試作の疎通結果 (可否と切り分け) が記録されている。
- React アプリのデプロイと、P0 の 2 と 4、スペース本組みは本計画の対象外 (別計画または後続判断)。
