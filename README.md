# evluv-lifelog

自分用のライフログWebアプリ。
日々の記録項目 (外出・純アルコール量・歯磨きなど) を、項目定義の追加によって柔軟に増やせる構成になっている。

## 技術構成

- React 19 + TypeScript + Vite
- Supabase (PostgreSQL / Authentication / Row Level Security / Migrations)
- npm
- Biome (lint / format)

## ディレクトリ構成

```text
.
├── src/
│   ├── components/          # 共通コンポーネント (Layout など)
│   ├── features/
│   │   ├── auth/            # 認証 (Provider, フォーム, API)
│   │   ├── records/         # 今日の記録 (API, hooks, カードUI)
│   │   └── record-items/    # 記録項目管理 (API, hooks, テーブルUI)
│   ├── lib/supabase/        # Supabase クライアント
│   ├── pages/               # ルーティング単位の薄いページ
│   ├── types/
│   │   ├── database.ts      # Supabase CLI 生成の Database 型
│   │   └── app.ts           # 手書きの別名・アプリ用型
│   └── App.tsx
├── public/
├── supabase/
│   ├── migrations/          # DB スキーマ (Git 管理)
│   ├── seed.sql
│   └── config.toml
├── .env.example
└── package.json
```

## ローカル開発の始め方

1. Supabase CLI の準備
    - `brew install supabase/tap/supabase` などでインストールする
    - ローカル DB の起動には Docker が必要
2. 依存関係のインストール
    - `npm install`
3. ローカル DB の起動
    - `npm run db:start`
    - 初回はマイグレーションと seed が自動適用される
    - 出力に表示される `API URL` と `anon key` を控える
4. 環境変数の設定
    - `cp .env.example .env`
    - `VITE_SUPABASE_URL` に API URL (ローカルは `http://127.0.0.1:54321`)
    - `VITE_SUPABASE_ANON_KEY` に anon key
5. 開発サーバーの起動
    - `npm run dev`

## npm scripts

| スクリプト | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 型チェック + ビルド |
| `npm run preview` | ビルド成果物のプレビュー |
| `npm run lint` | Biome lint |
| `npm run format` | Biome format (書き込み) |
| `npm run format:check` | Biome format チェックのみ |
| `npm run db:start` | ローカル Supabase 起動 |
| `npm run db:stop` | ローカル Supabase 停止 |
| `npm run db:reset` | DB リセット (マイグレーション + seed 再適用) |
| `npm run db:migration -- <name>` | マイグレーション作成 |
| `npm run db:types` | Database 型生成 (`src/types/database.ts` を上書き) |

### マイグレーションの適用

- ローカル: `npm run db:reset` (作り直し) または `supabase migration up` (差分適用)
- リモート: `supabase link` 後に `supabase db push`

### DB 型生成

ローカル DB 起動中に `npm run db:types` を実行すると、スキーマから `src/types/database.ts` が再生成される。
手書きの型は `src/types/app.ts` に置く。

## データモデル概要

完全なEAVに寄せず、型安全性・制約・検索性を保つハイブリッドな3層構造。

```text
定義層  record_items   記録項目 (名前, キー, 頻度 daily/multiple, 有効/無効, 表示順)
        record_fields  項目が持つフィールド (値の種類, 必須, min/max, 文字数上限)
記録層  records        いつ・どの項目を記録したか (記録対象日と記録日時は別)
値層    record_values  フィールドごとの値 (value_bool / value_number / value_text)
```

- 値の種類 (`boolean` / `number` / `text` / `score`) と頻度 (`daily` / `multiple`) は PostgreSQL enum ではなく text + CHECK 制約。
  enum の値追加に伴うマイグレーションの煩雑さを避けるため
- `record_values` は型別の nullable カラムを持ち、`num_nonnulls(...) = 1` の CHECK 制約で「ちょうど1つだけ値が入る」ことを保証。
  score は `value_number` に保存する
- メモは「text 型の任意フィールド」として `record_fields` で定義する汎用的な付加情報 (特定項目専用のカラムではない)
- `records.recorded_on` (記録対象日) と `recorded_at` (記録操作日時) を分離。深夜に前日分を入力できる
- `recorded_at` はユーザーが保存操作を行った時刻 (daily 項目の再保存で更新される) であり、出来事の発生時刻ではない。発生時刻が必要になった場合は `occurred_at` を別途追加する

### 整合性の保証 (3段構え)

1. RPC `save_record`
    - daily 項目は既存記録を upsert (recorded_at 更新 + 値の入れ替え)、multiple 項目は insert
    - 必須フィールドの存在も検証する
    - `security invoker` のため RLS がそのまま適用される
2. DB トリガー
    - `records.frequency` を項目定義から転記 (クライアントは偽装できない)
    - `record_values` の insert/update 時に、フィールドの所属・user_id の一致・値の種類とカラムの対応・min/max・文字数上限を検証
3. 部分ユニークインデックス
    - `UNIQUE (user_id, item_id, recorded_on) WHERE frequency = 'daily'` が最終防衛線
    - 部分インデックスの条件に他テーブルを参照できないため、frequency をトリガーで `records` に非正規化している

フロント側でも同じルール (`src/features/records/buildSaveValues.ts`) を事前検証し、DB エラー前にユーザーへフィードバックする。

## 初期記録項目が作られる仕組み

`auth.users` への INSERT トリガー (`public.create_default_record_items`, `security definer`) が、ユーザー登録時に以下の項目とフィールドをそのユーザーのデータとして作成する。

| 項目 | 頻度 | フィールド |
| --- | --- | --- |
| 外出 | daily | 外出した (boolean, 必須) / メモ (text, 任意, 100文字) |
| 純アルコール量 | multiple | 摂取量 g (number, 必須, 0以上) |
| 歯磨き | multiple | 点数 (score, 任意, 範囲制約なし) |

この方式を採用した理由:

- seed 時点ではユーザーIDが確定していないため、seed での直接 insert は不可
- 項目はユーザーごとに追加・無効化・並べ替えできる必要があり、全ユーザー共通の固定マスタにしない方針のため
- トリガーならフロントに初期化ロジックが不要で、登録した瞬間から項目が揃う

`supabase/seed.sql` は上記の説明のみで、データ挿入は行わない。

## RLS の考え方

権限は「GRANT が土台、RLS が絞り込み」の二層構造になっている。

1. GRANT — テーブルへのアクセス権そのもの
    - `authenticated` ロールへ4テーブルの `SELECT / INSERT / UPDATE / DELETE` を明示的に付与
    - GRANT がないと RLS ポリシー以前に `permission denied` (403) になる
    - 以前の Supabase はデフォルト権限で自動付与していたが、現行の CLI 環境では明示が必須
2. RLS — 付与されたアクセスを自分の行だけに絞り込む

- 全4テーブルで RLS を有効化
- 各テーブルに select / insert / update / delete の4ポリシーを定義し、すべて `(select auth.uid()) = user_id` で自分のデータのみに制限
- 匿名アクセスは想定しない (`to authenticated` のみ)
- RPC `save_record` は `security invoker` のため RLS の範囲内でしか動作しない
- 初期項目作成トリガーのみ `security definer` (auth.users への insert 時点ではセッションが存在しないため)

## 現時点で未実装の内容

- 過去の記録の閲覧・編集・削除 (今日の記録画面の日付変更で過去日の入力は可能)
- 記録項目の名前変更・削除、フィールド定義の編集UI
- 純アルコール量の「缶チューハイの度数と容量・定量ポンプのプッシュ回数からの計算」UI (現状はグラム数を直接入力)
- 歯磨きの点数範囲の制約 (範囲が確定したら `record_fields.min_value / max_value` を設定する)
- 並べ替えの2回更新のトランザクション化 (現状は連続した2つの update)
- パスワードリセット・メールアドレス変更
- テスト
