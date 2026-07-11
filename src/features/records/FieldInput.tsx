import type { RecordField } from "../../types/app";
import type { DraftValues } from "./buildSaveValues";

type Props = {
  field: RecordField;
  draft: DraftValues;
  onChange: (fieldId: string, value: string | boolean) => void;
};

export function FieldInput({ field, draft, onChange }: Props) {
  const raw = draft[field.id];

  if (field.value_type === "boolean") {
    return (
      <label className="field-input">
        <input
          type="checkbox"
          checked={raw === true}
          onChange={(e) => onChange(field.id, e.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  if (field.value_type === "number" || field.value_type === "score") {
    return (
      <label className="field-input">
        {field.label}
        <input
          type="number"
          step="any"
          value={typeof raw === "string" ? raw : ""}
          min={field.min_value ?? undefined}
          max={field.max_value ?? undefined}
          required={field.is_required}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      </label>
    );
  }

  return (
    <label className="field-input">
      {field.label}
      <input
        type="text"
        value={typeof raw === "string" ? raw : ""}
        maxLength={field.max_length ?? undefined}
        required={field.is_required}
        onChange={(e) => onChange(field.id, e.target.value)}
      />
    </label>
  );
}
