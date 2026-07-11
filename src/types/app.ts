// database.ts (自動生成) から利用しやすい別名を切り出したアプリ用型定義。
// database.ts は `npm run db:types` で上書きされるため、手書きの型はここに置く。
import type { Database } from "./database";

export type RecordItem = Database["public"]["Tables"]["record_items"]["Row"];
export type RecordField = Database["public"]["Tables"]["record_fields"]["Row"];
export type RecordRow = Database["public"]["Tables"]["records"]["Row"];
export type RecordValue = Database["public"]["Tables"]["record_values"]["Row"];

export type Frequency = "daily" | "multiple";
export type ValueType = "boolean" | "number" | "text" | "score";

export type RecordItemWithFields = RecordItem & {
  record_fields: RecordField[];
};

export type RecordWithValues = RecordRow & {
  record_values: RecordValue[];
};

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
