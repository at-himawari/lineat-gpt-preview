// テスト環境のセットアップ

// 環境変数のモック設定
process.env.NODE_ENV = "test";
process.env.DB_HOST = "localhost";
process.env.DB_USER = "test_user";
process.env.DB_PASSWORD = "test_password";
process.env.DB_NAME = "test_db";
process.env.STRIPE_SECRET_KEY = "sk_test_mock";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_mock";
process.env.STRIPE_QUOTA_PRICE_ID = "price_test_quota";
process.env.STRIPE_PREMIUM_PRICE_ID = "price_test_premium";
process.env.MESSAGE_LIMIT_1DAY_PREMIUM = "100";
process.env.MESSAGE_LIMIT_1DAY = "30";
process.env.MESSAGE_QUOTA_EXTENSION = "300";
process.env.GEMINI_API_KEY = "test_gemini_key";
process.env.GEMINI_BASIC_MODEL = "gemini-2.0-flash-exp";
process.env.GEMINI_PREMIUM_MODEL = "gemini-2.0-flash-thinking-exp-01-21";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test_line_token";
process.env.LINE_CHANNEL_SECRET = "test_line_secret";

// グローバルタイムアウトの設定
jest.setTimeout(10000);

// コンソール出力の抑制（必要に応じて）
global.console = {
  ...console,
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
