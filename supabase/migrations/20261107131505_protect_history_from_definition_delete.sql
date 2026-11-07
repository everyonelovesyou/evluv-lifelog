-- 定義の無効化と履歴保護: record_fields.is_active の追加、定義削除時の連鎖削除防止、recorded_at の意味明記
-- 対応: docs/reviews/database-design-review.md の P0-1 (定義削除で過去記録を失わない) と P0-3 (recorded_at の意味の確定)

-- 1. record_fields に is_active を追加する (record_items と同じ運用に揃える)
alter table public.record_fields
  add column is_active boolean not null default true;

comment on column public.record_fields.is_active is
  '入力対象かどうか。false でも過去の値は履歴に表示する';

-- 2. 定義の物理削除で過去の記録・値が連鎖削除されないよう、外部キーを NO ACTION に変更する
--    record_values.record_id -> records は「記録を消せば値も消える」が正しいため CASCADE のままにする
--    定義の直接削除が拒否されることと、ユーザー削除 (auth.users からの連鎖) で
--    関連データが残らないことは、実 DB の削除テストで確認する (計画 Task 5)
alter table public.record_fields
  drop constraint record_fields_item_id_fkey,
  add constraint record_fields_item_id_fkey
    foreign key (item_id) references public.record_items (id) on delete no action;

alter table public.records
  drop constraint records_item_id_fkey,
  add constraint records_item_id_fkey
    foreign key (item_id) references public.record_items (id) on delete no action;

alter table public.record_values
  drop constraint record_values_field_id_fkey,
  add constraint record_values_field_id_fkey
    foreign key (field_id) references public.record_fields (id) on delete no action;

-- 3. recorded_at の意味を明記する (P0-3)
comment on column public.records.recorded_at is
  'ユーザーが保存操作を行った時刻。daily 項目の再保存で更新される。出来事の発生時刻ではない';

-- 4. save_record を無効フィールドに対応させる
--    init マイグレーションの定義から変更したのは次の3か所のみ。
--    (a) daily 更新時の値の削除で、無効フィールドの既存値を削除対象から外す
--    (b) 値の INSERT ループ冒頭でフィールドを引き、正当な無効フィールドの送信値を無視する
--        (存在しない・他ユーザー所有・別項目の field_id は従来どおりエラー)
--    (c) 必須フィールド検証から無効フィールドを除外する
create or replace function public.save_record(
  p_item_id uuid,
  p_recorded_on date,
  p_values jsonb default '[]'::jsonb,
  p_recorded_at timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.record_items%rowtype;
  v_record_id uuid;
  v_value jsonb;
  v_field public.record_fields%rowtype;
  v_missing_field text;
begin
  select * into v_item from public.record_items where id = p_item_id;
  if not found then
    raise exception 'record item % not found', p_item_id;
  end if;
  if not v_item.is_active then
    raise exception 'record item % is inactive', v_item.item_key;
  end if;

  if v_item.frequency = 'daily' then
    select id into v_record_id
      from public.records
      where item_id = p_item_id and recorded_on = p_recorded_on;

    if v_record_id is not null then
      update public.records set recorded_at = p_recorded_at where id = v_record_id;
      -- (a) 無効フィールドの既存値は削除しない (入力に現れず再登録されないため)
      delete from public.record_values v
      where v.record_id = v_record_id
        and exists (
          select 1 from public.record_fields f
          where f.id = v.field_id and f.is_active
        );
    end if;
  end if;

  if v_record_id is null then
    insert into public.records (user_id, item_id, recorded_on, recorded_at)
      values (auth.uid(), p_item_id, p_recorded_on, p_recorded_at)
      returning id into v_record_id;
  end if;

  for v_value in select * from jsonb_array_elements(p_values) loop
    -- (b) フィールドを引いて送信値の扱いを決める
    select * into v_field from public.record_fields
      where id = (v_value ->> 'field_id')::uuid;

    -- 存在しない field_id は従来どおりエラー (RLS のため他ユーザーのフィールドも not found になる)
    if not found then
      raise exception 'record field % not found', v_value ->> 'field_id';
    end if;

    -- 別項目の field_id は従来どおりエラー
    if v_field.item_id <> p_item_id or v_field.user_id <> auth.uid() then
      raise exception 'field % does not belong to item %', v_field.id, p_item_id;
    end if;

    -- 正当な無効フィールドの送信値だけを無視する (既存値は (a) で保持される)
    if not v_field.is_active then
      continue;
    end if;

    -- すべての値が空の要素はスキップ (空メモなど)
    if v_value ->> 'value_bool' is null
      and v_value ->> 'value_number' is null
      and nullif(v_value ->> 'value_text', '') is null then
      continue;
    end if;

    insert into public.record_values (record_id, field_id, user_id, value_bool, value_number, value_text)
    values (
      v_record_id,
      (v_value ->> 'field_id')::uuid,
      auth.uid(),
      (v_value ->> 'value_bool')::boolean,
      (v_value ->> 'value_number')::numeric,
      nullif(v_value ->> 'value_text', '')
    );
  end loop;

  -- 必須フィールドがすべて揃っているか検証
  select f.field_key into v_missing_field
    from public.record_fields f
    where f.item_id = p_item_id
      and f.is_required
      and f.is_active
      and not exists (
        select 1 from public.record_values v
        where v.record_id = v_record_id and v.field_id = f.id
      )
    limit 1;

  if v_missing_field is not null then
    raise exception 'required field % is missing', v_missing_field;
  end if;

  return v_record_id;
end;
$$;
