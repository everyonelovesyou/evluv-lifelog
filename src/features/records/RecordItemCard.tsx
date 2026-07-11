import { type FormEvent, useEffect, useState } from "react";
import type {
  RecordItemWithFields,
  RecordValue,
  RecordWithValues,
} from "../../types/app";
import type { SaveValueInput } from "./api";
import { buildSaveValues, type DraftValues } from "./buildSaveValues";
import { FieldInput } from "./FieldInput";

type Props = {
  item: RecordItemWithFields;
  records: RecordWithValues[];
  onSave: (itemId: string, values: SaveValueInput[]) => Promise<void>;
};

function draftFromValues(values: RecordValue[]): DraftValues {
  const draft: DraftValues = {};
  for (const value of values) {
    if (value.value_bool !== null) {
      draft[value.field_id] = value.value_bool;
    } else if (value.value_number !== null) {
      draft[value.field_id] = String(value.value_number);
    } else if (value.value_text !== null) {
      draft[value.field_id] = value.value_text;
    }
  }
  return draft;
}

function formatValue(item: RecordItemWithFields, value: RecordValue): string {
  const field = item.record_fields.find((f) => f.id === value.field_id);
  const label = field?.label ?? "値";
  if (value.value_bool !== null) {
    return `${label}: ${value.value_bool ? "はい" : "いいえ"}`;
  }
  if (value.value_number !== null) {
    return `${label}: ${value.value_number}`;
  }
  return `${label}: ${value.value_text ?? ""}`;
}

export function RecordItemCard({ item, records, onSave }: Props) {
  const isDaily = item.frequency === "daily";
  const existing = isDaily ? (records[0] ?? null) : null;

  const [draft, setDraft] = useState<DraftValues>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // daily 項目は既存記録の値をフォームへ反映する
  useEffect(() => {
    setDraft(existing ? draftFromValues(existing.record_values) : {});
  }, [existing]);

  const handleChange = (fieldId: string, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const values = buildSaveValues(item.record_fields, draft);
      await onSave(item.id, values);
      if (!isDaily) {
        setDraft({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="record-card">
      <h2>{item.name}</h2>

      {!isDaily && records.length > 0 && (
        <ul className="record-history">
          {records.map((record) => (
            <li key={record.id}>
              {new Date(record.recorded_at).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {record.record_values.length > 0 && (
                <>
                  {" — "}
                  {record.record_values
                    .map((value) => formatValue(item, value))
                    .join(" / ")}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit}>
        {item.record_fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            draft={draft}
            onChange={handleChange}
          />
        ))}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={saving}>
          {isDaily ? (existing ? "更新する" : "記録する") : "追加する"}
        </button>
        {isDaily && existing && (
          <span className="recorded-badge">記録済み</span>
        )}
      </form>
    </section>
  );
}
