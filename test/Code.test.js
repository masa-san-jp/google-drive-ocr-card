/**
 * Code.gs のユニットテスト
 *
 * GAS環境のグローバルオブジェクト（DriveApp, SpreadsheetApp等）をモックし、
 * processBusinessCards() のタイムアウト制御・処理件数上限・sanitizeFileName() をテストする。
 */

const fs = require('fs');
const path = require('path');

// --- GASグローバルオブジェクトのモック ---

let mockFiles = [];
let mockFileIndex = 0;
let mockSheetRows = [];
let mockConsoleLog = [];
let mockConsoleError = [];

function createMockFile(name, mimeType, ocrResult, ownerEmail) {
  return {
    getName: () => name,
    getMimeType: () => mimeType,
    getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    getUrl: () => `https://drive.google.com/file/d/mock_${name}`,
    getId: () => `id_${name}`,
    getOwner: () => ownerEmail !== null ? { getEmail: () => ownerEmail || 'owner@example.com' } : null,
    setName: jest.fn(),
    moveTo: jest.fn(),
    _ocrResult: ocrResult || { company: 'テスト株式会社', name: 'テスト 太郎' },
  };
}

function setupGlobalMocks() {
  mockFileIndex = 0;
  mockSheetRows = [];
  mockConsoleLog = [];
  mockConsoleError = [];

  const mockSetValues = jest.fn((rows) => { rows.forEach((row) => mockSheetRows.push(row)); });
  const mockSheet = {
    getLastRow: jest.fn(() => 1 + mockSheetRows.length),
    appendRow: jest.fn((row) => mockSheetRows.push(row)),
    getRange: jest.fn(() => ({ setValues: mockSetValues })),
    setFrozenRows: jest.fn(),
    setColumnWidth: jest.fn(),
  };

  global.DriveApp = {
    getFolderById: () => ({
      getFiles: () => ({
        hasNext: () => mockFileIndex < mockFiles.length,
        next: () => mockFiles[mockFileIndex++],
      }),
    }),
  };

  global.SpreadsheetApp = {
    openById: () => ({
      getSheetByName: () => mockSheet,
    }),
  };

  global.Utilities = {
    base64Encode: () => 'bW9ja2RhdGE=',
  };

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: () => 'mock-api-key',
    }),
  };

  global.UrlFetchApp = {
    fetch: jest.fn(() => {
      const currentFile = mockFiles[mockFileIndex - 1];
      const result = currentFile?._ocrResult || { company: 'テスト株式会社', name: 'テスト 太郎' };
      return {
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
          }),
      };
    }),
  };

  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { mockConsoleLog.push(args.join(' ')); };
  console.error = (...args) => { mockConsoleError.push(args.join(' ')); };

  return {
    mockSheet,
    restoreConsole: () => { console.log = originalLog; console.error = originalError; },
  };
}

/**
 * Code.gsをNode.js環境で実行可能にする。
 * GASのトップレベル関数をglobalオブジェクトに登録する。
 */
function loadCodeGs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
  // GASのトップレベルconst/functionをNode.jsのglobalに登録
  const wrapped = `(function() {
    ${code
      .replace(/^const CONFIG/m, 'global.CONFIG')
      .replace(/^function sanitizeFileName/m, 'global.sanitizeFileName = function sanitizeFileName')
      .replace(/^function getFileMetadata/m, 'global.getFileMetadata = function getFileMetadata')
      .replace(/^function normalizeCardRecord/m, 'global.normalizeCardRecord = function normalizeCardRecord')
      .replace(/^function processBusinessCards/m, 'global.processBusinessCards = function processBusinessCards')
      .replace(/^function extractWithGemini/m, 'global.extractWithGemini = function extractWithGemini')
    }
  })();`;
  eval(wrapped);
}

// =========================================================
// テストスイート
// =========================================================

describe('sanitizeFileName', () => {
  let restoreConsole;

  beforeEach(() => {
    const mocks = setupGlobalMocks();
    restoreConsole = mocks.restoreConsole;
    loadCodeGs();
  });

  afterEach(() => { restoreConsole(); });

  test('OS禁則文字を除去する', () => {
    expect(global.sanitizeFileName('test\\file:name*?.jpg')).toBe('testfilename.jpg');
  });

  test('禁則文字がない場合はそのまま返す', () => {
    expect(global.sanitizeFileName('normal_file.jpg')).toBe('normal_file.jpg');
  });

  test('全ての禁則文字を除去する', () => {
    expect(global.sanitizeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  test('空文字列を処理できる', () => {
    expect(global.sanitizeFileName('')).toBe('');
  });

  test('日本語ファイル名はそのまま保持する', () => {
    expect(global.sanitizeFileName('名刺_テスト.jpg')).toBe('名刺_テスト.jpg');
  });
});

describe('processBusinessCards - タイムアウト制御', () => {
  let restoreConsole;

  beforeEach(() => {
    mockFiles = [];
    mockFileIndex = 0;
  });

  afterEach(() => { restoreConsole(); });

  test('タイムアウト時にループを中断しログを出力する', () => {
    mockFiles = Array.from({ length: 15 }, (_, i) =>
      createMockFile(`card_${i}.jpg`, 'image/jpeg')
    );
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();
    // タイムアウトを-1msに設定して即発動（startTimeとの差が必ず正になる）
    global.CONFIG.TIMEOUT_MS = -1;

    global.processBusinessCards();

    const timeoutLog = mockConsoleLog.find((msg) => msg.includes('タイムアウト安全装置発動'));
    expect(timeoutLog).toBeDefined();
    // タイムアウト即発動のため、1件も処理されない
    expect(mockSheetRows.length).toBe(0);
  });

  test('タイムアウトしない場合は全ファイルを処理する', () => {
    mockFiles = Array.from({ length: 3 }, (_, i) =>
      createMockFile(`card_${i}.jpg`, 'image/jpeg')
    );
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();

    global.processBusinessCards();

    const timeoutLog = mockConsoleLog.find((msg) => msg.includes('タイムアウト安全装置発動'));
    expect(timeoutLog).toBeUndefined();
    expect(mockSheetRows.length).toBe(3);
  });
});

describe('processBusinessCards - 処理件数上限', () => {
  let restoreConsole;

  beforeEach(() => {
    mockFiles = [];
    mockFileIndex = 0;
  });

  afterEach(() => { restoreConsole(); });

  test('MAX_FILES_PER_RUN件で処理を停止しログを出力する', () => {
    mockFiles = Array.from({ length: 15 }, (_, i) =>
      createMockFile(`card_${i}.jpg`, 'image/jpeg')
    );
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();
    global.CONFIG.MAX_FILES_PER_RUN = 5;

    global.processBusinessCards();

    const limitLog = mockConsoleLog.find((msg) => msg.includes('処理件数上限'));
    expect(limitLog).toBeDefined();
    expect(limitLog).toContain('5件');
    expect(mockSheetRows.length).toBe(5);
  });

  test('ファイル数が上限未満なら全て処理する', () => {
    mockFiles = Array.from({ length: 3 }, (_, i) =>
      createMockFile(`card_${i}.jpg`, 'image/jpeg')
    );
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();
    global.CONFIG.MAX_FILES_PER_RUN = 10;

    global.processBusinessCards();

    const limitLog = mockConsoleLog.find((msg) => msg.includes('処理件数上限'));
    expect(limitLog).toBeUndefined();
    expect(mockSheetRows.length).toBe(3);
  });

  test('MAX_FILES_PER_RUN=1の場合は1件だけ処理する', () => {
    mockFiles = Array.from({ length: 5 }, (_, i) =>
      createMockFile(`card_${i}.jpg`, 'image/jpeg')
    );
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();
    global.CONFIG.MAX_FILES_PER_RUN = 1;

    global.processBusinessCards();

    expect(mockSheetRows.length).toBe(1);
    const limitLog = mockConsoleLog.find((msg) => msg.includes('処理件数上限'));
    expect(limitLog).toBeDefined();
  });
});

describe('processBusinessCards - 対応外ファイルのスキップ', () => {
  let restoreConsole;

  afterEach(() => { restoreConsole(); });

  test('対応外MIMEタイプはスキップし、対応ファイルのみ処理する', () => {
    mockFileIndex = 0;
    mockFiles = [
      createMockFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      createMockFile('card_1.jpg', 'image/jpeg'),
      createMockFile('video.mp4', 'video/mp4'),
      createMockFile('card_2.png', 'image/png'),
      createMockFile('text.txt', 'text/plain'),
    ];
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();
    global.CONFIG.MAX_FILES_PER_RUN = 10;

    global.processBusinessCards();

    expect(mockSheetRows.length).toBe(2);
    const skipLogs = mockConsoleLog.filter((msg) => msg.includes('対応外のファイル形式'));
    expect(skipLogs.length).toBe(3);
  });
});

describe('processBusinessCards - CONFIG定数の初期値', () => {
  let restoreConsole;

  afterEach(() => { restoreConsole(); });

  test('TIMEOUT_MSのデフォルト値は5分（300000ms）', () => {
    mockFiles = [];
    mockFileIndex = 0;
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();

    expect(global.CONFIG.TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  test('MAX_FILES_PER_RUNのデフォルト値は10', () => {
    mockFiles = [];
    mockFileIndex = 0;
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();

    expect(global.CONFIG.MAX_FILES_PER_RUN).toBe(10);
  });
});

// =========================================================
// normalizeCardRecord テスト
// =========================================================

describe('normalizeCardRecord', () => {
  let restoreConsole;

  beforeEach(() => {
    const mocks = setupGlobalMocks();
    restoreConsole = mocks.restoreConsole;
    loadCodeGs();
  });

  afterEach(() => { restoreConsole(); });

  test('全フィールドが揃っているレコードはそのまま返す', () => {
    const input = {
      company: 'テスト株式会社',
      department_title: '営業部 部長',
      name: 'テスト 太郎',
      email: 'test@example.com',
      phone: '03-1234-5678',
      address: '東京都千代田区'
    };
    const result = global.normalizeCardRecord(input);
    expect(result).toEqual(input);
  });

  test('不足フィールドを空文字で補完する', () => {
    const input = { company: 'テスト株式会社', name: 'テスト 太郎' };
    const result = global.normalizeCardRecord(input);
    expect(result.department_title).toBe('');
    expect(result.email).toBe('');
    expect(result.phone).toBe('');
    expect(result.address).toBe('');
    expect(result.company).toBe('テスト株式会社');
    expect(result.name).toBe('テスト 太郎');
  });

  test('null/undefinedレコードは全フィールド空文字を返す', () => {
    const result = global.normalizeCardRecord(null);
    expect(result).toEqual({
      company: '', department_title: '', name: '',
      email: '', phone: '', address: ''
    });
  });

  test('数値フィールドは空文字に置換する', () => {
    const input = { company: 'テスト', phone: 12345 };
    const result = global.normalizeCardRecord(input);
    expect(result.phone).toBe('');
    expect(result.company).toBe('テスト');
  });
});

// =========================================================
// 複数名刺バッチ書き込みテスト
// =========================================================

describe('processBusinessCards - 複数名刺バッチ書き込み', () => {
  let restoreConsole;

  beforeEach(() => {
    mockFiles = [];
    mockFileIndex = 0;
  });

  afterEach(() => { restoreConsole(); });

  test('PDF内の複数名刺が全てシートに書き込まれる', () => {
    const multiCardResult = [
      { company: 'A社', department_title: '営業', name: '田中 太郎', email: 'a@a.com', phone: '03-1111-1111', address: '東京' },
      { company: 'B社', department_title: '開発', name: '鈴木 花子', email: 'b@b.com', phone: '03-2222-2222', address: '大阪' },
      { company: 'C社', department_title: '企画', name: '佐藤 次郎', email: 'c@c.com', phone: '03-3333-3333', address: '名古屋' },
    ];
    mockFiles = [createMockFile('multi.pdf', 'application/pdf', multiCardResult)];
    const { mockSheet, restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();

    global.processBusinessCards();

    // setValuesが呼ばれ、3行分のデータが書き込まれる
    expect(mockSheetRows.length).toBe(3);
    expect(mockSheetRows[0][1]).toBe('A社');
    expect(mockSheetRows[1][1]).toBe('B社');
    expect(mockSheetRows[2][1]).toBe('C社');
  });

  test('バッチ書き込みにソースアカウントカラムが含まれる', () => {
    const twoCards = [
      { company: 'X社', name: '山田 一郎' },
      { company: 'Y社', name: '山田 二郎' },
    ];
    mockFiles = [createMockFile('cards.pdf', 'application/pdf', twoCards, 'uploader@example.com')];
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();

    global.processBusinessCards();

    // カラム8=ソースアカウント（0始まり配列）
    expect(mockSheetRows[0][8]).toBe('uploader@example.com'); // ソースアカウント
    expect(mockSheetRows[1][8]).toBe('uploader@example.com'); // ソースアカウント
  });

  test('抽出結果が空配列の場合はスキップしログを出力する', () => {
    mockFiles = [createMockFile('empty.jpg', 'image/jpeg', [])];
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();

    global.processBusinessCards();

    expect(mockSheetRows.length).toBe(0);
    const skipLog = mockConsoleLog.find((msg) => msg.includes('抽出結果が空のためスキップ'));
    expect(skipLog).toBeDefined();
  });

  test('単一画像ファイルでも正常に1行書き込まれる', () => {
    mockFiles = [createMockFile('single.jpg', 'image/jpeg', { company: 'Z社', name: '単一 太郎' })];
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;
    loadCodeGs();

    global.processBusinessCards();

    expect(mockSheetRows.length).toBe(1);
    expect(mockSheetRows[0][1]).toBe('Z社');
  });
});

// =========================================================
// getFileMetadata テスト
// =========================================================

describe('getFileMetadata', () => {
  let restoreConsole;

  beforeEach(() => {
    const mocks = setupGlobalMocks();
    restoreConsole = mocks.restoreConsole;
    loadCodeGs();
  });

  afterEach(() => { restoreConsole(); });

  test('オーナーが存在する場合はメールアドレスを返す', () => {
    const file = createMockFile('test.jpg', 'image/jpeg', null, 'owner@example.com');
    const result = global.getFileMetadata(file);
    expect(result.fileId).toBe('id_test.jpg');
    expect(result.fileName).toBe('test.jpg');
    expect(result.sourceAccount).toBe('owner@example.com');
  });

  test('オーナーがnull（共有ドライブ）でDriveサービス利用可能な場合はsharingUserを返す', () => {
    const file = createMockFile('shared.pdf', 'application/pdf', null, null);
    global.Drive = {
      Files: {
        get: jest.fn(() => ({ sharingUser: { emailAddress: 'sharer@example.com' } })),
      },
    };
    const result = global.getFileMetadata(file);
    expect(result.sourceAccount).toBe('sharer@example.com');
  });

  test('オーナーがnullでDriveサービスも利用不可の場合は取得不可を返す', () => {
    const file = createMockFile('shared.pdf', 'application/pdf', null, null);
    global.Drive = {
      Files: {
        get: jest.fn(() => { throw new Error('Drive API unavailable'); }),
      },
    };
    const result = global.getFileMetadata(file);
    expect(result.sourceAccount).toBe('取得不可');
  });

  test('オーナーがnullでsharingUserなしの場合は取得不可を返す', () => {
    const file = createMockFile('shared.pdf', 'application/pdf', null, null);
    global.Drive = {
      Files: {
        get: jest.fn(() => ({ sharingUser: null })),
      },
    };
    const result = global.getFileMetadata(file);
    expect(result.sourceAccount).toBe('取得不可');
  });

  test('getOwner()が例外を投げる場合は取得不可を返す', () => {
    const file = {
      getName: () => 'error.jpg',
      getId: () => 'id_error',
      getOwner: () => { throw new Error('Permission denied'); },
    };
    const result = global.getFileMetadata(file);
    expect(result.fileId).toBe('id_error');
    expect(result.fileName).toBe('error.jpg');
    expect(result.sourceAccount).toBe('取得不可');
  });
});

// =========================================================
// extractWithGemini 正規化テスト
// =========================================================

describe('extractWithGemini - 応答正規化', () => {
  let restoreConsole;

  afterEach(() => { restoreConsole(); });

  test('単一オブジェクト応答を配列に正規化する', () => {
    mockFiles = [];
    mockFileIndex = 0;
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;

    // 単一オブジェクトを返すモック
    global.UrlFetchApp = {
      fetch: jest.fn(() => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ company: 'Test', name: 'Taro' }) }] } }],
        }),
      })),
    };
    loadCodeGs();

    const result = global.extractWithGemini('base64data', 'image/jpeg');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].company).toBe('Test');
    // 不足フィールドが補完されている
    expect(result[0].email).toBe('');
    expect(result[0].phone).toBe('');
  });

  test('配列応答はそのまま配列で返す（フィールド補完あり）', () => {
    mockFiles = [];
    mockFileIndex = 0;
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;

    global.UrlFetchApp = {
      fetch: jest.fn(() => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify([
            { company: 'A社' },
            { company: 'B社', name: '鈴木' },
          ]) }] } }],
        }),
      })),
    };
    loadCodeGs();

    const result = global.extractWithGemini('base64data', 'application/pdf');
    expect(result.length).toBe(2);
    expect(result[0].company).toBe('A社');
    expect(result[0].name).toBe('');  // 補完された
    expect(result[1].name).toBe('鈴木');
  });

  test('不正な型（文字列等）の場合は空配列を返す', () => {
    mockFiles = [];
    mockFileIndex = 0;
    const { restoreConsole: rc } = setupGlobalMocks();
    restoreConsole = rc;

    global.UrlFetchApp = {
      fetch: jest.fn(() => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify("invalid string") }] } }],
        }),
      })),
    };
    loadCodeGs();

    const result = global.extractWithGemini('base64data', 'image/png');
    expect(result).toEqual([]);
  });
});
