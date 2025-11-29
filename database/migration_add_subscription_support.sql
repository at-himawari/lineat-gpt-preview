-- サブスクリプション対応のためのデータベースマイグレーション

-- usersテーブルにサブスクリプション関連カラムを追加
ALTER TABLE users
ADD COLUMN stripe_customer_id VARCHAR(255) NULL AFTER premium_activated_at,
ADD COLUMN stripe_subscription_id VARCHAR(255) NULL AFTER stripe_customer_id,
ADD COLUMN subscription_status ENUM('active', 'canceled', 'past_due', 'unpaid', 'trialing') NULL AFTER stripe_subscription_id,
ADD COLUMN subscription_current_period_end TIMESTAMP NULL AFTER subscription_status,
ADD INDEX idx_stripe_customer_id (stripe_customer_id),
ADD INDEX idx_stripe_subscription_id (stripe_subscription_id);

-- transactionsテーブルにサブスクリプション関連カラムを追加
ALTER TABLE transactions
ADD COLUMN stripe_customer_id VARCHAR(255) NULL AFTER stripe_session_id,
ADD COLUMN stripe_subscription_id VARCHAR(255) NULL AFTER stripe_customer_id,
ADD INDEX idx_stripe_subscription_id (stripe_subscription_id);
