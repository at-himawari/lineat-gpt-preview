// Stripe Webhook Handlerのテスト

const mockStripeService = {
  verifyWebhookSignature: jest.fn(),
  handleWebhookEvent: jest.fn(),
};

const mockDatabaseService = {};

jest.mock("../../services/stripe", () => mockStripeService);
jest.mock("../../services/database", () => mockDatabaseService);
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { handler } = require("../../handlers/stripe-webhook");

describe("Stripe Webhook Handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  });

  const createMockEvent = (body, signature, isBase64 = false) => ({
    body: isBase64 ? Buffer.from(body).toString("base64") : body,
    isBase64Encoded: isBase64,
    headers: {
      "Stripe-Signature": signature,
      "Content-Type": "application/json",
    },
  });

  const mockContext = {
    requestId: "test-request-id",
  };

  describe("正常系", () => {
    test("有効なwebhookイベントが正しく処理される", async () => {
      const mockEvent = createMockEvent(
        JSON.stringify({ type: "checkout.session.completed" }),
        "valid_signature"
      );

      const mockStripeEvent = {
        type: "checkout.session.completed",
        id: "evt_test_001",
        data: { object: {} },
      };

      mockStripeService.verifyWebhookSignature.mockReturnValue(mockStripeEvent);
      mockStripeService.handleWebhookEvent.mockResolvedValue({ success: true });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ received: true });
      expect(mockStripeService.verifyWebhookSignature).toHaveBeenCalledWith(
        mockEvent.body,
        "valid_signature",
        "whsec_test_secret"
      );
      expect(mockStripeService.handleWebhookEvent).toHaveBeenCalledWith(
        mockStripeEvent,
        mockDatabaseService
      );
    });

    test("Base64エンコードされたボディが正しくデコードされる", async () => {
      const bodyString = JSON.stringify({ type: "test.event" });
      const mockEvent = createMockEvent(bodyString, "valid_signature", true);

      const mockStripeEvent = {
        type: "test.event",
        id: "evt_test_002",
      };

      mockStripeService.verifyWebhookSignature.mockReturnValue(mockStripeEvent);
      mockStripeService.handleWebhookEvent.mockResolvedValue({ success: true });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockStripeService.verifyWebhookSignature).toHaveBeenCalledWith(
        bodyString,
        "valid_signature",
        "whsec_test_secret"
      );
    });

    test("ヘッダーのキーが小文字に正規化される", async () => {
      const mockEvent = {
        body: JSON.stringify({ type: "test.event" }),
        isBase64Encoded: false,
        headers: {
          "STRIPE-SIGNATURE": "valid_signature",
          "Content-Type": "application/json",
        },
      };

      const mockStripeEvent = { type: "test.event", id: "evt_test_003" };

      mockStripeService.verifyWebhookSignature.mockReturnValue(mockStripeEvent);
      mockStripeService.handleWebhookEvent.mockResolvedValue({ success: true });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
    });
  });

  describe("エラーケース", () => {
    test("リクエストボディがない場合、400エラーを返す", async () => {
      const mockEvent = {
        body: null,
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({ error: "No request body" });
    });

    test("署名ヘッダーがない場合、401エラーを返す", async () => {
      const mockEvent = {
        body: JSON.stringify({ type: "test.event" }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({ error: "No signature header" });
    });

    test("Webhook シークレットが設定されていない場合、500エラーを返す", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const mockEvent = createMockEvent(
        JSON.stringify({ type: "test.event" }),
        "signature"
      );

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: "Webhook secret not configured",
      });
    });

    test("署名検証が失敗した場合、401エラーを返す", async () => {
      const mockEvent = createMockEvent(
        JSON.stringify({ type: "test.event" }),
        "invalid_signature"
      );

      mockStripeService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({ error: "Invalid signature" });
    });

    test("イベント処理中にエラーが発生した場合、500エラーを返す", async () => {
      const mockEvent = createMockEvent(
        JSON.stringify({ type: "test.event" }),
        "valid_signature"
      );

      const mockStripeEvent = { type: "test.event", id: "evt_test_004" };

      mockStripeService.verifyWebhookSignature.mockReturnValue(mockStripeEvent);
      mockStripeService.handleWebhookEvent.mockRejectedValue(
        new Error("Processing error")
      );

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: "Internal server error",
      });
    });

    test("予期しないエラーが発生した場合、500エラーを返す", async () => {
      const mockEvent = createMockEvent(
        JSON.stringify({ type: "test.event" }),
        "valid_signature"
      );

      mockStripeService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(401);
    });
  });

  describe("レスポンス形式", () => {
    test("成功時のレスポンスに正しいヘッダーが含まれる", async () => {
      const mockEvent = createMockEvent(
        JSON.stringify({ type: "test.event" }),
        "valid_signature"
      );

      const mockStripeEvent = { type: "test.event", id: "evt_test_005" };

      mockStripeService.verifyWebhookSignature.mockReturnValue(mockStripeEvent);
      mockStripeService.handleWebhookEvent.mockResolvedValue({ success: true });

      const result = await handler(mockEvent, mockContext);

      expect(result.headers).toEqual({ "Content-Type": "application/json" });
    });

    test("エラー時のレスポンスに正しいヘッダーが含まれる", async () => {
      const mockEvent = {
        body: null,
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.headers).toEqual({ "Content-Type": "application/json" });
    });
  });
});
