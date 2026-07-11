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
