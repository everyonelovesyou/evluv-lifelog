import { supabase } from "../../lib/supabase/client";
import type { RecordItemWithFields, RecordWithValues } from "../../types/app";
import type { Json } from "../../types/database";

export type SaveValueInput = {
  field_id: string;
  value_bool?: boolean;
  value_number?: number;
  value_text?: string;
};

export async function fetchActiveItemsWithFields(): Promise<
  RecordItemWithFields[]
> {
  const { data, error } = await supabase
    .from("record_items")
    .select("*, record_fields(*)")
    .eq("is_active", true)
    .order("sort_order")
    .order("sort_order", { referencedTable: "record_fields" });
  if (error) throw error;
  return data;
}

export async function fetchRecordsByDate(
  recordedOn: string,
): Promise<RecordWithValues[]> {
  const { data, error } = await supabase
    .from("records")
    .select("*, record_values(*)")
    .eq("recorded_on", recordedOn)
    .order("recorded_at");
  if (error) throw error;
  return data;
}

// daily 項目は upsert、multiple 項目は insert (判定は DB 側の RPC が行う)
export async function saveRecord(
  itemId: string,
  recordedOn: string,
  values: SaveValueInput[],
): Promise<string> {
  const { data, error } = await supabase.rpc("save_record", {
    p_item_id: itemId,
    p_recorded_on: recordedOn,
    p_values: values as Json,
  });
  if (error) throw error;
  return data;
}
