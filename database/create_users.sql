-- テスト環境用ユーザーの作成
CREATE USER IF NOT EXISTS 'lineat_gpt_test_user'@'%' IDENTIFIED BY 'your_test_password_here';
GRANT ALL PRIVILEGES ON lineat_gpt_test.* TO 'lineat_gpt_test_user'@'%';

-- 本番環境用ユーザーの作成
CREATE USER IF NOT EXISTS 'lineat_gpt_prod_user'@'%' IDENTIFIED BY 'your_prod_password_here';
GRANT ALL PRIVILEGES ON lineat_gpt_prod.* TO 'lineat_gpt_prod_user'@'%';

-- 権限を反映
FLUSH PRIVILEGES;

-- 作成されたユーザーの確認
SELECT User, Host FROM mysql.user WHERE User LIKE 'lineat_gpt%';
