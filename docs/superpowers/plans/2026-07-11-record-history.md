# 記録の履歴ページ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 過去の記録を日付ごとのカードで新しい順に一覧し、日々を振り返れる履歴ページを追加する。

**Architecture:** RPC `get_record_history` が「日付ページング + 1記録=1行 (values とフィールド定義を JSON 埋め込み)」を DB で担い、クライアントの純粋関数 `buildHistoryCards` が日付グルーピングと要約整形 (見せ方) を担う。集約方法は `record_fields.history_aggregation` 列でフィールドごとに定義する。

**Tech Stack:** React 19 + react-router-dom v7 + Supabase (PostgreSQL RPC) + Vitest (純粋関数テスト)。

**参照仕様:** `docs/superpowers/specs/2026-07-11-record-history-design.md`

## Global Constraints

- TypeScript strict / `noUnusedLocals` / `noUnusedParameters` / `verbatimModuleSyntax` が有効。未使用変数・型のみ import は `import type` を使う。
- 依存追加は **Vitest のみ** (devDependency)。それ以外の新規依存は入れない。
- DB は `text + CHECK` の流儀 (enum は使わない)。RPC は `security invoker` + `set search_path = ''`、`auth` スキーマは `auth.uid()` と修飾する。
- 命名: RPC 由来の行型は **snake_case** (`recorded_on` 等)、表示用ビューモデルは **camelCase** (`recordedOn` 等)。
- 日本語表記: 丸括弧は半角 `()`、日本語と括弧の間に半角スペース、日本語と数字の間にスペースを入れない。
- **コミットはすべてユーザーが手動で行う。** 全タスク完了後に Task 5 末尾でまとめてコミットを依頼する。エージェントは `git commit` を実行しない。
- `supabase start` / `db:reset` などローカル DB サーバー操作が要るステップは、エージェントは実行せず**ユーザーに依頼する**。

---

## ファイル構成

| ファイル | 役割 | 操作 |
|---|---|---|
| `supabase/migrations/<timestamp>_add_record_history.sql` | 列追加・CHECK・トリガー更新・バックフィル・RPC・grant | 新規 |
| `src/types/database.ts` | Supabase 自動生成型 (`db:types` で再生成) | 再生成 |
| `src/types/app.ts` | 履歴用の型を追加 | 修正 |
| `vitest.config.ts` | Vitest 設定 (node 環境) | 新規 |
| `package.json` | `test` スクリプト + vitest devDep | 修正 |
| `src/features/records/buildHistoryCards.ts` | 日付グルーピング + 要約整形の純粋関数 | 新規 |
| `src/features/records/buildHistoryCards.test.ts` | 上記のテスト | 新規 |
| `src/features/records/api.ts` | `fetchRecordHistory` を追加 | 修正 |
| `src/features/records/useRecordHistory.ts` | 状態管理フック (ページング) | 新規 |
| `src/features/records/HistoryDayCard.tsx` | 日付カード表示 | 新規 |
| `src/pages/HistoryPage.tsx` | 履歴ページ | 新規 |
| `src/App.tsx` | `/history` ルート追加 | 修正 |
| `src/components/Layout.tsx` | ナビに「記録の履歴」追加 | 修正 |

---

## Task 1: マイグレーション (列・トリガー・RPC) と型再生成

**Files:**
- Create: `supabase/migrations/<timestamp>_add_record_history.sql`
- Regenerate: `src/types/database.ts`

**Interfaces:**
- Produces: RPC `get_record_history(p_before date, p_limit int)` が
  `(record_id uuid, item_id uuid, item_key text, item_name text, frequency text, recorded_on date, recorded_at timestamptz, fields jsonb, has_more boolean)` を返す。
  `record_fields` に `history_aggregation text` (`'none'|'sum'`)、`unit text` 列が増える。

- [ ] **Step 1: マイグレーションファイルを作る**

ユーザーに次を依頼 (エージェントは実行しない):
```bash
npm run db:migration add_record_history
```
生成された `supabase/migrations/<timestamp>_add_record_history.sql` に以下を全文記述する。

```sql
-- 記録の履歴機能: history_aggregation / unit 列と集約 RPC を追加

-- 1. record_fields に集約定義と単位を追加
alter table public.record_fields
  add column history_aggregation text not null default 'none'
    check (history_aggregation in ('none', 'sum')),
  add column unit text;

-- sum は数値系フィールドにしか付けられないよう縛る (既存行は全て 'none' なので矛盾しない)
alter table public.record_fields
  add constraint record_fields_sum_numeric_only
    check (history_aggregation = 'none' or value_type in ('number', 'score'));

comment on column public.record_fields.history_aggregation is
  '履歴カードでの集約方法: none=各回を並べる / sum=value_number を合計';
comment on column public.record_fields.unit is
  '数値の後ろに表示する単位 (例: g, 点)';

-- 2. 初期項目トリガーを更新 (純アルコール amount=sum/g、歯磨き score=点)
create or replace function public.create_default_record_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
begin
  -- 外出 (1日1回 / boolean + 任意メモ)
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '外出', 'outing', 'daily', 1)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, max_length, sort_order)
    values
      (v_item_id, new.id, 'done', '外出した', 'boolean', true, null, 1),
      (v_item_id, new.id, 'note', 'メモ', 'text', false, 100, 2);

  -- 純アルコール摂取量 (1日複数回 / 数値 g / 0未満不可 / 履歴は合計)
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '純アルコール量', 'alcohol', 'multiple', 2)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, min_value, sort_order, history_aggregation, unit)
    values
      (v_item_id, new.id, 'amount', '摂取量 (g)', 'number', true, 0, 1, 'sum', 'g');

  -- 歯磨き (1日複数回 / 任意の点数 / 履歴は各回を並べる)
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '歯磨き', 'toothbrushing', 'multiple', 3)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, sort_order, unit)
    values
      (v_item_id, new.id, 'score', '点数', 'score', false, 1, '点');

  return new;
end;
$$;

-- 3. 既存ユーザーのフィールドをバックフィル (item_key + field_key で限定)
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

-- 4. 履歴取得 RPC
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
as $$
declare
  v_limit int;
  v_has_more boolean;
begin
  if p_limit is null or p_limit <= 0 then
    raise exception 'p_limit must be a positive integer';
  end if;
  v_limit := least(p_limit, 100);

  -- p_limit + 1 日目の存在で has_more を判定 (列名衝突回避のため as day)
  with peek as (
    select distinct r.recorded_on as day
    from public.records r
    where r.user_id = auth.uid()
      and (p_before is null or r.recorded_on < p_before)
    order by r.recorded_on desc
    limit v_limit + 1
  )
  select count(*) > v_limit into v_has_more from peek;

  return query
  with target_days as (
    select distinct r.recorded_on as day
    from public.records r
    where r.user_id = auth.uid()
      and (p_before is null or r.recorded_on < p_before)
    order by r.recorded_on desc
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
  join public.record_items i on i.id = r.item_id   -- is_active でフィルタしない (無効化項目の過去記録も表示)
  where r.user_id = auth.uid()
    and r.recorded_on in (select day from target_days)
  order by r.recorded_on desc, i.sort_order, r.recorded_at, r.id;
end;
$$;

grant execute on function public.get_record_history(date, int) to authenticated;
```

- [ ] **Step 2: db:reset で適用する (ユーザー依頼)**

ユーザーに依頼:
```bash
npm run db:reset
```
Expected: マイグレーション 2件 (init, add_record_history) がエラーなく適用される。

- [ ] **Step 3: 適用結果を確認する (ユーザー依頼)**

ユーザーに依頼 (Supabase Studio の SQL エディタ、または `supabase db` 経由)。まずテストユーザーをアプリのサインアップ画面で1件作成してから:
```sql
-- 初期フィールドの集約設定を確認
select i.item_key, f.field_key, f.history_aggregation, f.unit
from public.record_fields f
join public.record_items i on i.id = f.item_id
order by i.sort_order, f.sort_order;
```
Expected: `alcohol/amount → sum/g`、`toothbrushing/score → none/点`、その他は `none/null`。

- [ ] **Step 4: TypeScript 型を再生成する**

DB 起動中に実行:
```bash
npm run db:types
```
Expected: `src/types/database.ts` に `get_record_history` の Functions 型と `record_fields` の新カラムが反映される。

---

## Task 2: 型定義・Vitest 導入・`buildHistoryCards`

**Files:**
- Modify: `src/types/app.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `src/features/records/buildHistoryCards.ts`
- Test: `src/features/records/buildHistoryCards.test.ts`

**Interfaces:**
- Consumes: `ValueType`, `Frequency` (既存 `src/types/app.ts`)。
- Produces:
  - 型 `HistoryFieldValue`, `HistoryRecordRow`, `HistoryItemSummary`, `HistoryDayCard`。
  - `buildHistoryCards(rows: HistoryRecordRow[]): HistoryDayCard[]`。

- [ ] **Step 1: 履歴用の型を追加する**

`src/types/app.ts` の末尾に追記:
```typescript
export type HistoryAggregation = "none" | "sum";

// get_record_history の fields 配列要素 (RPC 由来のため snake_case)
export type HistoryFieldValue = {
  field_id: string;
  field_key: string;
  label: string;
  value_type: ValueType;
  history_aggregation: HistoryAggregation;
  unit: string | null;
  value_bool: boolean | null;
  value_number: number | null;
  value_text: string | null;
  sort_order: number;
};

// get_record_history の1行 (RPC 由来のため snake_case)。
// has_more は全行同値のページング判定用 (buildHistoryCards は使わない)。
export type HistoryRecordRow = {
  record_id: string;
  item_id: string;
  item_key: string;
  item_name: string;
  frequency: Frequency;
  recorded_on: string;
  recorded_at: string;
  fields: HistoryFieldValue[];
  has_more: boolean;
};

// 表示用ビューモデル (camelCase)
export type HistoryItemSummary = {
  itemId: string;
  itemName: string;
  lines: string[];
};

export type HistoryDayCard = {
  recordedOn: string;
  weekday: string;
  items: HistoryItemSummary[];
};
```

- [ ] **Step 2: Vitest を導入する**

インストール:
```bash
npm install -D vitest
```
`vitest.config.ts` を新規作成 (純粋関数のみのため node 環境。React プラグイン不要):
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```
`package.json` の `scripts` に追加:
```json
    "test": "vitest run",
```

- [ ] **Step 3: 失敗するテストを書く**

`src/features/records/buildHistoryCards.test.ts` を新規作成:
```typescript
import { describe, expect, it } from "vitest";
import type { HistoryFieldValue, HistoryRecordRow } from "../../types/app";
import { buildHistoryCards } from "./buildHistoryCards";

function field(overrides: Partial<HistoryFieldValue>): HistoryFieldValue {
  return {
    field_id: "f1",
    field_key: "k",
    label: "ラベル",
    value_type: "number",
    history_aggregation: "none",
    unit: null,
    value_bool: null,
    value_number: null,
    value_text: null,
    sort_order: 1,
    ...overrides,
  };
}

function row(overrides: Partial<HistoryRecordRow>): HistoryRecordRow {
  return {
    record_id: "r1",
    item_id: "i1",
    item_key: "item",
    item_name: "項目",
    frequency: "multiple",
    recorded_on: "2026-07-11",
    recorded_at: "2026-07-11T09:00:00Z",
    fields: [],
    has_more: false,
    ...overrides,
  };
}

describe("buildHistoryCards", () => {
  it("sum 集約で value_number を合計し単位を付ける", () => {
    const amount = (n: number) =>
      field({
        field_id: "amt",
        label: "摂取量 (g)",
        history_aggregation: "sum",
        unit: "g",
        value_number: n,
      });
    const rows = [
      row({ record_id: "a", item_id: "alc", item_name: "純アルコール量", fields: [amount(20)] }),
      row({ record_id: "b", item_id: "alc", item_name: "純アルコール量", fields: [amount(20)] }),
    ];
    const cards = buildHistoryCards(rows);
    expect(cards).toHaveLength(1);
    expect(cards[0].items).toHaveLength(1);
    expect(cards[0].items[0].lines).toEqual(["40g"]);
  });

  it("none 集約 (点数) は各回を単位付きで並べる", () => {
    const score = (n: number, rid: string) =>
      row({
        record_id: rid,
        item_id: "tb",
        item_name: "歯磨き",
        fields: [field({ field_id: "sc", label: "点数", value_type: "score", unit: "点", value_number: n })],
      });
    const cards = buildHistoryCards([score(80, "a"), score(90, "b")]);
    expect(cards[0].items[0].lines).toEqual(["80点 / 90点"]);
  });

  it("表示フィールドが1つの項目はラベルを省略する", () => {
    const rows = [
      row({
        item_id: "out",
        item_name: "外出",
        fields: [field({ field_id: "done", label: "外出した", value_type: "boolean", value_bool: true })],
      }),
    ];
    expect(buildHistoryCards(rows)[0].items[0].lines).toEqual(["はい"]);
  });

  it("表示フィールドが2つ以上ならラベル付きで並べる", () => {
    const rows = [
      row({
        item_id: "out",
        item_name: "外出",
        fields: [
          field({ field_id: "done", label: "外出した", value_type: "boolean", value_bool: true, sort_order: 1 }),
          field({ field_id: "note", label: "メモ", value_type: "text", value_text: "散歩した", sort_order: 2 }),
        ],
      }),
    ];
    expect(buildHistoryCards(rows)[0].items[0].lines).toEqual([
      "外出した: はい",
      "メモ: 散歩した",
    ]);
  });

  it("値が空のフィールドは行を出さず、全て空なら項目を出さない", () => {
    const rows = [
      row({
        item_id: "out",
        item_name: "外出",
        fields: [], // 値なし
      }),
    ];
    expect(buildHistoryCards(rows)).toEqual([]);
  });

  it("recorded_on ごとにカードを分け、入力順 (新しい順) を保つ", () => {
    const mk = (day: string, rid: string) =>
      row({
        record_id: rid,
        recorded_on: day,
        item_id: "out",
        item_name: "外出",
        fields: [field({ field_id: "done", label: "外出した", value_type: "boolean", value_bool: true })],
      });
    const cards = buildHistoryCards([mk("2026-07-11", "a"), mk("2026-07-10", "b")]);
    expect(cards.map((c) => c.recordedOn)).toEqual(["2026-07-11", "2026-07-10"]);
  });

  it("text は40文字を超えると省略する", () => {
    const long = "あ".repeat(45);
    const rows = [
      row({
        item_id: "out",
        item_name: "外出",
        fields: [field({ field_id: "note", label: "メモ", value_type: "text", value_text: long })],
      }),
    ];
    expect(buildHistoryCards(rows)[0].items[0].lines[0]).toBe(`${"あ".repeat(40)}…`);
  });

  it("weekday を recorded_on からローカル日付で導出する", () => {
    const rows = [
      row({
        fields: [field({ field_id: "done", label: "外出した", value_type: "boolean", value_bool: true })],
      }),
    ];
    // 2026-07-11 は土曜
    expect(buildHistoryCards(rows)[0].weekday).toBe("土");
  });
});
```

- [ ] **Step 4: テストを実行して失敗を確認する**

```bash
npm test
```
Expected: FAIL (`buildHistoryCards` が未実装 / モジュール解決エラー)。

- [ ] **Step 5: `buildHistoryCards` を実装する**

`src/features/records/buildHistoryCards.ts` を新規作成:
```typescript
import type {
  HistoryDayCard,
  HistoryFieldValue,
  HistoryItemSummary,
  HistoryRecordRow,
} from "../../types/app";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const TEXT_MAX = 40;

// recorded_on ("YYYY-MM-DD") をローカル日付として曜日に変換する。
// new Date(string) の UTC パースずれを避けるため各要素から構築する。
function weekdayOf(recordedOn: string): string {
  const [year, month, day] = recordedOn.split("-").map(Number);
  return WEEKDAYS[new Date(year, month - 1, day).getDay()];
}

// 数値 + 単位。単位の種類によらずスペースなしで直結する (例: "40g", "80点")。
function formatNumber(value: number, unit: string | null): string {
  if (!unit) return String(value);
  return `${value}${unit}`;
}

// none 集約: 1つの値を表示文字列にする。空なら null。
function formatSingleValue(v: HistoryFieldValue): string | null {
  if (v.value_bool !== null) return v.value_bool ? "はい" : "いいえ";
  if (v.value_number !== null) return formatNumber(v.value_number, v.unit);
  if (v.value_text !== null) {
    return v.value_text.length > TEXT_MAX
      ? `${v.value_text.slice(0, TEXT_MAX)}…`
      : v.value_text;
  }
  return null;
}

type FieldEntry = { label: string; text: string };

// 1項目 (その日の全レコード) をフィールドごとの表示エントリに集約する。
function buildFieldEntries(itemRows: HistoryRecordRow[]): FieldEntry[] {
  // 値が空だと record_values 行が無く fields から欠けるため、全レコードで union する
  const order: string[] = [];
  const defs = new Map<string, HistoryFieldValue>();
  const valuesByField = new Map<string, HistoryFieldValue[]>();

  for (const rowItem of itemRows) {
    for (const fv of rowItem.fields) {
      if (!defs.has(fv.field_id)) {
        defs.set(fv.field_id, fv);
        order.push(fv.field_id);
      }
      const arr = valuesByField.get(fv.field_id) ?? [];
      arr.push(fv);
      valuesByField.set(fv.field_id, arr);
    }
  }

  order.sort((a, b) => {
    const da = defs.get(a) as HistoryFieldValue;
    const db = defs.get(b) as HistoryFieldValue;
    return da.sort_order - db.sort_order || a.localeCompare(b);
  });

  const entries: FieldEntry[] = [];
  for (const fieldId of order) {
    const def = defs.get(fieldId) as HistoryFieldValue;
    const vals = valuesByField.get(fieldId) ?? [];
    let text: string | null;
    if (def.history_aggregation === "sum") {
      const nums = vals
        .map((v) => v.value_number)
        .filter((n): n is number => n !== null);
      text =
        nums.length === 0
          ? null
          : formatNumber(
              nums.reduce((acc, n) => acc + n, 0),
              def.unit,
            );
    } else {
      const parts = vals
        .map(formatSingleValue)
        .filter((s): s is string => s !== null);
      text = parts.length === 0 ? null : parts.join(" / ");
    }
    if (text !== null) entries.push({ label: def.label, text });
  }
  return entries;
}

// その日のレコード群を項目ごとの要約にまとめる (item_id の出現順を保つ)。
function buildItemSummaries(dayRows: HistoryRecordRow[]): HistoryItemSummary[] {
  const order: string[] = [];
  const byItem = new Map<string, HistoryRecordRow[]>();
  for (const rowItem of dayRows) {
    if (!byItem.has(rowItem.item_id)) {
      byItem.set(rowItem.item_id, []);
      order.push(rowItem.item_id);
    }
    (byItem.get(rowItem.item_id) as HistoryRecordRow[]).push(rowItem);
  }

  const summaries: HistoryItemSummary[] = [];
  for (const itemId of order) {
    const rows = byItem.get(itemId) as HistoryRecordRow[];
    const entries = buildFieldEntries(rows);
    if (entries.length === 0) continue;
    // 表示フィールド数でラベル有無を判定
    const lines =
      entries.length === 1
        ? [entries[0].text]
        : entries.map((e) => `${e.label}: ${e.text}`);
    summaries.push({ itemId, itemName: rows[0].item_name, lines });
  }
  return summaries;
}

// RPC の行を日付カードの配列に変換する。recorded_on の出現順 (新しい順) を保つ。
export function buildHistoryCards(rows: HistoryRecordRow[]): HistoryDayCard[] {
  const order: string[] = [];
  const byDay = new Map<string, HistoryRecordRow[]>();
  for (const rowItem of rows) {
    if (!byDay.has(rowItem.recorded_on)) {
      byDay.set(rowItem.recorded_on, []);
      order.push(rowItem.recorded_on);
    }
    (byDay.get(rowItem.recorded_on) as HistoryRecordRow[]).push(rowItem);
  }

  const cards: HistoryDayCard[] = [];
  for (const recordedOn of order) {
    const items = buildItemSummaries(byDay.get(recordedOn) as HistoryRecordRow[]);
    if (items.length > 0) {
      cards.push({ recordedOn, weekday: weekdayOf(recordedOn), items });
    }
  }
  return cards;
}
```

- [ ] **Step 6: テストを実行して全て通ることを確認する**

```bash
npm test
```
Expected: PASS (8 tests)。

- [ ] **Step 7: 型チェックと lint**

```bash
npm run build && npm run lint
```
Expected: 型エラー・lint エラーなし。

---

## Task 3: API とフック (ページング)

**Files:**
- Modify: `src/features/records/api.ts`
- Create: `src/features/records/useRecordHistory.ts`

**Interfaces:**
- Consumes: `supabase` (`src/lib/supabase/client`)、`buildHistoryCards`、型 `HistoryRecordRow` / `HistoryDayCard`。
- Produces:
  - `fetchRecordHistory(before: string | null, limit?: number): Promise<HistoryRecordRow[]>`。
  - `useRecordHistory(): { cards: HistoryDayCard[]; hasMore: boolean; loading: boolean; loadingMore: boolean; error: string | null; loadMore: () => Promise<void> }`。

- [ ] **Step 1: `fetchRecordHistory` を追加する**

`src/features/records/api.ts` の import に型を追加:
```typescript
import type {
  HistoryRecordRow,
  RecordItemWithFields,
  RecordWithValues,
} from "../../types/app";
```
ファイル末尾に追加 (RPC の戻り値は `fields` が `Json` 型のため `HistoryRecordRow` へキャストする):
```typescript
// 記録の履歴を日付ページングで取得する。before は「その日より前」を読むカーソル (最古の recorded_on)。
export async function fetchRecordHistory(
  before: string | null,
  limit = 30,
): Promise<HistoryRecordRow[]> {
  const { data, error } = await supabase.rpc("get_record_history", {
    p_before: before,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as unknown as HistoryRecordRow[];
}
```

- [ ] **Step 2: `useRecordHistory` を実装する**

`src/features/records/useRecordHistory.ts` を新規作成:
```typescript
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HistoryDayCard, HistoryRecordRow } from "../../types/app";
import { fetchRecordHistory } from "./api";
import { buildHistoryCards } from "./buildHistoryCards";

const PAGE_SIZE = 30;

type HistoryState = {
  cards: HistoryDayCard[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
};

export function useRecordHistory(): HistoryState {
  const [rows, setRows] = useState<HistoryRecordRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchRecordHistory(null, PAGE_SIZE);
      setRows(next);
      setHasMore(next.length > 0 ? next[0].has_more : false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    // 二重発火・初回ロード中・これ以上ない場合は何もしない
    if (loadingMore || loading || !hasMore) return;
    // RPC は recorded_on 降順なので末尾が最古。それをカーソルにする
    const oldest = rows.length > 0 ? rows[rows.length - 1].recorded_on : null;
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const next = await fetchRecordHistory(oldest, PAGE_SIZE);
      setRows((prev) => [...prev, ...next]);
      setHasMore(next.length > 0 ? next[0].has_more : false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoadingMore(false);
    }
  }, [rows, hasMore, loading, loadingMore]);

  const cards = useMemo(() => buildHistoryCards(rows), [rows]);

  return { cards, hasMore, loading, loadingMore, error, loadMore };
}
```

- [ ] **Step 3: 型チェックと lint**

```bash
npm run build && npm run lint
```
Expected: 型エラー・lint エラーなし (`get_record_history` の型は Task 1 の `db:types` で生成済み)。

---

## Task 4: 履歴ページの UI とルーティング

**Files:**
- Create: `src/features/records/HistoryDayCard.tsx`
- Create: `src/pages/HistoryPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useRecordHistory`、型 `HistoryDayCard`。
- Produces: ルート `/history`、ナビリンク「記録の履歴」。

- [ ] **Step 1: `HistoryDayCard` を作る**

`src/features/records/HistoryDayCard.tsx` を新規作成 (既存 `record-card` / `record-history` の CSS 命名を流用):
```tsx
import type { HistoryDayCard as HistoryDayCardData } from "../../types/app";

export function HistoryDayCard({ card }: { card: HistoryDayCardData }) {
  return (
    <section className="record-card">
      <h2>
        {card.recordedOn} ({card.weekday})
      </h2>
      <ul className="record-history">
        {card.items.map((item) => (
          <li key={item.itemId}>
            <strong>{item.itemName}</strong>
            {item.lines.map((line, index) => (
              <div key={`${item.itemId}-${index}`}>{line}</div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: `HistoryPage` を作る**

`src/pages/HistoryPage.tsx` を新規作成:
```tsx
import { HistoryDayCard } from "../features/records/HistoryDayCard";
import { useRecordHistory } from "../features/records/useRecordHistory";

export function HistoryPage() {
  const { cards, hasMore, loading, loadingMore, error, loadMore } =
    useRecordHistory();

  return (
    <div className="history-page">
      {loading && <p>読み込み中…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && cards.length === 0 && <p>まだ記録がありません。</p>}

      {cards.map((card) => (
        <HistoryDayCard key={card.recordedOn} card={card} />
      ))}

      {hasMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "読み込み中…" : "もっと見る"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: ルートを追加する**

`src/App.tsx` の import に追加:
```tsx
import { HistoryPage } from "./pages/HistoryPage";
```
`RequireAuth` 配下、`/` と `/items` の間に追加:
```tsx
            <Route path="/" element={<TodayPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/items" element={<RecordItemsPage />} />
```

- [ ] **Step 4: ナビリンクを追加する**

`src/components/Layout.tsx` の `<nav>` 内、「今日の記録」と「項目管理」の間に追加:
```tsx
        <nav>
          <NavLink to="/" end>
            今日の記録
          </NavLink>
          <NavLink to="/history">記録の履歴</NavLink>
          <NavLink to="/items">項目管理</NavLink>
        </nav>
```

- [ ] **Step 5: 型チェックと lint**

```bash
npm run build && npm run lint
```
Expected: 型エラー・lint エラーなし。

---

## Task 5: 統合の実機確認

**Files:** なし (動作確認のみ)

- [ ] **Step 1: 開発サーバーと DB を起動する (ユーザー依頼)**

ユーザーに依頼:
```bash
npm run db:start   # 未起動なら
npm run dev
```

- [ ] **Step 2: 複数日の記録を用意する**

ブラウザでサインアップ (または既存ユーザーでログイン) 後、「今日の記録」ページの日付ピッカーで
過去日を含む複数日を選び、次を記録する:
- ある日: 外出=はい (メモあり/なしの両方の日)、純アルコール量を2回 (例: 20g と 20g)、歯磨きを2回 (例: 80点 と 90点)
- 別の日: 一部の項目だけ記録

- [ ] **Step 3: 履歴ページを確認する**

ナビ「記録の履歴」を開き、次を目視確認する:
- 日付カードが新しい順に並ぶ。記録のない日はカードが出ない。
- 純アルコール量が **合計** で「40g」と出る。
- 歯磨きが **各回** で「80点 / 90点」と出る。
- 外出はメモなしの日は「はい」、メモありの日は「外出した: はい」「メモ: …」。
- 記録が31日分以上あれば「もっと見る」が出て、押すと古い日が追記される。31日未満なら「もっと見る」は出ない。

- [ ] **Step 4: 無効化項目の過去記録が残ることを確認する**

「項目管理」でいずれかの項目を無効化 (`is_active=false`) した後、履歴ページで
**その項目の過去記録が引き続き表示される**ことを確認する。

- [ ] **Step 5: 最終確認 (ユーザーが実施)**

```bash
npm test && npm run build && npm run lint
```
Expected: すべて成功。

- [ ] **Step 6: まとめてコミット (ユーザーが実施)**

全タスクの成果物をまとめてコミットする。`/generate-commit-message` でコミットメッセージを生成する。
```bash
git add \
  supabase/migrations/ \
  src/types/database.ts \
  src/types/app.ts \
  vitest.config.ts \
  package.json \
  package-lock.json \
  src/features/records/buildHistoryCards.ts \
  src/features/records/buildHistoryCards.test.ts \
  src/features/records/api.ts \
  src/features/records/useRecordHistory.ts \
  src/features/records/HistoryDayCard.tsx \
  src/pages/HistoryPage.tsx \
  src/App.tsx \
  src/components/Layout.tsx
```

---

## 完了の定義

- `npm test` が通る (`buildHistoryCards` の8ケース)。
- `npm run build` / `npm run lint` がエラーなし。
- 履歴ページで日付カード・合計/各回表示・「もっと見る」・無効化項目の過去記録表示が確認できる。
