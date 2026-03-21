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

function createMockFile(name, mimeType, ocrResult) {
  return {
    getName: () => name,
    getMimeType: () => mimeType,
    getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    getUrl: () => `https://drive.google.com/file/d/mock_${name}`,
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

  const mockSheet = {
    getLastRow: () => 1,
    appendRow: jest.fn((row) => mockSheetRows.push(row)),
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
