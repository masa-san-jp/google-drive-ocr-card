# Google Drive OCR Card

名刺写真を Google ドライブにアップロードするだけで、Gemini API で OCR 処理し、スプレッドシートに自動登録する Google Apps Script システムです。

> [English version is available below](#english)

## 概要

スマートフォンの Google Drive アプリで名刺を撮影してフォルダにアップロードすると、定期実行される GAS スクリプトが Gemini API（`gemini-2.5-flash-lite`）を使って名刺情報を自動抽出し、Google スプレッドシートに登録します。

```
📱 名刺を撮影して Google Drive にアップロード
        ↓
📂 「01_名刺スキャン用」フォルダに画像が保存される
        ↓
🤖 Google Apps Script が定期的に自動実行（Gemini API で OCR）
        ↓
📋 スプレッドシートに会社名・氏名・連絡先などが自動登録
        ↓
📁 画像ファイルが「02_処理済み名刺」フォルダに移動
```

## 技術スタック

| 層 | 技術 |
|---|---|
| Runtime | Google Apps Script (V8) |
| AI / OCR | Gemini API `gemini-2.5-flash-lite` |
| Storage | Google Drive + Google Sheets |

## 主な機能

- **自動 OCR**：Gemini API が名刺画像から会社名・氏名・電話番号・メールアドレス・住所を抽出
- **スプレッドシート自動登録**：処理結果を指定のシートに1行追記
- **ファイル自動整理**：処理後のファイルを `[処理済] 会社名_氏名.拡張子` にリネームして処理済みフォルダへ移動
- **定期自動実行**：GAS のタイムトリガーで設定した間隔（例：10 分おき）に自動処理
- **HEIC/HEIF 対応**：iPhone で撮影した HEIC/HEIF 形式の画像も処理可能
- **PDF 対応**：複数名刺を含む PDF から一括抽出

## スプレッドシートの列構成

| 列 | フィールド | 説明 |
|---|---|---|
| A | 処理日時 | GAS が処理した日時 |
| B | 会社名 | OCR 抽出値 |
| C | 部署・役職 | OCR 抽出値 |
| D | 氏名 | OCR 抽出値 |
| E | メールアドレス | OCR 抽出値 |
| F | 電話番号 | OCR 抽出値 |
| G | 住所 | OCR 抽出値 |
| H | 画像 URL | Drive ファイルの URL |
| I | ファイル ID | Drive ファイルの一意 ID |
| J | 元ファイル名 | 処理前のオリジナルファイル名 |
| K | ソースアカウント | ファイルに関連付けられた Google アカウント（※制約あり） |
| L | カード番号 | 1 ファイル内での名刺の連番（1 始まり） |

> **ソースアカウントの制約**: マイドライブの場合はファイルオーナーのメールアドレスを取得します。共有ドライブの場合はファイルを共有したユーザーのアドレスを取得しますが、実際のアップロード者と一致しない場合があります。取得できない場合は「取得不可」と表示されます。

## ディレクトリ構成

```
google-drive-ocr-card/
├── src/
│   └── Code.gs          # GAS スクリプト本体
└── docs/
    ├── setup_guide.md                                    # セットアップ手順（初心者向け）
    ├── 名刺OCR自動化システム_設計仕様書.md               # システム設計仕様書
    ├── 名刺OCR自動化システム_実装プラン.md               # 実装プラン
    ├── 名刺OCR自動化システム_セキュリティ・テスト設計書.md # セキュリティ・テスト設計書
    ├── code_review.md                                    # コードレビュー（2026-03-05）
    └── review.md                                         # リポジトリレビュー（2026-03-22）
```

## セットアップ

詳細な手順は [`docs/setup_guide.md`](docs/setup_guide.md) を参照してください。

### 大まかな手順

1. **Google Drive にフォルダを作成する**
   - `01_名刺スキャン用`（画像のアップロード先）
   - `02_処理済み名刺`（処理後のファイル移動先）

2. **Google スプレッドシートを作成する**

3. **Gemini API キーを取得する**
   - [Google AI Studio](https://aistudio.google.com/) で発行する

4. **GAS スクリプトを設定する**
   - スプレッドシートのメニュー「拡張機能 > Apps Script」を開く
   - `src/Code.gs` の内容を貼り付ける
   - `CONFIG` 内の各 ID を自分の環境の値に書き換える

5. **スクリプトプロパティに API キーを登録する**
   - GAS の「プロジェクトの設定 > スクリプトプロパティ」に `GEMINI_API_KEY` を追加する

6. **時間トリガーを設定して自動実行を有効にする**

## セキュリティに関する注意

- `GEMINI_API_KEY` は GAS のスクリプトプロパティに登録し、コード内に直接記述しないでください。
- `CONFIG` オブジェクトに書くのはフォルダ ID・スプレッドシート ID のみです。
- 名刺情報（個人情報）を扱うため、スプレッドシートや各フォルダのアクセス権限は特定のユーザーのみに限定してください。

## レビュー対応状況

`docs/code_review.md`（2026-03-05）および `docs/review.md`（2026-03-22）のレビュー指摘に対する改善状況です。

| 状態 | カテゴリ | 指摘内容 |
|---|---|---|
| ✅ 対応済み | セキュリティ | API キーを `PropertiesService` で管理し、コードに直書きしない |
| ✅ 対応済み | モデル更新 | `gemini-1.5-flash` → `gemini-2.5-flash-lite` に更新 |
| ✅ 対応済み | JSON 強制 | `responseMimeType: "application/json"` でレスポンスを JSON に強制 |
| ✅ 対応済み | エラー継続 | ループ内 try-catch で1件の失敗が全体を止めない設計 |
| 🔄 部分対応 | HEIC/HEIF | `image/heif` も処理対象に追加済み（ただし MIME タイプ変換のみ、バイナリ変換は未実装） |
| ❌ 未対応 | エラー処理 | エラーファイルが入力フォルダに残り続ける無限再処理問題 |
| ✅ 対応済み | タイムアウト | 実行時間上限（5 分ガード）の安全装置を実装済み |
| ✅ 対応済み | 処理件数上限 | `MAX_FILES_PER_RUN`（デフォルト 10 件）による上限制御を実装済み |
| ❌ 未対応 | 設計書整合 | 設計仕様書（7 モジュール・4 フォルダ構成）と実装（3 関数・2 フォルダ）の乖離 |
| ✅ 対応済み | テスト | Jest によるユニットテストを追加（タイムアウト・処理件数上限・sanitizeFileName 等） |
| ❌ 未対応 | パフォーマンス | `appendRow` 逐次実行（一括書き込みへの移行が必要） |
| ❌ 未対応 | 抽出失敗記録 | OCR 抽出失敗時のスプレッドシート記録とエラーフォルダへの退避が未実装 |
| ❌ 未対応 | 関数分割 | `processBusinessCards` の責務過多（100 行超の単一関数） |

## 将来展望

本プロジェクトのアーキテクチャ（Google Drive → GAS → Gemini API → Google Sheets）をベースに、**経費精算における証憑書類（レシート・領収書など）の OCR 自動化**への展開を検討しています。

撮影した領収書を Google Drive にアップロードするだけで、金額・日付・店舗名などを自動抽出してスプレッドシートに記録し、立替経費精算の入力作業を削減することを目指します。

- 関連リポジトリ（開発中）：[masa-san-jp/receipt-OCR-to-sheets](https://github.com/masa-san-jp/receipt-OCR-to-sheets)

---

<a id="english"></a>

# Google Drive OCR Card (English)

A Google Apps Script system that automatically extracts business card information via the Gemini API when photos are uploaded to Google Drive, and registers them in a Google Spreadsheet.

## Overview

Take a photo of a business card with your smartphone, upload it to a Google Drive folder, and a scheduled GAS script automatically extracts the contact information using the Gemini API (`gemini-2.5-flash-lite`) and appends it to a Google Spreadsheet.

```
📱 Take a photo of a business card and upload to Google Drive
        ↓
📂 Image is saved in the "01_名刺スキャン用" (scan) folder
        ↓
🤖 Google Apps Script runs on a schedule (OCR via Gemini API)
        ↓
📋 Company name, full name, contact info, etc. are added to the spreadsheet
        ↓
📁 Image file is moved to the "02_処理済み名刺" (processed) folder
```

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Google Apps Script (V8) |
| AI / OCR | Gemini API `gemini-2.5-flash-lite` |
| Storage | Google Drive + Google Sheets |

## Features

- **Automatic OCR**: Gemini API extracts company name, full name, phone number, email address, and postal address from business card images
- **Automatic spreadsheet registration**: Appends one row per business card to the designated sheet
- **Automatic file organization**: Renames processed files to `[処理済] CompanyName_PersonName.ext` and moves them to the processed folder
- **Scheduled execution**: Runs automatically at a set interval (e.g. every 10 minutes) via GAS time triggers
- **HEIC/HEIF support**: Processes images taken with iPhone in HEIC/HEIF format
- **PDF support**: Bulk extraction from PDFs containing multiple business cards

## Spreadsheet Column Layout

| Column | Field | Description |
|---|---|---|
| A | Processed date/time | Timestamp when GAS processed the file |
| B | Company name | OCR-extracted value |
| C | Department / Title | OCR-extracted value |
| D | Full name | OCR-extracted value |
| E | Email address | OCR-extracted value |
| F | Phone number | OCR-extracted value |
| G | Address | OCR-extracted value |
| H | Image URL | Drive file URL |
| I | File ID | Unique Drive file ID |
| J | Original filename | Filename before processing |
| K | Source account | Google account linked to the file (see note below) |
| L | Card number | Sequential card number within the file (1-based) |

> **Source account note**: For files in My Drive, this is the file owner's email address. For shared drives, it is the email of the user who shared the file, which may not be the actual uploader. Displays "取得不可" (unavailable) when the account cannot be retrieved.

## Directory Structure

```
google-drive-ocr-card/
├── src/
│   └── Code.gs          # Main GAS script
└── docs/
    ├── setup_guide.md                                    # Setup guide (beginner-friendly)
    ├── 名刺OCR自動化システム_設計仕様書.md               # System design specification
    ├── 名刺OCR自動化システム_実装プラン.md               # Implementation plan
    ├── 名刺OCR自動化システム_セキュリティ・テスト設計書.md # Security & test design
    ├── code_review.md                                    # Code review (2026-03-05)
    └── review.md                                         # Repository review (2026-03-22)
```

## Setup

See [`docs/setup_guide.md`](docs/setup_guide.md) for detailed instructions.

### Quick Steps

1. **Create folders in Google Drive**
   - `01_名刺スキャン用` — upload destination for card images
   - `02_処理済み名刺` — destination for processed files

2. **Create a Google Spreadsheet**

3. **Get a Gemini API key**
   - Generate one at [Google AI Studio](https://aistudio.google.com/)

4. **Set up the GAS script**
   - Open your spreadsheet and go to Extensions > Apps Script
   - Paste the contents of `src/Code.gs`
   - Replace the placeholder values in `CONFIG` with your own IDs

5. **Register the API key as a Script Property**
   - In GAS project settings, add `GEMINI_API_KEY` under Script Properties

6. **Set a time-based trigger to enable automatic execution**

## Security Notes

- Store `GEMINI_API_KEY` in GAS Script Properties — never hard-code it in the script.
- The `CONFIG` object should only contain folder IDs and spreadsheet IDs.
- Business card data is personal information — restrict access to your spreadsheet and Drive folders to specific authorized users only.

## Review & Improvement Status

Two code reviews have been conducted (see `docs/code_review.md` and `docs/review.md`). The table below summarizes the current improvement status.

| Status | Category | Issue |
|---|---|---|
| ✅ Done | Security | API key managed via `PropertiesService` — not hard-coded |
| ✅ Done | Model update | Upgraded from `gemini-1.5-flash` to `gemini-2.5-flash-lite` |
| ✅ Done | JSON enforcement | `responseMimeType: "application/json"` enforces JSON output |
| ✅ Done | Error resilience | Per-file try-catch prevents one failure from stopping the whole batch |
| 🔄 Partial | HEIC/HEIF | `image/heif` added as a supported type; MIME label is changed to JPEG but no actual binary conversion |
| ❌ Pending | Error handling | Failed files remain in the input folder and are retried indefinitely |
| ✅ Done | Timeout guard | 5-minute safety cut-off before GAS's 6-minute execution limit |
| ✅ Done | File count limit | `MAX_FILES_PER_RUN` cap (default: 10 files) implemented |
| ❌ Pending | Design alignment | Gap between spec (7 modules, 4 folders) and implementation (3 functions, 2 folders) |
| ✅ Done | Tests | Jest unit tests added (timeout guard, file count limit, sanitizeFileName, etc.) |
| ❌ Pending | Performance | `appendRow` called per card — should be batched with `setValues` |
| ❌ Pending | Failure logging | OCR failures not recorded in the spreadsheet; failed files not moved to an error folder |
| ❌ Pending | Refactoring | `processBusinessCards` has 9+ responsibilities in a single 100-line function |

## Future Plans

Building on the architecture of this project (Google Drive → GAS → Gemini API → Google Sheets), we are planning to expand into **automated OCR for accounting receipts and expense documents** (receipts, invoices, etc.).

The goal is to let users upload a photo of a receipt to Google Drive and have the system automatically extract the amount, date, vendor name, and other fields into a spreadsheet — reducing the manual data entry burden for expense reimbursement workflows.

- Related repository (in development): [masa-san-jp/receipt-OCR-to-sheets](https://github.com/masa-san-jp/receipt-OCR-to-sheets)

## License

This project is licensed under the [MIT License](LICENSE).

```
MIT License

Copyright (c) 2026 masa-san-jp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
