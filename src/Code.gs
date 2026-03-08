/**
 * =========================================================
 * 名刺OCR自動化システム (Google Apps Script)
 * =========================================================
 * 下記の「CONFIG」内の値を、ご自身の環境に合わせて変更してください。
 */

const CONFIG = {
  // 1. 各種IDの設定（4フォルダ構成）
  FOLDER_ID_INPUT: "ここに01_未処理フォルダのIDを貼り付け",
  FOLDER_ID_OCR_IN_PROGRESS: "ここに02_OCR中フォルダのIDを貼り付け",
  FOLDER_ID_PROCESSED: "ここに03_処理済みフォルダのIDを貼り付け",
  FOLDER_ID_REVIEW: "ここに04_要確認フォルダのIDを貼り付け",
  SPREADSHEET_ID: "ここにスプレッドシートのIDを貼り付け",
  SHEET_NAME: "シート1" // スプレッドシートのタブ名（デフォルトは「シート1」）

  // 2. Gemini APIの設定はGASの「スクリプトプロパティ」から読み込みます
  // (ここに直書きしないでください: セキュリティ対策)
};

/**
 * 処理のメイン関数：これを定期実行（トリガー）に設定します。
 */
function processBusinessCards() {
  // タイムアウト安全装置: 実行開始時刻を記録
  const startTime = new Date().getTime();
  const TIMEOUT_MS = 4.5 * 60 * 1000; // 4分30秒（GASの6分制限から1分30秒のバッファ）

  // APIキーを事前取得（ループ外で1回のみ）
  const properties = PropertiesService.getScriptProperties();
  const apiKey = properties.getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    console.error("APIキーが設定されていません。GASのプロジェクト設定から「スクリプトプロパティ」に GEMINI_API_KEY を登録してください。");
    return;
  }

  // 4つのフォルダを取得
  const inputFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID_INPUT);
  const ocrInProgressFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID_OCR_IN_PROGRESS);
  const processedFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID_PROCESSED);
  const reviewFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID_REVIEW);

  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  const logSheet = spreadsheet.getSheetByName("操作ログ");

  if (!sheet) {
    console.error("指定されたシート名が見つかりません。");
    return;
  }

  // スプレッドシートが空の場合、1行目にヘッダーを作成する
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "登録年月日", "氏名", "会社名", "部署・役職",
      "電話番号", "メールアドレス", "住所", "Webサイト",
      "OCRステータス", "画像リンク", "備考", "OCR生テキスト"
    ]);
    sheet.setFrozenRows(1);          // 1行目を固定
    sheet.setColumnWidth(1, 150);    // 登録年月日幅
    sheet.setColumnWidth(2, 120);    // 氏名幅
    sheet.setColumnWidth(3, 200);    // 会社名幅
    sheet.setColumnWidth(4, 150);    // 部署・役職幅
    sheet.setColumnWidth(5, 130);    // 電話番号幅
    sheet.setColumnWidth(6, 200);    // メールアドレス幅
    sheet.setColumnWidth(7, 250);    // 住所幅
    sheet.setColumnWidth(8, 200);    // Webサイト幅
    sheet.setColumnWidth(9, 100);    // OCRステータス幅
    sheet.setColumnWidth(10, 300);   // 画像リンク幅
    sheet.setColumnWidth(11, 150);   // 備考幅
    sheet.setColumnWidth(12, 400);   // OCR生テキスト幅
  }

  // 01_未処理フォルダ内のすべてのファイルを取得
  const files = inputFolder.getFiles();
  let processedCount = 0;

  while (files.hasNext()) {
    // タイムアウトチェック: 4分30秒経過したらループを中断
    const elapsedMs = new Date().getTime() - startTime;
    if (elapsedMs > TIMEOUT_MS) {
      const elapsedSec = Math.round(elapsedMs / 1000);
      const timeoutMsg = `タイムアウト安全装置発動: 実行時間${elapsedSec}秒経過。残りのファイルは次回トリガーで処理します。`;
      console.log(timeoutMsg);
      writeLog(logSheet, timeoutMsg, "TIMEOUT", processedCount);
      break;
    }

    const file = files.next();
    const mimeType = file.getMimeType();

    // 画像ファイルのみを処理対象とする
    if (mimeType.includes('image/')) {
      try {
        console.log(`処理開始: ${file.getName()}`);

        // 重複処理防止: 既に02_OCR中にある場合はスキップ（前回実行の中断ファイル）
        const parents = file.getParents();
        if (parents.hasNext()) {
          const currentParentId = parents.next().getId();
          if (currentParentId === CONFIG.FOLDER_ID_OCR_IN_PROGRESS) {
            console.log(`既に02_OCR中フォルダにあります。スキップ: ${file.getName()}`);
            continue;
          }
        }

        // ステップ1: 02_OCR中フォルダに移動（ロック機構・重複処理防止）
        file.moveTo(ocrInProgressFolder);

        // 画像データをBase64形式に変換（APIに送信用）
        const blob = file.getBlob();
        const base64Image = Utilities.base64Encode(blob.getBytes());
        // HEIC等の特殊フォーマットはJPEGとして扱わせる
        const apiMimeType = (mimeType === 'image/heic') ? 'image/jpeg' : mimeType;

        // Gemini APIを呼び出し、名刺の情報をJSON形式で抽出
        const extractedData = extractWithGemini(base64Image, apiMimeType, apiKey);

        if (extractedData) {
          // スプレッドシートに抽出データを1行追記（12列スキーマ）
          sheet.appendRow([
            new Date(),                            // A: 登録年月日
            extractedData.name || "",              // B: 氏名
            extractedData.company || "",           // C: 会社名
            extractedData.department_title || "",  // D: 部署・役職
            extractedData.phone || "",             // E: 電話番号
            extractedData.email || "",             // F: メールアドレス
            extractedData.address || "",           // G: 住所
            extractedData.website || "",           // H: Webサイト
            "処理済み",                             // I: OCRステータス
            file.getUrl(),                         // J: 画像リンク
            "",                                    // K: 備考（初期値は空）
            extractedData.raw_text || ""           // L: OCR生テキスト
          ]);

          // ファイル名の変更処理
          const safeCompany = extractedData.company || "不明";
          const safeName = extractedData.name || "不明";
          const extMatch = file.getName().match(/(\.[^.]+)$/);
          const ext = extMatch ? extMatch[1] : ""; // オリジナルの拡張子

          const newName = `[処理済] ${safeCompany}_${safeName}${ext}`;
          file.setName(newName);

          // ステップ2: 03_処理済みフォルダに移動
          file.moveTo(processedFolder);

          console.log(`処理完了: ${newName}`);
          processedCount++;
        }
      } catch (e) {
        const errorMsg = `エラー発生ファイル: ${file.getName()}`;
        console.error(`${errorMsg}, エラー詳細: ${e.message}`);
        writeLog(logSheet, errorMsg, "ERROR", processedCount, e.message);

        // ステップ3: エラー時は04_要確認フォルダへ退避（無限リトライ防止）
        try {
          file.moveTo(reviewFolder);
          console.log(`要確認フォルダへ移動完了: ${file.getName()}`);
        } catch (moveError) {
          console.error(`ファイル移動にも失敗: ${file.getName()}, ${moveError.message}`);
          writeLog(logSheet, `ファイル移動失敗: ${file.getName()}`, "ERROR", processedCount, moveError.message);
        }
      }
    } else {
      console.log(`画像ではないファイルのためスキップしました: ${file.getName()}`);
    }
  }

  const successMsg = `計 ${processedCount} 件の名刺画像を処理しました。`;
  console.log(successMsg);
  writeLog(logSheet, successMsg, "SUCCESS", processedCount);
}

/**
 * Gemini APIに名刺画像を送って情報を構造化して受け取る関数
 * @param {string} base64Image - Base64エンコードされた画像データ
 * @param {string} mimeType - 画像のMIMEタイプ
 * @param {string} apiKey - Gemini APIキー（事前取得済み）
 * @returns {Object|null} 抽出された名刺データ、またはエラー時はthrow
 */
function extractWithGemini(base64Image, mimeType, apiKey) {
  // セキュリティ: APIキーはヘッダーで送信（URLパラメータは使用しない）
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  // AIへの指示（プロンプト）
  const prompt = `
あなたは優秀な名刺入力アシスタントです。
提供された名刺画像から以下の情報を抽出し、JSON形式で返答してください。
JSON以外のテキスト（マークダウンのバッククォートなど）は一切含めないでください。
読み取れない項目や存在しない項目は空文字("")にしてください。

【出力JSONフォーマット】
{
  "company": "会社名",
  "department_title": "部署名や役職（複数ある場合はスペース区切り）",
  "name": "氏名（姓名の間にスペースを入れる）",
  "email": "メールアドレス",
  "phone": "電話番号（ハイフンあり）",
  "address": "住所（郵便番号は除く、または別記せずそのまま含める）",
  "website": "WebサイトURL（http://またはhttps://で始まる）",
  "raw_text": "名刺から認識したすべてのテキスト（改行は半角スペースに置き換え）"
}
`;

  // APIへのリクエストボディ作成
  const payload = {
    "contents": [
      {
        "parts": [
          { "text": prompt },
          {
            "inlineData": {
              "mimeType": mimeType,
              "data": base64Image
            }
          }
        ]
      }
    ],
    // 必ずJSONで出力するようにGeminiに強制する設定
    "generationConfig": {
      "responseMimeType": "application/json"
    }
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": {
      "x-goog-api-key": apiKey
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true // エラー時もレスポンスを取得
  };

  // APIを実際に呼び出す
  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    // エラーメッセージをサニタイズ（APIの実装詳細を漏洩させない）
    const errorMessages = {
      400: "無効なリクエスト形式です",
      401: "認証に失敗しました（APIキーを確認してください）",
      403: "アクセス権限がありません",
      429: "API呼び出し制限に達しました。しばらく待ってからリトライしてください",
      500: "Gemini API側でエラーが発生しています",
      503: "Gemini APIが一時的に利用できません"
    };

    const friendlyMessage = errorMessages[responseCode] || "予期しないエラーが発生しました";
    throw new Error(`Gemini API呼び出し失敗: ${friendlyMessage} (ステータス: ${responseCode})`);
  }
  
  const jsonResponse = JSON.parse(responseBody);
  
  // 返答データからテキストを抽出・パース
  if (jsonResponse.candidates && jsonResponse.candidates.length > 0) {
    const textPart = jsonResponse.candidates[0].content.parts[0].text;
    try {
        return JSON.parse(textPart);
    } catch (e) {
        console.error("JSONのパースに失敗", textPart);
        throw new Error("Geminiからの応答が正しいJSON形式ではありませんでした。");
    }
  } else {
    throw new Error("Geminiから予想されたデータ形式が返却されませんでした。");
  }
}

/**
 * 操作ログシートに実行履歴を記録する関数
 * @param {Sheet} logSheet - ログシート（「操作ログ」シート）
 * @param {string} message - ログメッセージ
 * @param {string} status - ステータス（SUCCESS / ERROR / INFO / TIMEOUT）
 * @param {number} fileCount - 処理したファイル数（オプション）
 * @param {string} details - 詳細情報（オプション）
 */
function writeLog(logSheet, message, status, fileCount, details) {
  if (!logSheet) {
    console.warn("ログシートが見つかりません。ログ記録をスキップします。");
    return;
  }

  // ログシートのヘッダーが未作成の場合は初期化
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(["実行日時", "ステータス", "メッセージ", "ファイル数", "詳細"]);
    logSheet.setFrozenRows(1);
    logSheet.setColumnWidth(1, 150);  // 実行日時
    logSheet.setColumnWidth(2, 100);  // ステータス
    logSheet.setColumnWidth(3, 300);  // メッセージ
    logSheet.setColumnWidth(4, 80);   // ファイル数
    logSheet.setColumnWidth(5, 400);  // 詳細
  }

  logSheet.appendRow([
    new Date(),
    status || "INFO",
    message || "",
    fileCount || 0,
    details || ""
  ]);
}
