# Google Drive OCR Card

名刺写真をGoogleドライブにアップロードするだけで、Gemini APIでOCR処理し、スプレッドシートに自動登録するGoogle Apps Scriptシステム。

## Stack

| 層 | 技術 |
|---|---|
| Runtime | Google Apps Script (V8) |
| AI/OCR | Gemini API `gemini-1.5-flash` |
| Storage | Google Drive + Google Sheets |

## Structure

```
src/    # GAS実装 → src/CLAUDE.md 参照
docs/   # 設計仕様書・セットアップガイド（日本語）
```

## Critical: API Key / ID 管理

`CONFIG` オブジェクトには**必ずプレースホルダー文字列**を置く。実際の値はユーザーが手動で設定する。

```javascript
// GOOD: コミット可
GEMINI_API_KEY: "ここに取得したGemini APIキーを貼り付け"

// BAD: 絶対コミット禁止
GEMINI_API_KEY: "AIzaSyXXXXXXXXXXXXXXXXXXXX"
```

コミット前に必ず `git diff` で実キーが含まれていないか確認する。
