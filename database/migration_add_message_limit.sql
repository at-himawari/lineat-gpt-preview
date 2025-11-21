-- 既存のusersテーブルに3日間のメッセージ制限用のカラムを追加
ALTER TABLE users 
ADD COLUMN message_count_3days INT DEFAULT 0 AFTER line_user_id,
ADD COLUMN count_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER message_count_3days;

-- 既存ユーザーのcount_reset_atを現在時刻に設定
UPDATE users SET count_reset_at = NOW() WHERE count_reset_at IS NULL;
