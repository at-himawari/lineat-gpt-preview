// Stripeサービスの購入導線テスト

// Stripeクライアントのモック
const mockStripe = {
  checkout: {
    sessions: {
      create: jest.fn(),
    },
  },
  billingPortal: {
    configurations: {
      list: jest.fn(),
      create: jest.fn(),
    },
    sessions: {
      create: jest.fn(),
    },
  },
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

describe("Stripe Checkout セッション作成のテスト", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stripeService.resetStripeStateForTests();
    // 環境変数の設定
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_QUOTA_PRICE_ID = "price_test_quota";
    process.env.STRIPE_PREMIUM_PRICE_ID = "price_test_premium";
    process.env.STRIPE_SUCCESS_URL = "https://example.com/success";
    process.env.STRIPE_CANCEL_URL = "https://example.com/cancel";
    mockStripe.billingPortal.configurations.list.mockResolvedValue({
      data: [],
    });
    mockStripe.billingPortal.configurations.create.mockResolvedValue({
      id: "bpc_test_default",
    });
  });

  describe("枠拡張（quota_extension）セッションの作成", () => {
    test("正しいパラメータでセッションが作成される", async () => {
      const userId = "test_user_001";
      const productType = "quota_extension";
      const mockSession = {
        id: "cs_test_session_001",
        url: "https://checkout.stripe.com/test",
      };

      mockStripe.checkout.sessions.create.mockResolvedValue(mockSession);

      const result = await stripeService.createCheckoutSession(
        userId,
        productType
      );

      expect(result).toEqual(mockSession);
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith({
        payment_method_types: ["card"],
        line_items: [
          {
            price: "price_test_quota",
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
        metadata: {
          userId,
          productType,
        },
        client_reference_id: userId,
      });
    });

    test("追加のメタデータが正しく含まれる", async () => {
      const userId = "test_user_002";
      const productType = "quota_extension";
      const additionalMetadata = {
        source: "line_bot",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const mockSession = { id: "cs_test_session_002" };

      mockStripe.checkout.sessions.create.mockResolvedValue(mockSession);

      await stripeService.createCheckoutSession(
        userId,
        productType,
        additionalMetadata
      );

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            userId,
            productType,
            ...additionalMetadata,
          },
        })
      );
    });
  });

  describe("モデルアップグレード（model_upgrade）セッションの作成", () => {
    test("サブスクリプションモードでセッションが作成される", async () => {
      const userId = "test_user_003";
      const productType = "model_upgrade";
      const mockSession = {
        id: "cs_test_session_003",
        url: "https://checkout.stripe.com/test",
      };

      mockStripe.checkout.sessions.create.mockResolvedValue(mockSession);

      const result = await stripeService.createCheckoutSession(
        userId,
        productType
      );

      expect(result).toEqual(mockSession);
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          line_items: [
            {
              price: "price_test_premium",
              quantity: 1,
            },
          ],
        })
      );
    });

    test("正しい価格IDが使用される", async () => {
      const userId = "test_user_004";
      const productType = "model_upgrade";
      const mockSession = { id: "cs_test_session_004" };

      mockStripe.checkout.sessions.create.mockResolvedValue(mockSession);

      await stripeService.createCheckoutSession(userId, productType);

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            {
              price: "price_test_premium",
              quantity: 1,
            },
          ],
        })
      );
    });
  });

  describe("セッションメタデータの検証", () => {
    test("userIdがメタデータに含まれる", async () => {
      const userId = "test_user_005";
      const productType = "quota_extension";
      const mockSession = { id: "cs_test_session_005" };

      mockStripe.checkout.sessions.create.mockResolvedValue(mockSession);

      await stripeService.createCheckoutSession(userId, productType);

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            userId,
          }),
        })
      );
    });

    test("productTypeがメタデータに含まれる", async () => {
      const userId = "test_user_006";
      const productType = "quota_extension";
      const mockSession = { id: "cs_test_session_006" };

      mockStripe.checkout.sessions.create.mockResolvedValue(mockSession);

      await stripeService.createCheckoutSession(userId, productType);

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            productType,
          }),
        })
      );
    });

    test("client_reference_idにuserIdが設定される", async () => {
      const userId = "test_user_007";
      const productType = "quota_extension";
      const mockSession = { id: "cs_test_session_007" };

      mockStripe.checkout.sessions.create.mockResolvedValue(mockSession);

      await stripeService.createCheckoutSession(userId, productType);

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          client_reference_id: userId,
        })
      );
    });
  });

  describe("エラーハンドリングの検証", () => {
    test("不正な商品タイプでエラーがスローされる", async () => {
      const userId = "test_user_008";
      const productType = "invalid_type";

      await expect(
        stripeService.createCheckoutSession(userId, productType)
      ).rejects.toThrow("決済処理中にエラーが発生しました");
    });

    test("Stripe認証エラー時にユーザーフレンドリーなメッセージが返される", async () => {
      const userId = "test_user_009";
      const productType = "quota_extension";
      const stripeError = new Error("Authentication failed");
      stripeError.type = "StripeAuthenticationError";

      mockStripe.checkout.sessions.create.mockRejectedValue(stripeError);

      await expect(
        stripeService.createCheckoutSession(userId, productType)
      ).rejects.toThrow(
        "決済システムの認証エラーが発生しました。管理者にお問い合わせください。"
      );
    });

    test("レート制限エラー時にユーザーフレンドリーなメッセージが返される", async () => {
      const userId = "test_user_010";
      const productType = "quota_extension";
      const stripeError = new Error("Rate limit exceeded");
      stripeError.statusCode = 429;

      mockStripe.checkout.sessions.create.mockRejectedValue(stripeError);

      await expect(
        stripeService.createCheckoutSession(userId, productType)
      ).rejects.toThrow(
        "現在、決済システムが混雑しています。しばらく時間をおいてから再度お試しください。"
      );
    });

    test("一般的なエラー時にユーザーフレンドリーなメッセージが返される", async () => {
      const userId = "test_user_011";
      const productType = "quota_extension";
      const stripeError = new Error("Unknown error");

      mockStripe.checkout.sessions.create.mockRejectedValue(stripeError);

      await expect(
        stripeService.createCheckoutSession(userId, productType)
      ).rejects.toThrow(
        "決済処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。"
      );
    });

    test("価格IDが設定されていない場合エラーがスローされる", async () => {
      const userId = "test_user_012";
      const productType = "quota_extension";

      delete process.env.STRIPE_QUOTA_PRICE_ID;

      await expect(
        stripeService.createCheckoutSession(userId, productType)
      ).rejects.toThrow("決済処理中にエラーが発生しました");
    });
  });

  describe("再試行ロジック", () => {
    test("接続エラー時に再試行される", async () => {
      const userId = "test_user_013";
      const productType = "quota_extension";
      const connectionError = new Error("Connection failed");
      connectionError.type = "StripeConnectionError";
      const mockSession = { id: "cs_test_session_013" };

      // 最初の2回は失敗、3回目は成功
      mockStripe.checkout.sessions.create
        .mockRejectedValueOnce(connectionError)
        .mockRejectedValueOnce(connectionError)
        .mockResolvedValueOnce(mockSession);

      const result = await stripeService.createCheckoutSession(
        userId,
        productType
      );

      expect(result).toEqual(mockSession);
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(3);
    });

    test("最大再試行回数を超えるとエラーがスローされる", async () => {
      const userId = "test_user_014";
      const productType = "quota_extension";
      const connectionError = new Error("Connection failed");
      connectionError.type = "StripeConnectionError";

      mockStripe.checkout.sessions.create.mockRejectedValue(connectionError);

      await expect(
        stripeService.createCheckoutSession(userId, productType)
      ).rejects.toThrow();

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(3);
    });
  });

  describe("顧客ポータルセッション作成", () => {
    test("既存のデフォルト configuration を使ってポータルセッションを作成する", async () => {
      mockStripe.billingPortal.configurations.list.mockResolvedValue({
        data: [{ id: "bpc_existing_default" }],
      });
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        url: "https://billing.stripe.com/p/session/test_123",
      });

      const result = await stripeService.createCustomerPortalSession(
        "cus_test_001",
        "https://line.me"
      );

      expect(result).toEqual({
        url: "https://billing.stripe.com/p/session/test_123",
      });
      expect(mockStripe.billingPortal.configurations.create).not.toHaveBeenCalled();
      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        configuration: "bpc_existing_default",
        customer: "cus_test_001",
        return_url: "https://line.me",
      });
    });

    test("configuration がない場合は自動作成してポータルセッションを作成する", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        url: "https://billing.stripe.com/p/session/test_456",
      });

      const result = await stripeService.createCustomerPortalSession(
        "cus_test_002",
        "https://line.me"
      );

      expect(result).toEqual({
        url: "https://billing.stripe.com/p/session/test_456",
      });
      expect(mockStripe.billingPortal.configurations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          default_return_url: "https://line.me",
          features: expect.objectContaining({
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            subscription_cancel: expect.objectContaining({
              enabled: true,
              mode: "at_period_end",
            }),
          }),
        })
      );
      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        configuration: "bpc_test_default",
        customer: "cus_test_002",
        return_url: "https://line.me",
      });
    });
  });
});
