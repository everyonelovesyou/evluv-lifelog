-- 記録の履歴機能: history_aggregation / unit 列と集約 RPC を追加

-- 1. record_fields に集約定義と単位を追加
alter table public.record_fields
  add column history_aggregation text not null default 'none'
    check (history_aggregation in ('none', 'sum')),
  add column unit text;

-- sum は数値系フィールドにしか付けられないよう縛る (既存行は全て 'none' なので矛盾しない)
alter table public.record_fields
  add constraint record_fields_sum_numeric_only
    check (history_aggregation = 'none' or value_type in ('number', 'score'));

comment on column public.record_fields.history_aggregation is
  '履歴カードでの集約方法: none=各回を並べる / sum=value_number を合計';
comment on column public.record_fields.unit is
  '数値の後ろに表示する単位 (例: g, 点)';

-- 2. 初期項目トリガーを更新 (純アルコール amount=sum/g、歯磨き score=点)
create or replace function public.create_default_record_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
begin
  -- 外出 (1日1回 / boolean + 任意メモ)
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '外出', 'outing', 'daily', 1)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, max_length, sort_order)
    values
      (v_item_id, new.id, 'done', '外出した', 'boolean', true, null, 1),
      (v_item_id, new.id, 'note', 'メモ', 'text', false, 100, 2);

  -- 純アルコール摂取量 (1日複数回 / 数値 g / 0未満不可 / 履歴は合計)
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '純アルコール量', 'alcohol', 'multiple', 2)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, min_value, sort_order, history_aggregation, unit)
    values
      (v_item_id, new.id, 'amount', '摂取量 (g)', 'number', true, 0, 1, 'sum', 'g');

  -- 歯磨き (1日複数回 / 任意の点数 / 履歴は各回を並べる)
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '歯磨き', 'toothbrushing', 'multiple', 3)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, sort_order, unit)
    values
      (v_item_id, new.id, 'score', '点数', 'score', false, 1, '点');

  return new;
end;
$$;

-- 3. 既存ユーザーのフィールドをバックフィル (item_key + field_key で限定)
update public.record_fields f
  set history_aggregation = 'sum', unit = 'g'
  from public.record_items i
  where f.item_id = i.id
    and i.item_key = 'alcohol' and f.field_key = 'amount';

update public.record_fields f
  set unit = '点'
  from public.record_items i
  where f.item_id = i.id
    and i.item_key = 'toothbrushing' and f.field_key = 'score';

-- 4. 履歴取得 RPC
create or replace function public.get_record_history(
  p_before date default null,
  p_limit  int  default 30
)
returns table (
  record_id   uuid,
  item_id     uuid,
  item_key    text,
  item_name   text,
  frequency   text,
  recorded_on date,
  recorded_at timestamptz,
  fields      jsonb,
  has_more    boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit int;
  v_has_more boolean;
begin
  if p_limit is null or p_limit <= 0 then
    raise exception 'p_limit must be a positive integer';
  end if;
  v_limit := least(p_limit, 100);

  -- p_limit + 1 日目の存在で has_more を判定 (列名衝突回避のため as day)
  with peek as (
    select distinct r.recorded_on as day
    from public.records r
    where r.user_id = auth.uid()
      and (p_before is null or r.recorded_on < p_before)
    order by r.recorded_on desc
    limit v_limit + 1
  )
  select count(*) > v_limit into v_has_more from peek;

  return query
  with target_days as (
    select distinct r.recorded_on as day
    from public.records r
    where r.user_id = auth.uid()
      and (p_before is null or r.recorded_on < p_before)
    order by r.recorded_on desc
    limit v_limit
  )
  select
    r.id, r.item_id, i.item_key, i.name, r.frequency, r.recorded_on, r.recorded_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'field_id', f.id, 'field_key', f.field_key, 'label', f.label,
          'value_type', f.value_type, 'history_aggregation', f.history_aggregation,
          'unit', f.unit,
          'value_bool', v.value_bool, 'value_number', v.value_number,
          'value_text', v.value_text, 'sort_order', f.sort_order
        ) order by f.sort_order, f.id
      )
      from public.record_values v
      join public.record_fields f on f.id = v.field_id
      where v.record_id = r.id
    ), '[]'::jsonb),
    v_has_more
  from public.records r
  join public.record_items i on i.id = r.item_id   -- is_active でフィルタしない (無効化項目の過去記録も表示)
  where r.user_id = auth.uid()
    and r.recorded_on in (select day from target_days)
  order by r.recorded_on desc, i.sort_order, r.recorded_at, r.id;
end;
$$;

grant execute on function public.get_record_history(date, int) to authenticated;
