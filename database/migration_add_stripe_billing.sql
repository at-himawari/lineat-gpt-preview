-- Stripe決済機能のためのデータベースマイグレーション

-- 1. usersテーブルにプレミアムモデル関連カラムを追加
ALTER TABLE users 
MODIFY COLUMN message_count_3days INT DEFAULT 300,
ADD COLUMN has_premium_model BOOLEAN DEFAULT FALSE AFTER count_reset_at,
ADD COLUMN premium_activated_at TIMESTAMP NULL AFTER has_premium_model;

-- 2. transactionsテーブルを作成
CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stripe_session_id VARCHAR(255) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  product_type ENUM('quota_extension', 'model_upgrade') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'JPY',
  status ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  metadata JSON,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_session_id (stripe_session_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 既存ユーザーの枠を100から300に更新
UPDATE users SET message_count_3days = 300 WHERE message_count_3days < 300;
