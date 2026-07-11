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
