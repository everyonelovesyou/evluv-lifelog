import { supabase } from "../../lib/supabase/client";
import type {
  Frequency,
  RecordItem,
  RecordItemWithFields,
  ValueType,
} from "../../types/app";
import type { Database } from "../../types/database";

type RecordFieldInsert =
  Database["public"]["Tables"]["record_fields"]["Insert"];

export type NewItemInput = {
  name: string;
  itemKey: string;
  frequency: Frequency;
  valueType: ValueType;
  valueLabel: string;
  withNote: boolean;
};

export async function fetchAllItemsWithFields(): Promise<
  RecordItemWithFields[]
> {
  const { data, error } = await supabase
    .from("record_items")
    .select("*, record_fields(*)")
    .order("sort_order")
    .order("sort_order", { referencedTable: "record_fields" });
  if (error) throw error;
  return data;
}

export async function createItem(input: NewItemInput): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error("ログインしていません");

  const { data: last, error: lastError } = await supabase
    .from("record_items")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { data: item, error: itemError } = await supabase
    .from("record_items")
    .insert({
      user_id: user.id,
      name: input.name,
      item_key: input.itemKey,
      frequency: input.frequency,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select()
    .single();
  if (itemError) throw itemError;

  const fields: RecordFieldInsert[] = [
    {
      item_id: item.id,
      user_id: user.id,
      field_key: "value",
      label: input.valueLabel,
      value_type: input.valueType,
      is_required: input.valueType === "boolean",
      sort_order: 1,
    },
  ];
  if (input.withNote) {
    fields.push({
      item_id: item.id,
      user_id: user.id,
      field_key: "note",
      label: "メモ",
      value_type: "text",
      is_required: false,
      max_length: 100,
      sort_order: 2,
    });
  }

  const { error: fieldsError } = await supabase
    .from("record_fields")
    .insert(fields);
  if (fieldsError) throw fieldsError;
}

export async function setItemActive(
  itemId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("record_items")
    .update({ is_active: isActive })
    .eq("id", itemId);
  if (error) throw error;
}

// 上下ボタンによる並べ替え: 隣接する2項目の sort_order を入れ替える
export async function swapSortOrder(
  a: Pick<RecordItem, "id" | "sort_order">,
  b: Pick<RecordItem, "id" | "sort_order">,
): Promise<void> {
  const { error: errorA } = await supabase
    .from("record_items")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  if (errorA) throw errorA;

  const { error: errorB } = await supabase
    .from("record_items")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
  if (errorB) throw errorB;
}
