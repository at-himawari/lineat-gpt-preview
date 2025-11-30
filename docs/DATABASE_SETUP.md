# データベース環境別セットアップガイド

このドキュメントでは、テスト環境と本番環境で別々のデータベースを構築する方法を説明します。

## 概要

テスト環境と本番環境で独立したデータベースを使用することで、以下のメリットがあります：

- テストデータが本番データに影響を与えない
- 本番データを安全に保護できる
- マイグレーションやスキーマ変更をテスト環境で検証できる
- 環境ごとに異なる設定（接続数、バックアップ頻度など）を適用できる

## データベース構成

### 推奨構成

| 環境       | データベース名      | ホスト             | 用途                 |
| ---------- | ------------------- | ------------------ | -------------------- |
| テスト環境 | `line_chatbot_dev`  | 開発用 DB サーバー | 開発・テスト用       |
| 本番環境   | `line_chatbot_prod` | 本番用 DB サーバー | 実際のユーザーデータ |

### オプション 1: 同じ MySQL サーバーで異なるデータベース

コスト削減のため、同じ MySQL サーバーで異なるデータベース名を使用する方法：

```sql
-- テスト環境用データベース
CREATE DATABASE line_chatbot_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 本番環境用データベース
CREATE DATABASE line_chatbot_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- テスト環境用ユーザー（オプション）
CREATE USER 'chatbot_dev'@'%' IDENTIFIED BY 'dev_password';
GRANT ALL PRIVILEGES ON line_chatbot_dev.* TO 'chatbot_dev'@'%';

-- 本番環境用ユーザー（オプション）
CREATE USER 'chatbot_prod'@'%' IDENTIFIED BY 'prod_password';
GRANT ALL PRIVILEGES ON line_chatbot_prod.* TO 'chatbot_prod'@'%';

FLUSH PRIVILEGES;
```

### オプション 2: 完全に独立した MySQL サーバー

より安全な方法として、完全に独立した MySQL サーバーを使用：

- **テスト環境**: 開発用の MySQL サーバー（例: `dev-mysql.example.com`）
- **本番環境**: 本番用の MySQL サーバー（例: `prod-mysql.example.com`）

## セットアップ手順

### クイックスタート（推奨）

環境変数ファイル（`.env.dev`または`.env.prod`）を設定した後、セットアップスクリプトを実行するだけで自動的にデータベースをセットアップできます：

```bash
# テスト環境
./database/setup_dev.sh

# 本番環境（要注意！）
./database/setup_prod.sh
```

スクリプトは以下の処理を自動的に行います：

- データベース接続テスト
- データベースの作成（存在しない場合）
- 初期スキーマの適用
- すべてのマイグレーションの適用
- テーブル一覧の表示

### 手動セットアップ

スクリプトを使用せず、手動でセットアップする場合は以下の手順に従ってください。

### 1. データベースの作成

#### テスト環境用データベース

```bash
# MySQLに接続
mysql -h your_dev_mysql_host -u root -p

# データベース作成
CREATE DATABASE line_chatbot_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# ユーザー作成（オプション）
CREATE USER 'chatbot_dev'@'%' IDENTIFIED BY 'your_dev_password';
GRANT ALL PRIVILEGES ON line_chatbot_dev.* TO 'chatbot_dev'@'%';
FLUSH PRIVILEGES;

# 接続確認
USE line_chatbot_dev;
```

#### 本番環境用データベース

```bash
# MySQLに接続
mysql -h your_prod_mysql_host -u root -p

# データベース作成
CREATE DATABASE line_chatbot_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# ユーザー作成（オプション）
CREATE USER 'chatbot_prod'@'%' IDENTIFIED BY 'your_prod_password';
GRANT ALL PRIVILEGES ON line_chatbot_prod.* TO 'chatbot_prod'@'%';
FLUSH PRIVILEGES;

# 接続確認
USE line_chatbot_prod;
```

### 2. スキーマの適用

#### テスト環境

```bash
# 初期スキーマ
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/schema.sql

# Stripe課金機能のマイグレーション
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/migration_add_stripe_billing.sql

# サブスクリプション機能のマイグレーション
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/migration_add_subscription_support.sql

# メッセージ制限の更新
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/migration_add_message_limit.sql
```

#### 本番環境

```bash
# 初期スキーマ
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/schema.sql

# Stripe課金機能のマイグレーション
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/migration_add_stripe_billing.sql

# サブスクリプション機能のマイグレーション
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/migration_add_subscription_support.sql

# メッセージ制限の更新
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/migration_add_message_limit.sql
```

### 3. 環境変数の設定

#### テスト環境（.env.dev）

```bash
# MySQL設定（テスト環境）
DB_HOST=your_dev_mysql_host
DB_USER=lineat_gpt_test_user
DB_PASSWORD=your_test_password_here
DB_NAME=lineat_gpt_test
```

#### 本番環境（.env.prod）

```bash
# MySQL設定（本番環境）
DB_HOST=your_prod_mysql_host
DB_USER=lineat_gpt_prod_user
DB_PASSWORD=your_prod_password_here
DB_NAME=lineat_gpt_prod
```

### 4. 接続テスト

#### テスト環境

```bash
# MySQLクライアントで接続確認
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev

# テーブル確認
SHOW TABLES;

# スキーマ確認
DESCRIBE users;
DESCRIBE messages;
DESCRIBE transactions;
DESCRIBE subscriptions;
```

#### 本番環境

```bash
# MySQLクライアントで接続確認
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod

# テーブル確認
SHOW TABLES;

# スキーマ確認
DESCRIBE users;
DESCRIBE messages;
DESCRIBE transactions;
DESCRIBE subscriptions;
```

## マイグレーション管理

### 新しいマイグレーションの適用手順

1. **テスト環境で検証**

   ```bash
   # テスト環境に適用
   mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/new_migration.sql

   # 動作確認
   # アプリケーションをテスト環境にデプロイして動作確認
   ```

2. **本番環境に適用**

   ```bash
   # バックアップを取得（重要！）
   mysqldump -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod > backup_$(date +%Y%m%d_%H%M%S).sql

   # 本番環境に適用
   mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/new_migration.sql
   ```

### マイグレーションのロールバック

問題が発生した場合のロールバック手順：

```bash
# バックアップから復元
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < backup_20241130_120000.sql
```

## データベースバックアップ

### テスト環境

テスト環境は定期的なバックアップは不要ですが、重要なテストデータがある場合は手動でバックアップ：

```bash
# 手動バックアップ
mysqldump -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev > dev_backup_$(date +%Y%m%d).sql
```

### 本番環境

本番環境は必ず定期的なバックアップを設定してください：

```bash
# 日次バックアップスクリプト例
#!/bin/bash
BACKUP_DIR="/path/to/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/prod_backup_$DATE.sql"

# バックアップ実行
mysqldump -h your_prod_mysql_host -u chatbot_prod -p'your_prod_password' line_chatbot_prod > $BACKUP_FILE

# 圧縮
gzip $BACKUP_FILE

# 7日以上前のバックアップを削除
find $BACKUP_DIR -name "prod_backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE.gz"
```

cron で自動実行：

```bash
# crontabに追加（毎日午前3時に実行）
0 3 * * * /path/to/backup_script.sh
```

## セキュリティのベストプラクティス

### 1. ユーザー権限の最小化

本番環境では、アプリケーション用ユーザーに必要最小限の権限のみを付与：

```sql
-- 本番環境用ユーザー（DDL権限なし）
CREATE USER 'chatbot_prod_app'@'%' IDENTIFIED BY 'secure_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON line_chatbot_prod.* TO 'chatbot_prod_app'@'%';
FLUSH PRIVILEGES;
```

### 2. SSL/TLS 接続の使用

可能であれば、データベース接続に SSL/TLS を使用：

```javascript
// src/services/database.jsでの設定例
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: true,
  },
});
```

### 3. 接続情報の管理

- 環境変数ファイル（`.env.dev`、`.env.prod`）は絶対に Git にコミットしない
- 本番環境の接続情報は暗号化されたストレージに保存
- GitHub Secrets を使用して CI/CD で安全に管理

### 4. ネットワークセキュリティ

- データベースサーバーのファイアウォールで、Lambda 関数の IP アドレスのみを許可
- 可能であれば、VPC 内にデータベースを配置

## トラブルシューティング

### 接続エラー

```bash
# 接続テスト
mysql -h your_db_host -u your_db_user -p your_db_name

# エラーが出る場合の確認事項：
# 1. ホスト名が正しいか
# 2. ユーザー名とパスワードが正しいか
# 3. データベース名が正しいか
# 4. ファイアウォールでポート3306が開いているか
# 5. ユーザーに適切な権限があるか
```

### 権限エラー

```sql
-- ユーザーの権限確認
SHOW GRANTS FOR 'chatbot_dev'@'%';

-- 権限が不足している場合は追加
GRANT ALL PRIVILEGES ON line_chatbot_dev.* TO 'chatbot_dev'@'%';
FLUSH PRIVILEGES;
```

### マイグレーションエラー

```bash
# マイグレーション適用前に構文チェック
mysql -h your_db_host -u your_db_user -p your_db_name --execute="SOURCE database/migration.sql" --verbose

# エラーが出た場合は、SQLファイルを確認して修正
```

## AWS RDS を使用する場合

AWS RDS for MySQL を使用する場合の推奨設定：

### テスト環境

- **インスタンスタイプ**: db.t3.micro または db.t4g.micro（無料枠対象）
- **ストレージ**: 20GB（無料枠対象）
- **バックアップ**: 1 日保持
- **Multi-AZ**: 無効
- **パブリックアクセス**: 有効（開発用）

### 本番環境

- **インスタンスタイプ**: db.t3.small 以上（負荷に応じて）
- **ストレージ**: 100GB 以上（自動スケーリング有効）
- **バックアップ**: 7 日保持
- **Multi-AZ**: 有効（高可用性）
- **パブリックアクセス**: 無効（VPC 内からのみアクセス）
- **暗号化**: 有効

### RDS の作成例

```bash
# テスト環境用RDS
aws rds create-db-instance \
  --db-instance-identifier line-chatbot-dev \
  --db-instance-class db.t3.micro \
  --engine mysql \
  --master-username admin \
  --master-user-password your_password \
  --allocated-storage 20 \
  --db-name line_chatbot_dev \
  --backup-retention-period 1 \
  --no-multi-az \
  --publicly-accessible

# 本番環境用RDS
aws rds create-db-instance \
  --db-instance-identifier line-chatbot-prod \
  --db-instance-class db.t3.small \
  --engine mysql \
  --master-username admin \
  --master-user-password your_secure_password \
  --allocated-storage 100 \
  --db-name line_chatbot_prod \
  --backup-retention-period 7 \
  --multi-az \
  --no-publicly-accessible \
  --storage-encrypted
```

## まとめ

- テスト環境と本番環境で異なるデータベースを使用してください
- 同じ MySQL サーバーで異なるデータベース名を使用するか、完全に独立したサーバーを使用できます
- マイグレーションは必ずテスト環境で検証してから本番環境に適用してください
- 本番環境のデータベースは定期的にバックアップを取得してください
- セキュリティのベストプラクティスに従って、接続情報を安全に管理してください
