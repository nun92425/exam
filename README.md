# テスト範囲表 — Firebase Edition

高校の定期テスト範囲表を、旧 GAS + Google Sheets 構成から **Firebase** に移行したサイトです。
ライト基調 + ダークテーマ、スマホ対応、そして **デフォルトでAPIキー不要・完全無料で動くAIコーチ** を備えています。

- 旧サイト: https://test-coverage-szdm.onrender.com
- 最終更新: 2026-10-29

---

## ✨ 主な機能

### 範囲表
- コース別フィルタ（K/文系、K/理系 物理・生物、SS/理系 物理・生物）
- 表 / カード / カレンダー / タイムラインの4表示
- 教科・範囲・備考の検索（`/` でフォーカス）、教科チップ、並べ替え
- 「今日以降のみ」、表示密度切替、印刷
- 日付グルーピング、TODAYバッジ、教科カラー

### 学習支援
- 直近テストまでのカウントダウン
- 提出物チェック＆進捗バー（localStorage）
- ポモドーロタイマー（教科別・日次集計・連続日数）
- 学習計画の自動生成（範囲を日割り、ICS出力可）
- 共有（Web Share / LINE / X）、通知、`.ics` エクスポート

### AIコーチ（無料）
- 今日の計画、提出物の確認、進捗、テスト日程、教科別の勉強法、やる気対策
- 端末AI（Chrome内蔵のGemini Nano）対応。入力は端末内だけで処理
- 端末AI非対応でも、Cloudflare有効時はクラウドAIへ。未設定・上限時は簡易コーチへ自動フォールバック
- 任意で Cloudflare Workers AI / Gemini Functions も使えるが、**デフォルトはOFF**

### 管理
- 変更提案フォーム（`suggest.html`）
- 管理者コンソール（バージョン管理 / 範囲・提出物エディタ / 提案承認）
- Firebase Auth（登録 / ログイン / パスワードリセット / 自動ログイン）
- Firestore Rules による権限制御

---

## 🤖 AIコーチの仕組み（無料）

Gemini APIの無料枠は、リクエスト数や1日あたりの上限が小さく、公開サイトの全員利用には向きません。
このサイトでは **「まず端末内で完結するAI」を基本** にし、クラウドAIは任意の追加機能にしました。

```
ユーザーの入力
   │
   ├─ 計画・提出物・日程・進捗 ──→ 簡易コーチ（ルールベース）
   │                                 ・全端末で動作
   │                                 ・0円 / 通信不要 / 即時
   │
   └─ 自由質問・勉強法・やる気
          ├─ 端末AI（Chrome 148+ デスクトップ）
          │    ・Gemini Nano
          │    ・0円 / 入力は端末内だけ
          │
          ├─ Cloudflare Workers AI（任意・全端末）
          │    ・無料枠 10,000 Neurons/日
          │    ・1人20回/日・全体400回/日で制限
          │
          └─ 端末AI非対応はCloudflareへ
             上限・障害時は簡易コーチへ
```

### 1. 簡易コーチ（デフォルト・全端末）
範囲表・提出物・タイマー記録を読み、決定論的に回答します。

- 「今日の計画」→ テストまでの日数から、25分×2〜3セットを提案
- 「提出物を確認」→ 未完了の提出物とテスト日を一覧
- 「数学の勉強法」→ 教科別の具体的な進め方
- 「やる気が出ない」→ 5分だけ始める作戦
- 「数学の二次関数が分からない」→ 答えを書かず3段階ヒント

外部APIを呼ばないため、**何人使っても0円**です。入力内容も外部に送信されません。

### 2. 端末AI（Chrome 148+ デスクトップ）
Chrome内蔵の **Prompt API（Gemini Nano）** を使います。APIキーもサーバーも不要です。

- 対象: Windows 10/11、macOS 13+、Linux、ChromeOS Plus の Chrome 148以降
- 目安: 空きストレージ22GB以上、GPU 4GB VRAM以上 または 16GB RAM以上
- 日本語入力・日本語出力に対応
- 初回のみモデルのダウンロードあり（Chromeが管理）
- スマホ・Safari・Firefoxでは自動的に簡易コーチへフォールバック

コーチ右上の **「端末AIを使う（無料）」** から有効化できます。OFFにすると簡易コーチに戻ります。

### 3. Cloudflare Workers AI（任意・全端末）
スマホを含む全端末に自由質問を届けたい場合のクラウドAIです。WorkerがCloudflareのAIバインディングを使い、ブラウザには認証情報を出さずWorkerのURLだけを使います。

- 無料枠: **10,000 Neurons / 日**（Workers無料プラン・カード登録なし）
- 既定モデル: `@cf/meta/llama-3.1-8b-instruct-fp8`
- 短い質問（入力800＋出力300トークン程度）で **約500回/日** の目安
- この実装は **1人20回/日・全体400回/日** に制限
- 15〜20人が1日10回使う程度なら、無料枠に十分収まる
- 上限到達・Worker障害時は自動で簡易コーチへ

```env
VITE_AI_MODE=cloudflare
VITE_CLOUDFLARE_AI_URL=https://exam-coach-ai.your-subdomain.workers.dev
```

導入手順は「☁️ Cloudflare Workers AI を有効にする」を参照してください。

### 4. Gemini Functions（従来・任意）
以前の Gemini Functions も残していますが、**明示的に有効化した場合だけ**使います。

```env
VITE_AI_MODE=cloud
```

- Firebase Functions（`coachChat`）と `GEMINI_API_KEY` が必要
- Geminiの無料枠には上限があるため、大人数向けではありません
- 429（混雑）やFunctions未デプロイ時は、自動で簡易コーチにフォールバック
- 個人情報は送らない設計（コース・範囲件数・進捗・学習時間のみ）

---

## 🏗 技術スタック

- **Vite 8** + Vanilla JS
- **Tailwind CSS 3**
- **Firebase SDK 12**（Auth / Firestore / Functions）
- **Chrome Prompt API**（Gemini Nano、任意）
- **Cloudflare Workers AI**（任意のクラウドAI、無料枠内）
- Firestore Rules で権限制御（`users/{uid}.isAdmin == true` のみ管理操作）

---

## 📁 構成

```
├── index.html              # トップ（範囲表・AIコーチ）
├── suggest.html            # 提案フォーム
├── admin.html              # 管理者コンソール
├── src/
│   ├── main.js             # トップのロジック
│   ├── suggest.js
│   ├── admin.js
│   ├── firebase.js         # Firebase初期化（.envから）
│   ├── firestore.js        # 読み取りヘルパ + デモフォールバック
│   ├── auth.js             # Auth共通
│   ├── constants.js        # コース/科目定義
│   ├── utils.js
│   ├── theme.js            # ライト/ダークテーマ
│   ├── icons.js
│   ├── style.css           # Tailwind + カスタムglass
│   ├── coach.js            # コーチUI・送信ルーティング
│   ├── coachEngine.js      # 簡易コーチ（ルールベース・完全無料）
│   ├── coachAI.js          # 端末AI（Chrome Prompt API）ラッパー
│   └── coachPrompt.js      # 端末AI・クラウドAI共通のシステムプロンプト
├── workers/
│   └── coach-ai/           # 任意のクラウドAI（Cloudflare Workers AI）
│       ├── src/index.js
│       ├── wrangler.toml
│       └── package.json
├── functions/
│   └── index.js            # 任意のクラウドAI（Gemini Functions）
├── public/
│   ├── manifest.json
│   └── images/icon/
├── firestore.rules
├── firestore.indexes.json
├── firebase.json / .firebaserc
├── scripts/seed.js         # 初期データ投入
├── render.yaml             # Render静的ホスティング用
└── .env.example
```

### Firestore コレクション

| コレクション | 説明 |
|---|---|
| `config/main` | `{ version, versionLabel, updatedAt }` 現在の定期テスト |
| `versions/{name}` | バージョン一覧（id=バージョン名） |
| `schedules` | 各行 `{ version, course, subject, date, period, scope, notes, color }` `course=共通` は全コースで表示 |
| `submissions` | `{ version, course, subject, notes, color }` |
| `suggestions` | `{ type, version, course, subject, date, period, scope, notes, status, authorUid, createdAt }` |
| `users/{uid}` | `{ email, displayName, isAdmin, createdAt }` Auth作成時に自動生成 |

---

## 🚀 はじめ方（ローカル）

```bash
npm install
cp .env.example .env
# .env を Firebaseコンソール > プロジェクト設定 > SDK の値で埋める
npm run dev      # http://localhost:5173
```

> `.env` が未設定でも **デモモード** で動作します。
> モックデータ表示・ログインスキップ・簡易コーチ利用可。まずは見た目とAIコーチを確認できます。

### コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（`dist/`） |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run seed` | Firestoreへ初期データ投入 |
| `npm run worker:dev` | Cloudflare Workerのローカル開発 |
| `npm run worker:deploy` | Cloudflare Workerのデプロイ |

---

## 🔧 Firebase セットアップ（本番）

### 1. プロジェクト作成

1. https://console.firebase.google.com → 新規プロジェクト作成
2. 「Authentication」→ 有効化 → メール/パスワードをオン
3. 「Firestore Database」→ 作成（ロケーション: `asia-northeast1` 推奨）
4. プロジェクト設定 → 全般 → SDK の構成を `.env` にコピペ

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_AI_MODE=local
# Cloudflare Workers AI を使う場合だけ
# VITE_CLOUDFLARE_AI_URL=https://exam-coach-ai.your-subdomain.workers.dev
```

`.firebaserc` の `your_project_id` も置換してください。

### 2. Firestore ルール / インデックスをデプロイ

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore
```

### 3. 初期データ投入

```bash
node scripts/seed.js
# → config, versions, schedules, submissions が作成される
```

### 4. 管理者付与

1. サイトで一度「新規登録」→ ログイン
2. Firebaseコンソール → Firestore → `users/{あなたのUID}` → `isAdmin: true` に変更
3. 再読み込みで `admin.html` が開けるようになります

### 5. Hosting へデプロイ

```bash
npm run build
firebase deploy --only hosting
# または手動: dist/ を任意のホスティングへ
```

---

## ☁️ Cloudflare Workers AI を有効にする（任意）

通常は不要です。スマホを含む全端末で自由質問を使いたい場合に設定します。
Cloudflareアカウント（無料）が必要です。無料枠を超えにくくするため、**1人20回/日・全体400回/日** に制限しています。

### 1. Workerの依存関係をインストール

Workerのデプロイには **Node.js 22以上** が必要です。

```bash
cd workers/coach-ai
npm install
```

### 2. Cloudflareにログイン

```bash
npx wrangler login
```

### 3. KV名前空間を作成（推奨）

```bash
npx wrangler kv namespace create COACH_KV
```

表示された `id` を `workers/coach-ai/wrangler.toml` の `[[kv_namespaces]]` に貼り、コメントを外します。

> KV未設定でも動作しますが、回数制限はWorkerインスタンス内のメモリ保持になり、再起動でリセットされます。本番ではKV設定を推奨します。

### 4. Workerをデプロイ

```bash
npm run deploy
```

表示された `https://exam-coach-ai.<your-subdomain>.workers.dev` を控えます。

### 5. フロントの環境変数を切り替え

```env
VITE_AI_MODE=cloudflare
VITE_CLOUDFLARE_AI_URL=https://exam-coach-ai.<your-subdomain>.workers.dev
```

再ビルドしてホスティングへデプロイします。

```bash
npm run build
firebase deploy --only hosting
# または Render などへ dist/ をデプロイ
```

### 6. 動作確認

- `https://exam-coach-ai.<your-subdomain>.workers.dev/health` を開き、`{"ok":true,...}` が返ることを確認
- コーチで「数学の勉強法」「やる気が出ない」などを送信
- 画面下が「クラウドAI（Cloudflare）モード」になっていればOK
- 失敗時は自動で「簡易コーチ」にフォールバックします
- Workerのログは `npx wrangler tail` で確認できます

### 7. 無料枠と制限

- 無料枠: **10,000 Neurons / 日**（日本時間 9:00 リセット）
- 既定モデル `@cf/meta/llama-3.1-8b-instruct-fp8` で、短い質問（入力800＋出力300トークン程度）なら **約500回/日** が目安
- この実装は **1人20回/日・全体400回/日** で止まる
- 30〜40人配布・15〜20人が1日10回使う規模（150〜200回/日）なら、通常利用では無料枠に収まる
- 長文や履歴が多いと1回あたりのNeuronsが増え、全体400回より先に無料枠へ達することがあります
- 上限到達時は簡易コーチへフォールバックするため、サイト自体は止まりません

### 8. モデルを変える場合

`workers/coach-ai/wrangler.toml` の `AI_MODEL` を変更します。

- 日本語品質を優先: `@cf/qwen/qwen3-30b-a3b-fp8` / `@cf/google/gemma-4-26b-a4b-it`
- 軽さと速度重視: `@cf/meta/llama-3.1-8b-instruct-fp8`（既定）
- 一部の上位モデルは有料プランが必要です
- Qwen3は思考過程を含むことがあるため、応答が空になる場合はLlamaに戻してください
- モデルによって1回あたりのNeuronsが変わるため、無料枠の残量はCloudflareダッシュボードで確認してください

> Cloudflare Workers AI の無料枠は **アカウント全体で1日10,000 Neurons** です。ユーザーごとの枠ではありません。
>
> 回数制限は端末IDベースの簡易的なものです。本格的な不正利用対策が必要な場合は、Firebase ID token の検証などを追加してください。

---

## ☁️ Gemini Functions を有効にする（任意・従来）

通常は不要です。Geminiの無料枠を使いたい場合だけ設定してください。

### 1. Functions をデプロイ

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

> Firebase Functions（v2）は Blaze プラン（従量課金）の設定が必要な場合があります。
> 無料枠内でも課金設定が必要になることがあるため、**公開サイトのデフォルトにはしない** ことをおすすめします。

### 2. Gemini APIキーをSecretに設定

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

### 3. フロントのAIモードを切り替え

```env
VITE_AI_MODE=cloud
```

再ビルドしてデプロイします。

```bash
npm run build
firebase deploy --only hosting
```

### 4. フォールバック

- Functions未デプロイ / `GEMINI_API_KEY` 未設定 / 429 / 通信エラー
- → 自動で簡易コーチの回答に切り替わります
- 画面下のモード表示で「クラウドAI（Gemini）」か「簡易コーチ」かを確認できます

---

## 🚢 デプロイ（Render / Firebase Hosting）

### Render（静的サイト）

`render.yaml` を使う場合:

- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- 環境変数（Render Dashboard → Environment）:
  - `VITE_FIREBASE_*`
  - `VITE_AI_MODE=local`（推奨）または `cloudflare`
  - `cloudflare` の場合: `VITE_CLOUDFLARE_AI_URL=https://exam-coach-ai.<your-subdomain>.workers.dev`

### Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

`firebase.json` の `hosting.public` は `dist` です。

### Cloudflare Worker

```bash
cd workers/coach-ai
npm install
npm run deploy
```

Workerはフロントとは別にデプロイします。フロントの `VITE_CLOUDFLARE_AI_URL` をWorkerのURLに合わせてください。

---

## 🧠 簡易コーチのできること

| 話しかけ方 | 返答 |
|---|---|
| 今日の計画を立てたい | テストまでの日数から25分×2〜3セットを提案 |
| 来週まで歴史を1日1時間で終わらせたい | 教科と時間予算を尊重して優先順位を提案 |
| 未完了の提出物を確認したい | 未完了の提出物とテスト日を一覧 |
| 今日の進捗は？ | 提出物の完了率、今日/7日の学習時間、連続日数 |
| テスト範囲を確認したい | 次のテスト日程と範囲の要約 |
| 数学の勉強法を教えて | 教科別の具体的な進め方 |
| 数学の二次関数が分からない | 答えを書かず、3段階のヒント |
| やる気が出ない | 5分だけ始める作戦とタイマー誘導 |

簡易コーチは **範囲表・提出物・タイマー記録の範囲内** で答えます。
それ以外の自由な質問は、端末AI（対応ブラウザ）、Cloudflare Workers AI（任意）、Gemini Functions（任意）で補完します。

---

## 🔐 プライバシー

- 簡易コーチ: 入力はブラウザ内だけで処理。外部送信なし
- 端末AI: Chrome内蔵モデルで処理。入力は端末内だけで処理される（Chromeの仕様）
- Cloudflare Workers AI（任意）: 質問文と、コース名・範囲・提出物の進捗・学習時間などの学習状況を送信。氏名・メール・UID・メモは送信しない
- Gemini Functions（任意）: 質問文と、コース名・範囲件数・提出物の進捗・学習時間を送信。氏名・メール・UID・メモは送信しない
- 個人情報（氏名・学籍番号・住所・電話）は入力しないでください
- Cloudflare AIの利用回数制限のため、ランダムな端末IDを `localStorage` に保存します（個人情報ではありません）

---

## 🧪 動作確認・トラブルシューティング

### `npm run build` が通るか

```bash
npm run build
```

### 端末AIのボタンが出ない

- Chrome 148以降の **デスクトップ** か確認
- Windows 10/11、macOS 13+、Linux、ChromeOS Plus のいずれか
- 空きストレージ22GB以上、GPU 4GB VRAM以上 または 16GB RAM以上
- スマホ・Safari・Firefoxは対象外です（Cloudflare有効時はクラウドAI、未設定時は簡易コーチが動きます）
- `chrome://on-device-internals` でモデル状態を確認

### 端末AIの初回ダウンロードが始まらない

- ボタンクリック（ユーザー操作）が必要です
- ダウンロード中は画面下に進捗が出ます
- 失敗したら「端末AIを再試行」を押してください

### Cloudflare AIが動かない

- `.env` の `VITE_AI_MODE=cloudflare` と `VITE_CLOUDFLARE_AI_URL` を確認
- URLはWorkerのベースURL（末尾 `/coach` なしでも可）
- Workerのデプロイ状況とログを確認: `cd workers/coach-ai && npx wrangler tail`
- `wrangler.toml` の `[ai] binding = "AI"` があるか確認
- 1人20回/日・全体400回/日の上限に達していないか確認
- 失敗時は自動で簡易コーチに切り替わります

### クラウドAIが「混雑中」（Gemini Functions）

- Gemini無料枠の上限です。簡易コーチに自動フォールバックします
- 大人数で使う場合は `VITE_AI_MODE=local` または `cloudflare` に戻してください

### データが表示されない

- `.env` の `VITE_FIREBASE_*` を確認
- Firestoreのルール / インデックスをデプロイしたか確認
- ブラウザのコンソールに `[firebase]` エラーが出ていないか確認

---

## 📝 メモ

- ライトがデフォルト。右上の月/太陽ボタン、またはメニューからダークに切替
- 提出物チェック・タイマー履歴・AI履歴は `localStorage`
  - `exam_sub_progress_*`
  - `exam_timer_*`
  - `exam_coach_history`
  - `exam_coach_ondevice`（端末AIのON/OFF）
  - `exam_coach_client_id`（Cloudflare AIの回数制限用ランダムID）
- 学習計画は `exam_plan_*` に保存
- `.ics` エクスポートは旧サイトと互換
- 旧GASデータの移行は `scripts/seed.js` の配列差し替え、または管理画面から再作成

---

## 📄 ライセンス

ISC — 自由に改変・再配布可
