# テスト範囲表 — Firebase Edition (Dark Cool)

高校の定期テスト範囲表を、旧GAS + Google Sheets構成から **Firebase** に移行し、**ダーククール / ガラスモーフィズム / グラデーション** で全面リデザインした版です。
旧サイト https://test-coverage-szdm.onrender.com の機能はすべて維持しています。

---

## ✨ 特長

- **Firebase移行**: GAS → Firestore + Firebase Auth。APIキー不要でリアルタイム、権限制御も堅牢に。
- **ダーククールデザイン**: `#070A14` を基調に cyan→violet グラデ、ガラスカード、メッシュ背景。旧来の白×薄い青から脱却。
- **機能完全継承**:
  - コース別フィルタ（K/文系, K/理系物理/生物, SS/理系物理/生物）
  - テスト範囲表（教科/日程/時限/範囲/備考、日付グルーピング）
  - 提出物チェック＆進捗バー（localStorage + 将来Firestore同期）
  - カウントダウン（直近テストまであと何日）
  - 勉強タイマー（ポモドーロ、教科別、リング進捗、日次集計）
  - .ics カレンダーエクスポート
  - 変更提案（Firestore `suggestions`）
  - 管理者画面（バージョン管理 / スケジュール・提出物エディタ / 提案承認）— **管理者のみ**
  - Firebase Auth（登録/ログイン/パスワードリセット/自動ログイン）

---

## 🏗 技術スタック

- Vite + Vanilla JS + Tailwind CSS 3
- Firebase SDK v12 (Auth, Firestore)
- Firestore Rules で権限制御（`users/{uid}.isAdmin == true` のみ管理操作）

---

## 📁 構成

```
├── index.html          # トップ（範囲表）
├── suggest.html        # 提案フォーム
├── admin.html          # 管理者コンソール
├── src/
│   ├── main.js         # トップのロジック
│   ├── suggest.js
│   ├── admin.js
│   ├── firebase.js     # Firebase初期化（.envから）
│   ├── firestore.js    # 読み取りヘルパ + デモフォールバック
│   ├── auth.js         # Auth共通
│   ├── constants.js    # コース/科目定義
│   ├── utils.js
│   └── style.css       # Tailwind + カスタムglass
├── public/
│   ├── manifest.json
│   └── images/icon/
├── firestore.rules
├── firestore.indexes.json
├── firebase.json / .firebaserc
├── scripts/seed.js     # 初期データ投入
└── .env.example
```

### Firestore コレクション

| コレクション | 説明 |
|---|---|
| `config/main` | `{ version, versionLabel, updatedAt }` 現在の定期テスト |
| `versions/{name}` | バージョン一覧（id=バージョン名） |
| `schedules` | 各行 `{ version, course, subject, date, period, scope, notes, color }` `course=共通` は全コースで表示 |
| `submissions` | `{ version, course, subject, notes, color }` |
| `suggestions` | `{ type: 'test_scope'\|'submission', version, course, subject, date, period, scope, notes, status:'承認待ち'|'承認済み'|'却下', authorUid, createdAt }` |
| `users/{uid}` | `{ email, displayName, isAdmin, createdAt }` Auth作成時に自動生成 |

---

## 🚀 はじめ方（ローカル）

```bash
npm install
cp .env.example .env
# .env を Firebaseコンソール > プロジェクト設定 > SDK の値で埋める
npm run dev      # http://localhost:5173
```

> `.env` 未設定でも **デモモード** で動作します（Firestoreの代わりにモックデータを表示、ログインはスキップ）。まずは見た目を確認できます。

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
...
```

`.firebaserc` の `your_project_id` も置換。

### 2. Firestore ルール / インデックスをデプロイ

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore
```

### 3. 初期データ投入

```bash
node scripts/seed.js
# → config, versions, schedules 13件, submissions 7件 が作成される
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

## 🔄 旧GASデータの移行

旧スプレッドシート `config / schedule / submissions` をCSVエクスポートし、

- `scripts/seed.js` の配列を差し替える、または
- Firebaseコンソールから手動インポート、または
- 管理画面 `admin.html` から「読み込む→追加→保存」で再作成

が可能です。`schedule` の `course=共通` は全コース共通教科に使ってください。

---

## 🎨 デザイン差分（旧→新）

| 旧 | 新 |
|---|---|
| 白基調 + 薄い影 + 青プライマリ | ダークネイビー基調 + キャンバスメッシュ + cyan→violetグラデ |
| ハンバーガー内ドロップダウン（小） | 右上ガラスパネル（300px, 丸み24px, セクション分け） |
| テーブルは枠線のみ | ガラスカード + グルーピング見出し（グラデ）+ カラーdotにglow |
| 進捗バーは灰色トラック | ガラストラック + グラデfill + 発光 |
| モーダルは白カード | 濃いガラス + ぼかし + アニメーション（scale+slide） |
| タイマーは旧リング | 180pxリング、グラデstroke、ダーク背景馴染み |

---

## 🛡 権限

- 読み取り: `schedules/submissions/versions/config/suggestions` は全員可
- 書き込み: `schedules/submissions/versions/config` は `isAdmin==true` のみ
- `suggestions` 作成はログイン必須、承認/却下は管理者のみ
- `users` は本人のみ読み書き（管理者は全員閲覧可）

初回管理者は手動でFirestoreで付与してください。2人目以降は管理画面で付与する拡張も可能です。

---

## 📝 メモ

- ダーク固定テーマです。旧来の「ダークモード切替」はトースト表示のみ（要望があればライトテーマも追加可能）。
- 提出物チェック・タイマー履歴は `localStorage` に保存（キー: `exam_sub_progress_*`, `exam_timer_*`）。ログイン時は将来Firestore同期に拡張できます。
- `.ics` エクスポートは新サイトでも完全互換。

---

## 📄 ライセンス

ISC — 自由に改変・再配布可
