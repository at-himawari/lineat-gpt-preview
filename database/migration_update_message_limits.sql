-- プレミアムプラン専用の1日100件制限への移行
-- 実行日: 2025-12-01

-- 既存ユーザーのメッセージカウントをリセット
-- これにより、全ユーザーが新しい制限で再スタートします
UPDATE users SET message_count_3days = 0, count_reset_at = NOW();

-- デフォルト値を0に変更（新規ユーザー用）
ALTER TABLE users MODIFY COLUMN message_count_3days INT DEFAULT 0;

-- 変更内容の確認
SELECT 
  COUNT(*) as total_users,
  SUM(CASE WHEN has_premium_model = 1 AND subscription_status = 'active' THEN 1 ELSE 0 END) as premium_users,
  SUM(CASE WHEN has_premium_model = 0 OR subscription_status != 'active' THEN 1 ELSE 0 END) as non_premium_users
FROM users;
