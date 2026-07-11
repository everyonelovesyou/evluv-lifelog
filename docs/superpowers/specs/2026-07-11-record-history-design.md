# 設計:記録の履歴ページ

- 作成日: 2026-07-11
- 目的: 過去の記録を **日付ごとのカード** で新しい順に一覧し、日々を振り返って眺められるようにする。

## 背景・ゴール

現状はその日の記録を入力・確認する `TodayPage` のみで、過去を見返す導線がない。
本機能では「記録のある日を新しい順に、日付カードで一覧する」履歴ページを追加する。

- 主目的: **振り返って眺める** (記録漏れチェックや傾向分析ではない)。
- カードの粒度: 各項目の値を1行に **要約** して見せる。
- 記録が1件もない日はカードを出さない。
- ページング: **新しい順 + 「もっと見る」** で古い分を追加読み込み。

## 全体アーキテクチャ

責務を明確に分ける:

- **RPC (`get_record_history`)**:
  日付ページング + 「1記録につき1行」への集約 (`record_values` とフィールド定義を JSON に埋め込む) + 定義テーブルの join。
  DB で完結させ N+1 を避ける。
- **クライアント (`buildHistoryCards`)**:
  RPC が返した行を `recorded_on` でグルーピングし、項目を「その日の要約」に集約する **見せ方のロジック**。
  純粋関数として切り出しテスト可能にする。
- **集約方法の定義**:
  どのフィールドを合計するか等は、ハードコードせず `record_fields.history_aggregation` 列でユーザー・項目ごとに定義する。

## データモデルの変更

### `record_fields` に2列を追加

```sql
alter table public.record_fields
  add column history_aggregation text not null default 'none'
    check (history_aggregation in ('none', 'sum')),
  add column unit text;

-- sum は数値系フィールドにしか付けられないよう DB で縛る (M-3)。
-- 既存行は全て 'none' のためこの CHECK は既存データと矛盾しない。
alter table public.record_fields
  add constraint record_fields_sum_numeric_only
    check (history_aggregation = 'none' or value_type in ('number', 'score'));
```

- `history_aggregation`: 既存の `frequency` / `value_type` と同じ **text + CHECK** の流儀
  (enum は将来の値追加が煩雑なため使わない)。
  - `sum` … その日のそのフィールドの `value_number` を **合計** して表示する。数値系フィールド専用。
  - `none` … 集約せず各記録の値を順に並べる。daily 項目は1件なので単一表示、multiple 項目は各回が並ぶ。
  - 将来 `average` / `count` / `max` などを CHECK に足すだけで拡張できる。
- `unit` (nullable): 数値の後ろに表示する単位文字列。表示は `値 + unit` を**スペースなしで直結**する
  (単位の種類によらず一律)。
  初期値は `amount → 'g'`、`score → '点'`。表示例「40g」「80点 / 90点」。

### 初期項目トリガーの更新

`create_default_record_items` を `CREATE OR REPLACE` で更新し、初期フィールドに
`history_aggregation` / `unit` を設定する。

| 項目 | frequency | フィールド | value_type | history_aggregation | unit | 履歴での見え方 |
|---|---|---|---|---|---|---|
| 外出 | daily | done | boolean | none | — | note が空なら `はい`、note ありなら `外出した: はい` |
| 外出 | daily | note | text | none | — | メモ: … (長ければ省略) |
| 純アルコール量 | multiple | amount | number | **sum** | g | 40g (合計) |
| 歯磨き | multiple | score | score | none | 点 | 80点 / 90点 (各回) |

### 既存ユーザーへのバックフィル (M-4)

トリガーの `CREATE OR REPLACE` は **新規サインアップ時のみ発火** するため、既存ユーザーの `amount` は `default 'none'` のまま残る。
本アプリは開発中で `db:reset` → 再サインアップ運用が前提のため実害はないが、安全のためマイグレ内で既存フィールドも更新しておく。

`field_key` は別項目でも同名で作られ得るため、`record_items.item_key` で項目を特定した上で `field_key` を限定する
(誤って別項目の同名フィールドを更新しないため)。

```sql
update public.record_fields f
  set history_aggregation = 'sum', unit = 'g'
  from public.record_items i
  where f.item_id = i.id
    and i.item_key = 'alcohol' and f.field_key = 'amount';

update public.record_fields f
  set unit = '点'
  from public.record_items i
  where f.item_id = i.id
    and i.item_key = 'toothbrushing' and f.field_key = 'score';
```

## RPC: `get_record_history(p_before, p_limit)`

新規マイグレーション `supabase/migrations/20260712000000_add_record_history.sql` を1本追加し、
上記の列追加・トリガー更新・本 RPC・`grant` をまとめて含める (既存 init.sql は編集しない)。

### シグネチャ

```sql
create or replace function public.get_record_history(
  p_before date default null,
  p_limit  int  default 30
)
returns table (
  record_id   uuid,
  item_id     uuid,
  item_key    text,
  item_name   text,
  frequency   text,
  recorded_on date,
  recorded_at timestamptz,
  fields      jsonb,
  has_more    boolean
)
language plpgsql
security invoker
set search_path = ''
```

### 挙動

1. **入力検証**:
    `p_limit` を検証する。
    `p_limit is null or p_limit <= 0` なら例外、上限 (例: 100) を超える値は 100 にクランプする (過大なページサイズを防ぐ)。
2. **日付ページング**:
    `records` から `distinct recorded_on` を降順に、`p_before` より前 (NULL なら最新から) を **`p_limit` 日分** 選ぶ。
3. **`has_more` の算出**:
    対象日を選ぶ際に `limit p_limit + 1` で1日多く覗き、`p_limit + 1` 日目が存在すれば `has_more = true`。
    返す行は先頭 `p_limit` 日分に絞り、**全行に同じ `has_more` 値**を載せる (クライアントはこの1列を見るだけでよい)。
4. その日群に属する records を、各 record の `record_values` をフィールド定義付きの JSON 配列 (`fields`) に集約して1行ずつ返す。
5. `fields` の各要素:
    `field_id` / `field_key` / `label` / `value_type` / `history_aggregation` / `unit` / `value_bool` / `value_number` / `value_text` / `sort_order`。
6. **`is_active` でフィルタしない**:
    履歴は無効化・非表示にした項目の過去記録も表示するのが目的のため、`record_items` への JOIN に `i.is_active = true` を **入れない**
    (`fetchActiveItemsWithFields` は入力用途なので有効項目のみだが、履歴 RPC は別方針)。
7. **並び順とタイブレーク**:
    `sort_order` や `recorded_at` は同値になり得るため、末尾に `id` を足して安定順序にする。
    行: `recorded_on desc, i.sort_order, r.recorded_at, r.id`。
    `fields` 内: `f.sort_order, f.id`。
8. `security invoker` で RLS がそのまま効く (既存 `save_record` と同じ流儀)。`authenticated` へ `grant execute`。

### 実装スケッチ

`has_more` の判定と入力検証を含むため `language plpgsql` で書く。

```sql
declare
  v_limit int;
  v_has_more boolean;
begin
  if p_limit is null or p_limit <= 0 then
    raise exception 'p_limit must be a positive integer';
  end if;
  v_limit := least(p_limit, 100);

  -- p_limit + 1 日目の存在で has_more を判定
  with peek as (
    select distinct recorded_on
    from public.records
    where user_id = auth.uid()
      and (p_before is null or recorded_on < p_before)
    order by recorded_on desc
    limit v_limit + 1
  )
  select count(*) > v_limit into v_has_more from peek;

  return query
  with target_days as (
    select distinct recorded_on
    from public.records
    where user_id = auth.uid()
      and (p_before is null or recorded_on < p_before)
    order by recorded_on desc
    limit v_limit
  )
  select
    r.id, r.item_id, i.item_key, i.name, r.frequency, r.recorded_on, r.recorded_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'field_id', f.id, 'field_key', f.field_key, 'label', f.label,
          'value_type', f.value_type, 'history_aggregation', f.history_aggregation,
          'unit', f.unit,
          'value_bool', v.value_bool, 'value_number', v.value_number,
          'value_text', v.value_text, 'sort_order', f.sort_order
        ) order by f.sort_order, f.id
      )
      from public.record_values v
      join public.record_fields f on f.id = v.field_id
      where v.record_id = r.id
    ), '[]'::jsonb),
    v_has_more
  from public.records r
  join public.record_items i on i.id = r.item_id   -- is_active でフィルタしない
  where r.recorded_on in (select recorded_on from target_days)
  order by r.recorded_on desc, i.sort_order, r.recorded_at, r.id;
end;
```

## クライアント側の集約 (`buildHistoryCards`)

RPC の行を入力に、日付カードの配列を返す純粋関数。DB 非依存でテスト可能。

```
buildHistoryCards(rows: HistoryRecordRow[]): HistoryDayCard[]
```

1. `recorded_on` でグルーピング (新しい順を維持)。
2. 各日の中で `item_id` ごとにまとめる (RPC の並び順で出現順を維持)。
3. 各項目のフィールドごとに `history_aggregation` を見て**値文字列**を作る:
   - `sum`: 同フィールドの `value_number` を合計 → `合計値 + unit`。
     `value_number` が `null` の値は合計から除外する。合計対象が1件も無ければそのフィールドは出さない。
   - `none`: 各記録の値を出現順に並べ ` / ` で連結。
     - boolean → `はい` / `いいえ`
     - number / score → `数値 + unit` (例: `80点`)
     - text → そのまま。**40文字を超えたら先頭40文字 + `…`** で省略。

### 出力フォーマットの確定 (R-1)

各項目は `HistoryItemSummary { itemId, itemName, lines: string[] }` に整形する。
`lines` の各要素は1フィールド分の表示文字列で、次の規則で作る:

- まず値が空 (未入力) のフィールドを除外し、**実際に表示するフィールド (行) の数**を確定する。
  ラベルの有無はこの**表示フィールド数**で判定する (定義上のフィールド数ではない)。
  - **表示フィールドが1つ**: ラベルを省略し **値のみ** (例: 純アルコール量 → `40g`、
    歯磨き → `80点 / 90点`、note が空の外出 → `はい`)。
  - **表示フィールドが2つ以上**: `ラベル: 値` の形で各行を並べる
    (例: note ありの外出 → `外出した: はい` / `メモ: …`)。
- **`sum` の `(合計)` 注記は付けない** (単位付きの数値で十分伝わるため)。
- 項目内に表示行が1つも無ければその項目自体を出さない。

カード表示は `HistoryDayCard` 見出し (日付 + 曜日) の下に、各 `HistoryItemSummary` を
`itemName` 見出し + `lines` の形で並べる。単位の前にスペースは入れず、
一律 `値 + unit` を直結する (`40g` 形式)。

### `hasMore` / `loadMore` の判定 (M-1)

- `hasMore` は **RPC が各行に載せる `has_more` 列をそのまま使う** (どの行も同じ値。
  行が0件のときは `false` 扱い)。クライアントで distinct 日数を数える必要はない。
- `useRecordHistory` は `loading` フラグで `loadMore` の二重発火を防ぎ、
  次回は現在の最古 `recorded_on` を `p_before` に渡して追加取得し、結果を末尾に追記する。

### 型 (`src/types/app.ts` に追加)

- `HistoryRecordRow` — RPC の1行。DB 由来のため **snake_case** (`recorded_on` 等)。`fields` は埋め込み JSON 配列。
  行レベルの `has_more: boolean` を含む (ページング判定用。`buildHistoryCards` は使わず `useRecordHistory` が参照)。
- `HistoryDayCard` — 表示用ビューモデル。**camelCase** で `{ recordedOn, weekday, items: HistoryItemSummary[] }`。
- `HistoryItemSummary` — `{ itemId, itemName, lines: string[] }`。
- 命名方針 (RPC 行 = snake / 表示用 = camel) を型定義コメントに一言残す (S-1)。
- `weekday` は `recorded_on` から**ローカル日付として**導出する
  (`new Date(y, m-1, d)`。`TodayPage` の `toDateString` と同じく UTC パースずれを避ける / M-5)。

## 画面・ファイル構成

- `src/pages/HistoryPage.tsx` (新規) — ルート `/history` を `App.tsx` の `RequireAuth` 配下に追加。
- `src/components/Layout.tsx` — ナビに「記録の履歴」を追加 (今日の記録 / 記録の履歴 / 項目管理)。
- `src/features/records/api.ts` — `fetchRecordHistory(before, limit)` を追加。
- `src/features/records/buildHistoryCards.ts` (新規) — 集約の純粋関数。
- `src/features/records/useRecordHistory.ts` (新規) — `cursor` (最古読込日) / `hasMore` / `loadMore` を管理するフック。
- `src/features/records/HistoryDayCard.tsx` (新規) — 日付カード表示。既存 `RecordItemCard` の CSS 命名・見た目に揃える。
- 空状態: `buildHistoryCards` が `[]` のとき `HistoryPage` は「まだ記録がありません」を表示する
  (`TodayPage` の項目ゼロ件分岐に相当 / S-3)。
- エラー: `useRecordHistory` は `useTodayRecords` に倣い `error` 文字列を保持し、ページで表示する (S-4)。

## テスト・確認

- **Vitest を devDependency に追加** し、`buildHistoryCards` の純粋関数のみをテスト対象にする。
  - ケース: `sum` の合計、`none` の各回並べ、daily 単一値、値が空/未記録、複数項目の混在、
    日付グルーピングの順序、text の40文字省略、単一/複数フィールドのラベル有無。
  - 純粋関数のみのため **test 環境は node で可** (jsdom 不要 / S-2)。`vite.config.ts` に `test` セクションを追加し、
    `tsc -b` がテストファイルを拾わないよう `tsconfig` の include 範囲にも注意。
- `package.json` に `test` スクリプト (`vitest run`) を追加。
- **マイグレ適用後に `npm run db:types` を実行**し、`get_record_history` を型付きで呼べるようにする (M-2)。
- 最後に `db:reset` → 数日分の記録を投入 → 履歴カードと「もっと見る」を実機 (Playwright / 目視) で確認。

## スコープ外 (YAGNI)

- カードからの編集導線 (日付タップで `TodayPage` へ) — 将来検討。
- 傾向グラフ・数値推移。
- `average` / `count` / `max` などの集約方法 — 列の CHECK 拡張で後日追加可能な設計に留める。
