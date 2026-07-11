import { type FormEvent, useState } from "react";
import type { Frequency, ValueType } from "../../types/app";
import type { NewItemInput } from "./api";

type Props = {
  onSubmit: (input: NewItemInput) => Promise<void>;
};

const initialState = {
  name: "",
  itemKey: "",
  frequency: "daily" as Frequency,
  valueType: "boolean" as ValueType,
  valueLabel: "した",
  withNote: true,
};

export function NewRecordItemForm({ onSubmit }: Props) {
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(form);
      setForm(initialState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="new-item-form" onSubmit={handleSubmit}>
      <h2>項目を追加</h2>
      <label>
        項目名
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </label>
      <label>
        キー (半角英数)
        <input
          type="text"
          value={form.itemKey}
          onChange={(e) => setForm({ ...form, itemKey: e.target.value })}
          pattern="[a-z0-9_-]+"
          title="半角小文字英数とハイフン・アンダースコアのみ"
          required
        />
      </label>
      <label>
        頻度
        <select
          value={form.frequency}
          onChange={(e) =>
            setForm({ ...form, frequency: e.target.value as Frequency })
          }
        >
          <option value="daily">1日1回</option>
          <option value="multiple">1日に複数回</option>
        </select>
      </label>
      <label>
        値の種類
        <select
          value={form.valueType}
          onChange={(e) =>
            setForm({ ...form, valueType: e.target.value as ValueType })
          }
        >
          <option value="boolean">はい / いいえ</option>
          <option value="number">数値</option>
          <option value="text">テキスト</option>
          <option value="score">点数</option>
        </select>
      </label>
      <label>
        値のラベル
        <input
          type="text"
          value={form.valueLabel}
          onChange={(e) => setForm({ ...form, valueLabel: e.target.value })}
          required
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.withNote}
          onChange={(e) => setForm({ ...form, withNote: e.target.checked })}
        />
        メモ欄を付ける (100文字以内)
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        追加する
      </button>
    </form>
  );
}
