-- ============================================================
-- 生活ログ 初回マイグレーション
--
-- 3層構造:
--   定義層: record_items (記録項目) + record_fields (項目のフィールド定義)
--   記録層: records (いつ・何を記録したか)
--   値層:   record_values (フィールドごとの値)
--
-- 整合性保証 (3段構え):
--   1. RPC save_record: 1日1回 (daily) 項目は upsert、複数回 (multiple) 項目は insert
--   2. DBトリガー: 定義との型・所属・範囲の整合性検証 / frequency の転記
--   3. 部分ユニークインデックス: daily 項目の重複を最終的に防止
-- ============================================================

-- ------------------------------------------------------------
-- 定義層: record_items (記録項目)
-- ------------------------------------------------------------
-- frequency / value_type は PostgreSQL enum ではなく text + CHECK 制約で管理する。
-- enum は値の追加に ALTER TYPE が必要になり将来のマイグレーションが煩雑になるため。
create table public.record_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  item_key text not null,
  frequency text not null check (frequency in ('daily', 'multiple')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_key)
);

create index record_items_user_id_idx on public.record_items (user_id);

comment on table public.record_items is '記録項目の定義 (ユーザーごと)';
comment on column public.record_items.frequency is 'daily: 1日1回 / multiple: 1日に複数回記録可能';

-- ------------------------------------------------------------
-- 定義層: record_fields (項目が持つフィールドの定義)
-- ------------------------------------------------------------
-- メモも「text 型の任意フィールド」としてここで定義する (特定項目専用カラムにしない)。
-- score は number と同じく value_number に保存されるが、UI 上の意味づけのため区別する。
create table public.record_fields (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.record_items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  field_key text not null,
  label text not null,
  value_type text not null check (value_type in ('boolean', 'number', 'text', 'score')),
  is_required boolean not null default false,
  min_value numeric,
  max_value numeric,
  max_length integer check (max_length is null or max_length > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, field_key),
  check (min_value is null or max_value is null or min_value <= max_value)
);

create index record_fields_item_id_idx on public.record_fields (item_id);
create index record_fields_user_id_idx on public.record_fields (user_id);

comment on table public.record_fields is '記録項目が持つフィールドの定義 (値の種類・必須・範囲)';

-- ------------------------------------------------------------
-- 記録層: records
-- ------------------------------------------------------------
-- recorded_on (記録対象日) と recorded_at (実際に記録操作をした日時) を分ける。
-- 深夜に前日分を入力するケースに対応するため。
-- frequency は record_items からトリガーで転記する (直接指定不可)。
-- 部分ユニークインデックスの条件に他テーブルの値を使えないための非正規化。
create table public.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.record_items (id) on delete cascade,
  recorded_on date not null,
  recorded_at timestamptz not null default now(),
  frequency text not null check (frequency in ('daily', 'multiple')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- daily 項目は同一ユーザー・同一項目・同一記録対象日に1件のみ (最終防衛線)
create unique index records_daily_unique_idx
  on public.records (user_id, item_id, recorded_on)
  where frequency = 'daily';

create index records_user_recorded_on_idx on public.records (user_id, recorded_on);
create index records_item_id_idx on public.records (item_id);

comment on table public.records is '実際の記録 (いつ・どの項目を記録したか)';
comment on column public.records.frequency is 'record_items.frequency のトリガー転記 (部分ユニークインデックス用)';

-- ------------------------------------------------------------
-- 値層: record_values
-- ------------------------------------------------------------
-- 型別の nullable カラムを持ち、ちょうど1つだけ値が入ることを CHECK で保証する。
-- score は value_number に保存する。
create table public.record_values (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records (id) on delete cascade,
  field_id uuid not null references public.record_fields (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  value_bool boolean,
  value_number numeric,
  value_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (record_id, field_id),
  check (num_nonnulls(value_bool, value_number, value_text) = 1)
);

create index record_values_record_id_idx on public.record_values (record_id);
create index record_values_field_id_idx on public.record_values (field_id);
create index record_values_user_id_idx on public.record_values (user_id);

comment on table public.record_values is '記録に付随する値 (フィールドごとに1行)';

-- ------------------------------------------------------------
-- updated_at 自動更新
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_record_items_updated_at
  before update on public.record_items
  for each row execute function public.set_updated_at();

create trigger set_record_fields_updated_at
  before update on public.record_fields
  for each row execute function public.set_updated_at();

create trigger set_records_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();

create trigger set_record_values_updated_at
  before update on public.record_values
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- records.frequency を項目定義から転記するトリガー
-- ------------------------------------------------------------
-- insert / update のたびに必ず定義から再取得するため、クライアントは frequency を偽装できない。
create or replace function public.sync_record_frequency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_frequency text;
begin
  select frequency into v_frequency
    from public.record_items
    where id = new.item_id;

  if v_frequency is null then
    raise exception 'record item % not found', new.item_id;
  end if;

  new.frequency := v_frequency;
  return new;
end;
$$;

create trigger sync_records_frequency
  before insert or update on public.records
  for each row execute function public.sync_record_frequency();

-- ------------------------------------------------------------
-- record_values の整合性検証トリガー
-- ------------------------------------------------------------
-- 1. field が record の item に属しているか
-- 2. user_id が record / field と一致しているか
-- 3. 値が field の value_type に対応するカラムに入っているか
-- 4. min_value / max_value / max_length の範囲内か
create or replace function public.validate_record_value()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_field public.record_fields%rowtype;
  v_record public.records%rowtype;
begin
  select * into v_field from public.record_fields where id = new.field_id;
  if not found then
    raise exception 'record field % not found', new.field_id;
  end if;

  select * into v_record from public.records where id = new.record_id;
  if not found then
    raise exception 'record % not found', new.record_id;
  end if;

  if v_field.item_id <> v_record.item_id then
    raise exception 'field % does not belong to the item of record %', new.field_id, new.record_id;
  end if;

  if new.user_id <> v_record.user_id or new.user_id <> v_field.user_id then
    raise exception 'user_id mismatch between record_values, records and record_fields';
  end if;

  case v_field.value_type
    when 'boolean' then
      if new.value_bool is null then
        raise exception 'field % (boolean) requires value_bool', v_field.field_key;
      end if;
    when 'number' then
      if new.value_number is null then
        raise exception 'field % (number) requires value_number', v_field.field_key;
      end if;
    when 'score' then
      if new.value_number is null then
        raise exception 'field % (score) requires value_number', v_field.field_key;
      end if;
    when 'text' then
      if new.value_text is null then
        raise exception 'field % (text) requires value_text', v_field.field_key;
      end if;
  end case;

  if new.value_number is not null then
    if v_field.min_value is not null and new.value_number < v_field.min_value then
      raise exception 'field % value % is below minimum %', v_field.field_key, new.value_number, v_field.min_value;
    end if;
    if v_field.max_value is not null and new.value_number > v_field.max_value then
      raise exception 'field % value % exceeds maximum %', v_field.field_key, new.value_number, v_field.max_value;
    end if;
  end if;

  if new.value_text is not null
    and v_field.max_length is not null
    and char_length(new.value_text) > v_field.max_length then
    raise exception 'field % text exceeds max length %', v_field.field_key, v_field.max_length;
  end if;

  return new;
end;
$$;

create trigger validate_record_values
  before insert or update on public.record_values
  for each row execute function public.validate_record_value();

-- ------------------------------------------------------------
-- RPC: save_record
-- ------------------------------------------------------------
-- 記録の保存を1トランザクションで行う。
--   daily 項目: 既存記録があれば recorded_at を更新し、値を入れ替える (upsert)
--   multiple 項目: 常に新規 insert
-- security invoker のため RLS がそのまま適用される。
-- p_values: [{"field_id": "...", "value_bool": true}, {"field_id": "...", "value_text": "..."}]
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
      delete from public.record_values where record_id = v_record_id;
    end if;
  end if;

  if v_record_id is null then
    insert into public.records (user_id, item_id, recorded_on, recorded_at)
      values (auth.uid(), p_item_id, p_recorded_on, p_recorded_at)
      returning id into v_record_id;
  end if;

  for v_value in select * from jsonb_array_elements(p_values) loop
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

grant execute on function public.save_record(uuid, date, jsonb, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- 権限 (GRANT)
-- ------------------------------------------------------------
-- RLS はテーブル権限の上で行を絞り込む仕組みのため、まず authenticated ロールへ
-- テーブル権限を明示的に付与する。匿名アクセスは不要のため anon には付与しない。
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.record_items to authenticated;
grant select, insert, update, delete on table public.record_fields to authenticated;
grant select, insert, update, delete on table public.records to authenticated;
grant select, insert, update, delete on table public.record_values to authenticated;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.record_items enable row level security;
alter table public.record_fields enable row level security;
alter table public.records enable row level security;
alter table public.record_values enable row level security;

-- record_items
create policy "record_items_select_own" on public.record_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "record_items_insert_own" on public.record_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "record_items_update_own" on public.record_items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "record_items_delete_own" on public.record_items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- record_fields
create policy "record_fields_select_own" on public.record_fields
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "record_fields_insert_own" on public.record_fields
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "record_fields_update_own" on public.record_fields
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "record_fields_delete_own" on public.record_fields
  for delete to authenticated using ((select auth.uid()) = user_id);

-- records
create policy "records_select_own" on public.records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "records_insert_own" on public.records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "records_update_own" on public.records
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "records_delete_own" on public.records
  for delete to authenticated using ((select auth.uid()) = user_id);

-- record_values
create policy "record_values_select_own" on public.record_values
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "record_values_insert_own" on public.record_values
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "record_values_update_own" on public.record_values
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "record_values_delete_own" on public.record_values
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------
-- 初期記録項目の作成 (Auth ユーザー作成トリガー)
-- ------------------------------------------------------------
-- ユーザー登録時に初期項目を自動作成する。
-- security definer で実行されるため RLS の影響を受けない (auth.users への
-- insert 時点ではまだセッションが存在しないため invoker では動作しない)。
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

  -- 純アルコール摂取量 (1日複数回 / 数値 g / 0未満不可)
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '純アルコール量', 'alcohol', 'multiple', 2)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, min_value, sort_order)
    values
      (v_item_id, new.id, 'amount', '摂取量 (g)', 'number', true, 0, 1);

  -- 歯磨き (1日複数回 / 任意の点数)
  -- 点数の範囲は未確定のため min/max 制約は付けない
  insert into public.record_items (user_id, name, item_key, frequency, sort_order)
    values (new.id, '歯磨き', 'toothbrushing', 'multiple', 3)
    returning id into v_item_id;
  insert into public.record_fields (item_id, user_id, field_key, label, value_type, is_required, sort_order)
    values
      (v_item_id, new.id, 'score', '点数', 'score', false, 1);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_default_record_items();
