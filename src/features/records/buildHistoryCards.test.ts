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
