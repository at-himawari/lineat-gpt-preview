module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/__tests__/setup.js"],
  collectCoverageFrom: [
    "services/**/*.js",
    "handlers/**/*.js",
    "!**/__tests__/**",
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  // カバレッジ閾値: 購入導線とカウントロジックのテストに焦点を当てているため、
  // 全体の閾値は設定せず、重要なファイルのみ監視
  coverageThreshold: {
    "./services/database.js": {
      branches: 30,
      functions: 20,
      lines: 30,
      statements: 30,
    },
    "./services/stripe.js": {
      branches: 60,
      functions: 40,
      lines: 45,
      statements: 45,
    },
  },
  testTimeout: 10000,
  verbose: true,
};
