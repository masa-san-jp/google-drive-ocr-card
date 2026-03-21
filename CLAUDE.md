# CLAUDE.md

## Critical: API Key / ID 管理

`CONFIG` オブジェクトには**必ずプレースホルダー文字列**を置く。実際の値はユーザーが手動で設定する。

```
// GOOD: コミット可
GEMINI_API_KEY: "ここに取得したGemini APIキーを貼り付け"

// BAD: 絶対コミット禁止
GEMINI_API_KEY: "AIzaSyXXXXXXXXXXXXXXXXXXXX"
```

コミット前に必ず `git diff` で実キーが含まれていないか確認する。

## Critical: 個人情報

名刺データは個人情報に該当する。テストデータ・ログ・ドキュメントに実名・実メールアドレス・実電話番号を含めない。

## 参照先

- プロジェクト概要・技術スタック → `README.md`
- セットアップ手順 → `docs/setup_guide.md`
- 設計仕様 → `docs/` 配下の各仕様書