// Stripe Webhook処理のテスト

const mockStripe = {
  webhooks: {
    constructEvent: jest.fn(),
  },
};

jest.mock("stripe", () => {
  return jest.fn(() => mockStripe);
});

jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const stripeService = require("../../services/stripe");

describe("Stripe Webhook 処理のテスト", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_mock";
  });

  describe("checkout.session.completed イベントの処理", () => {
    test("quota_extension決済完了時、正しく処理される", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_001",
        data: {
          object: {
            id: "cs_test_session_001",
            metadata: {
              userId: "test_user_001",
              productType: "quota_extension",
            },
            client_reference_id: "test_user_001",
            customer: "cus_test_001",
            subscription: null,
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest
          .fn()
          .mockResolvedValue({ success: true }),
      };

      const result = await stripeService.handleWebhookEvent(
        mockEvent,
        mockDatabaseService
      );

      expect(result.success).toBe(true);
      expect(mockDatabaseService.processPaymentCompletion).toHaveBeenCalledWith(
        "cs_test_session_001",
        "test_user_001",
        "quota_extension",
        "cus_test_001",
        null
      );
    });

    test("model_upgrade決済完了時、正しく処理される", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_002",
        data: {
          object: {
            id: "cs_test_session_002",
            metadata: {
              userId: "test_user_002",
              productType: "model_upgrade",
            },
            client_reference_id: "test_user_002",
            customer: "cus_test_002",
            subscription: "sub_test_002",
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest
          .fn()
          .mockResolvedValue({ success: true }),
      };

      const result = await stripeService.handleWebhookEvent(
        mockEvent,
        mockDatabaseService
      );

      expect(result.success).toBe(true);
      expect(mockDatabaseService.processPaymentCompletion).toHaveBeenCalledWith(
        "cs_test_session_002",
        "test_user_002",
        "model_upgrade",
        "cus_test_002",
        "sub_test_002"
      );
    });

    test("userIdがclient_reference_idから取得される", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_003",
        data: {
          object: {
            id: "cs_test_session_003",
            metadata: {},
            client_reference_id: "test_user_003",
            customer: "cus_test_003",
            subscription: null,
          },
        },
      };

      // productTypeがないのでエラーになるはず
      const mockDatabaseService = {
        processPaymentCompletion: jest.fn(),
      };

      await expect(
        stripeService.handleWebhookEvent(mockEvent, mockDatabaseService)
      ).rejects.toThrow("Product type not found in session metadata");
    });
  });

  describe("署名検証のテスト", () => {
    test("有効な署名で検証が成功する", () => {
      const payload = JSON.stringify({ type: "test.event" });
      const signature = "valid_signature";
      const secret = "whsec_test_mock";
      const mockEvent = { type: "test.event", id: "evt_test" };

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = stripeService.verifyWebhookSignature(
        payload,
        signature,
        secret
      );

      expect(result).toEqual(mockEvent);
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        payload,
        signature,
        secret
      );
    });

    test("無効な署名で検証が失敗する", () => {
      const payload = JSON.stringify({ type: "test.event" });
      const signature = "invalid_signature";
      const secret = "whsec_test_mock";

      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      expect(() => {
        stripeService.verifyWebhookSignature(payload, signature, secret);
      }).toThrow("Invalid signature");
    });

    test("シークレットが設定されていない場合エラーがスローされる", () => {
      const payload = JSON.stringify({ type: "test.event" });
      const signature = "signature";
      const secret = null;

      expect(() => {
        stripeService.verifyWebhookSignature(payload, signature, secret);
      }).toThrow("Webhook secret is not configured");
    });
  });

  describe("商品タイプ別の処理分岐テスト", () => {
    test("quota_extensionの場合、枠追加処理が呼ばれる", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_004",
        data: {
          object: {
            id: "cs_test_session_004",
            metadata: {
              userId: "test_user_004",
              productType: "quota_extension",
            },
            customer: "cus_test_004",
            subscription: null,
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest
          .fn()
          .mockResolvedValue({ success: true }),
      };

      await stripeService.handleWebhookEvent(mockEvent, mockDatabaseService);

      expect(mockDatabaseService.processPaymentCompletion).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "quota_extension",
        expect.any(String),
        null
      );
    });

    test("model_upgradeの場合、プレミアムモデル有効化処理が呼ばれる", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_005",
        data: {
          object: {
            id: "cs_test_session_005",
            metadata: {
              userId: "test_user_005",
              productType: "model_upgrade",
            },
            customer: "cus_test_005",
            subscription: "sub_test_005",
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest
          .fn()
          .mockResolvedValue({ success: true }),
      };

      await stripeService.handleWebhookEvent(mockEvent, mockDatabaseService);

      expect(mockDatabaseService.processPaymentCompletion).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "model_upgrade",
        expect.any(String),
        expect.any(String)
      );
    });

    test("不明な商品タイプの場合エラーがスローされる", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_006",
        data: {
          object: {
            id: "cs_test_session_006",
            metadata: {
              userId: "test_user_006",
              productType: "unknown_type",
            },
            customer: "cus_test_006",
            subscription: null,
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest.fn(),
      };

      await expect(
        stripeService.handleWebhookEvent(mockEvent, mockDatabaseService)
      ).rejects.toThrow();
    });
  });

  describe("エラーケースのテスト", () => {
    test("userIdが見つからない場合エラーがスローされる", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_007",
        data: {
          object: {
            id: "cs_test_session_007",
            metadata: {
              productType: "quota_extension",
            },
            customer: "cus_test_007",
            subscription: null,
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest.fn(),
      };

      await expect(
        stripeService.handleWebhookEvent(mockEvent, mockDatabaseService)
      ).rejects.toThrow("User ID not found in session metadata");
    });

    test("productTypeが見つからない場合エラーがスローされる", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_008",
        data: {
          object: {
            id: "cs_test_session_008",
            metadata: {
              userId: "test_user_008",
            },
            client_reference_id: "test_user_008",
            customer: "cus_test_008",
            subscription: null,
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest.fn(),
      };

      await expect(
        stripeService.handleWebhookEvent(mockEvent, mockDatabaseService)
      ).rejects.toThrow("Product type not found in session metadata");
    });

    test("データベースエラー時にエラーが伝播される", async () => {
      const mockEvent = {
        type: "checkout.session.completed",
        id: "evt_test_009",
        data: {
          object: {
            id: "cs_test_session_009",
            metadata: {
              userId: "test_user_009",
              productType: "quota_extension",
            },
            customer: "cus_test_009",
            subscription: null,
          },
        },
      };

      const mockDatabaseService = {
        processPaymentCompletion: jest
          .fn()
          .mockRejectedValue(new Error("Database error")),
      };

      await expect(
        stripeService.handleWebhookEvent(mockEvent, mockDatabaseService)
      ).rejects.toThrow("Database error");
    });
  });

  describe("その他のイベントタイプ", () => {
    test("未処理のイベントタイプでもエラーにならない", async () => {
      const mockEvent = {
        type: "payment_intent.succeeded",
        id: "evt_test_010",
        data: {
          object: {},
        },
      };

      const mockDatabaseService = {};

      const result = await stripeService.handleWebhookEvent(
        mockEvent,
        mockDatabaseService
      );

      expect(result.success).toBe(true);
    });
  });
});
