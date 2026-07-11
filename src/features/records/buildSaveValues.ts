// フォーム入力値を save_record RPC の引数形式へ変換する。
// DB トリガーと同じルール (必須・数値範囲・文字数) をフロント側でも事前検証する。
import type { RecordField } from "../../types/app";
import type { SaveValueInput } from "./api";

export type DraftValues = Record<string, string | boolean | undefined>;

export function buildSaveValues(
  fields: RecordField[],
  draft: DraftValues,
): SaveValueInput[] {
  const values: SaveValueInput[] = [];

  for (const field of fields) {
    const raw = draft[field.id];

    switch (field.value_type) {
      case "boolean": {
        values.push({ field_id: field.id, value_bool: raw === true });
        break;
      }
      case "number":
      case "score": {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (text === "") {
          if (field.is_required) {
            throw new Error(`${field.label} を入力してください`);
          }
          break;
        }
        const num = Number(text);
        if (Number.isNaN(num)) {
          throw new Error(`${field.label} は数値で入力してください`);
        }
        if (field.min_value !== null && num < field.min_value) {
          throw new Error(
            `${field.label} は ${field.min_value} 以上で入力してください`,
          );
        }
        if (field.max_value !== null && num > field.max_value) {
          throw new Error(
            `${field.label} は ${field.max_value} 以下で入力してください`,
          );
        }
        values.push({ field_id: field.id, value_number: num });
        break;
      }
      case "text": {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (text === "") {
          if (field.is_required) {
            throw new Error(`${field.label} を入力してください`);
          }
          break;
        }
        if (field.max_length !== null && text.length > field.max_length) {
          throw new Error(
            `${field.label} は ${field.max_length} 文字以内で入力してください`,
          );
        }
        values.push({ field_id: field.id, value_text: text });
        break;
      }
      default:
        throw new Error(`未対応の値の種類です: ${field.value_type}`);
    }
  }

  return values;
}
