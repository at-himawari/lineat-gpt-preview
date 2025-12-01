// LINE Webhook Handlerの基本テスト

jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// LINE SDKのモック
const mockReplyMessage = jest.fn();
const mockMessagingApiClient = jest.fn().mockImplementation(() => ({
  replyMessage: mockReplyMessage,
}));

jest.mock("@line/bot-sdk", () => ({
  messagingApi: {
    MessagingApiClient: mockMessagingApiClient,
  },
}));

const { handler } = require("../../handlers/webhook");

describe("LINE Webhook Handler - 基本テスト", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test_token";
    process.env.LINE_CHANNEL_SECRET = "test_secret";
    process.env.SKIP_SIGNATURE_VALIDATION = "true"; // テスト用に署名検証をスキップ
  });

  const mockContext = {
    requestId: "test-request-id",
  };

  describe("環境変数チェック", () => {
    test("LINE認証情報が欠けている場合、500エラーを返す", async () => {
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

      const mockEvent = {
        body: JSON.stringify({ events: [] }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: "Missing LINE credentials",
      });
    });
  });

  describe("リクエスト検証", () => {
    test("リクエストボディがない場合、400エラーを返す", async () => {
      const mockEvent = {
        body: null,
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({ error: "No request body" });
    });

    test("空のイベント配列の場合、200を返す", async () => {
      const mockEvent = {
        body: JSON.stringify({ events: [] }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
    });
  });

  describe("Base64エンコーディング", () => {
    test("Base64エンコードされたボディを正しくデコードする", async () => {
      const bodyString = JSON.stringify({ events: [] });
      const mockEvent = {
        body: Buffer.from(bodyString).toString("base64"),
        isBase64Encoded: true,
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
    });
  });

  describe("レスポンス形式", () => {
    test("成功時のレスポンスに正しいヘッダーが含まれる", async () => {
      const mockEvent = {
        body: JSON.stringify({ events: [] }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.headers).toEqual({ "Content-Type": "application/json" });
    });
  });
});
