/**
 * =========================================================
 * 名刺OCR自動化システム (Google Apps Script)
 * =========================================================
 * 下記の「CONFIG」内の値を、ご自身の環境に合わせて変更してください。
 */

const CONFIG = {
  // 1. 各種IDの設定
  FOLDER_ID_INPUT: "ここに名刺スキャン用フォルダのIDを貼り付け",
  FOLDER_ID_PROCESSED: "ここに処理済み名刺フォルダのIDを貼り付け",
  SPREADSHEET_ID: "ここにスプレッドシートのIDを貼り付け",
  SHEET_NAME: "シート1" // スプレッドシートのタブ名（デフォルトは「シート1」）
  
  // 2. Gemini APIの設定はGASの「スクリプトプロパティ」から読み込みます
  // (ここに直書きしないでください: セキュリティ対策)
};

/**
 * 処理のメイン関数：これを定期実行（トリガー）に設定します。
 */
function processBusinessCards() {
  const inputFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID_INPUT);
  const processedFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID_PROCESSED);
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  
  if (!sheet) {
    console.error("指定されたシート名が見つかりません。");
    return;
  }
  
  // スプレッドシートが空の場合、1行目にヘッダーを作成する
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["処理日時", "会社名", "部署・役職", "氏名", "メールアドレス", "電話番号", "住所", "画像URL"]);
    sheet.setFrozenRows(1);          // 1行目を固定
    sheet.setColumnWidth(1, 150);    // タイムスタンプ幅
    sheet.setColumnWidth(2, 200);    // 会社名幅
    sheet.setColumnWidth(4, 150);    // 氏名幅
    sheet.setColumnWidth(5, 200);    // 会アド幅
    sheet.setColumnWidth(8, 300);    // 画像リンク幅
  }
  
  // フォルダ内のすべてのファイルを取得
  const files = inputFolder.getFiles();
  // 画像ファイル（jpg/png/tiff/heif）およびPDFを処理対象とする
  const SUPPORTED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/tiff', 'image/heic', 'image/heif',
    'application/pdf'
  ];
  let processedCount = 0;
  
  while (files.hasNext()) {
    const file = files.next();
    const mimeType = file.getMimeType();
    
    if (SUPPORTED_MIME_TYPES.includes(mimeType)) {
      try {
        console.log(`処理開始: ${file.getName()}`);
        
        // ファイルデータをBase64形式に変換（APIに送信用）
        const blob = file.getBlob();
        const base64Image = Utilities.base64Encode(blob.getBytes());
        // HEIC/HEIF等の特殊フォーマットはJPEGとして扱わせる
        const apiMimeType = (mimeType === 'image/heic' || mimeType === 'image/heif') ? 'image/jpeg' : mimeType; 
        
        // Gemini APIを呼び出し、名刺の情報をJSON形式で抽出
        const extractedData = extractWithGemini(base64Image, apiMimeType);
        
        if (extractedData) {
          // スプレッドシートに抽出データを1行追記
          sheet.appendRow([
            new Date(),
            extractedData.company || "",
            extractedData.department_title || "",
            extractedData.name || "",
            extractedData.email || "",
            extractedData.phone || "",
            extractedData.address || "",
            file.getUrl()
          ]);
          
          // ファイル名の変更処理
          const safeCompany = extractedData.company || "不明";
          const safeName = extractedData.name || "不明";
          const extMatch = file.getName().match(/(\.[^.]+)$/);
          const ext = extMatch ? extMatch[1] : ""; // オリジナルの拡張子
          
          const newName = `[処理済] ${safeCompany}_${safeName}${ext}`;
          file.setName(newName);
          
          // 処理済みフォルダにファイルを移動（スキャンフォルダから消える）
          file.moveTo(processedFolder);
          
          console.log(`処理完了: ${newName}`);
          processedCount++;
        }
      } catch (e) {
        console.error(`エラー発生ファイル: ${file.getName()}, エラー詳細: ${e.message}`);
      }
    } else {
      console.log(`対応外のファイル形式のためスキップしました: ${file.getName()} (${mimeType})`);
    }
  }
  
  console.log(`計 ${processedCount} 件の名刺画像を処理しました。`);
}

/**
 * Gemini APIに名刺画像を送って情報を構造化して受け取る関数
 */
function extractWithGemini(base64Image, mimeType) {
  // スクリプトプロパティからAPIキーを安全に取得
  const properties = PropertiesService.getScriptProperties();
  const apiKey = properties.getProperty('GEMINI_API_KEY');
  
  if (!apiKey) {
    throw new Error("APIキーが設定されていません。GASのプロジェクト設定から「スクリプトプロパティ」に GEMINI_API_KEY を登録してください。");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
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
  "address": "住所（郵便番号は除く、または別記せずそのまま含める）"
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
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true // エラー時もレスポンスを取得
  };

  // APIを実際に呼び出す
  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  
  if (responseCode !== 200) {
    // セキュリティ対策のためレスポンス生データを全てダンプするのを避ける
    const errorData = (() => {
      try { return JSON.parse(responseBody).error.message; } catch(e) { return "内容不明またはパースエラー"; }
    })();
    throw new Error(`Gemini API呼び出しでエラーが発生しました。 (ステータスコード: ${responseCode}), メッセージ: ${errorData}`);
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
