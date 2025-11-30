# データベースユーザーの作成手順

このドキュメントでは、テスト環境と本番環境用の MySQL ユーザーを作成する手順を説明します。

## 概要

- **テスト環境用ユーザー**: `lineat_gpt_test_user`

  - データベース: `lineat_gpt_test`
  - 権限: `lineat_gpt_test.*` に対する全権限

- **本番環境用ユーザー**: `lineat_gpt_prod_user`
  - データベース: `lineat_gpt_prod`
  - 権限: `lineat_gpt_prod.*` に対する全権限

## 前提条件

- MySQL サーバーへの管理者権限でのアクセス
- root ユーザーまたはユーザー作成権限を持つアカウント

## 手順

### 1. パスワードの決定

まず、各環境用の強力なパスワードを決定してください。

```bash
# パスワード生成例（オプション）
openssl rand -base64 32
```

### 2. SQL スクリプトの編集

`database/create_users.sql` ファイルを開き、パスワードを設定します：

```sql
-- テスト環境用ユーザーの作成
CREATE USER IF NOT EXISTS 'lineat_gpt_test_user'@'%' IDENTIFIED BY 'your_test_password_here';
GRANT ALL PRIVILEGES ON lineat_gpt_test.* TO 'lineat_gpt_test_user'@'%';

-- 本番環境用ユーザーの作成
CREATE USER IF NOT EXISTS 'lineat_gpt_prod_user'@'%' IDENTIFIED BY 'your_prod_password_here';
GRANT ALL PRIVILEGES ON lineat_gpt_prod.* TO 'lineat_gpt_prod_user'@'%';

FLUSH PRIVILEGES;
```

`your_test_password_here` と `your_prod_password_here` を実際のパスワードに置き換えてください。

### 3. ユーザーの作成

MySQL サーバーに接続して SQL スクリプトを実行します：

```bash
# rootユーザーで接続
mysql -h your_db_host -u root -p

# または、SQLファイルを直接実行
mysql -h your_db_host -u root -p < database/create_users.sql
```

### 4. ユーザーの確認

作成されたユーザーを確認します：

```sql
SELECT User, Host FROM mysql.user WHERE User LIKE 'lineat_gpt%';
```

期待される出力：

```
+----------------------+------+
| User                 | Host |
+----------------------+------+
| lineat_gpt_test_user | %    |
| lineat_gpt_prod_user | %    |
+----------------------+------+
```

### 5. 権限の確認

各ユーザーの権限を確認します：

```sql
SHOW GRANTS FOR 'lineat_gpt_test_user'@'%';
SHOW GRANTS FOR 'lineat_gpt_prod_user'@'%';
```

### 6. 接続テスト

作成したユーザーで接続できることを確認します：

```bash
# テスト環境用ユーザー
mysql -h your_db_host -u lineat_gpt_test_user -p

# 本番環境用ユーザー
mysql -h your_db_host -u lineat_gpt_prod_user -p
```

### 7. 環境変数の設定

`.env.dev` と `.env.prod` ファイルに認証情報を設定します：

**テスト環境 (.env.dev)**

```bash
DB_HOST=your_db_host
DB_USER=lineat_gpt_test_user
DB_PASSWORD=your_test_password_here
DB_NAME=lineat_gpt_test
```

**本番環境 (.env.prod)**

```bash
DB_HOST=your_db_host
DB_USER=lineat_gpt_prod_user
DB_PASSWORD=your_prod_password_here
DB_NAME=lineat_gpt_prod
```

## セキュリティのベストプラクティス

1. **強力なパスワード**: 最低 16 文字以上の複雑なパスワードを使用
2. **最小権限の原則**: 各ユーザーは自分のデータベースにのみアクセス可能
3. **接続元の制限**: 可能であれば `'%'` の代わりに特定の IP アドレスを指定
4. **パスワードの管理**:
   - `.env` ファイルは `.gitignore` に含める
   - AWS Secrets Manager や Parameter Store の使用を検討

## トラブルシューティング

### ユーザーが既に存在する場合

```sql
-- ユーザーを削除して再作成
DROP USER IF EXISTS 'lineat_gpt_test_user'@'%';
DROP USER IF EXISTS 'lineat_gpt_prod_user'@'%';
```

その後、再度作成スクリプトを実行してください。

### 接続できない場合

1. ホスト名が正しいか確認
2. ファイアウォール設定を確認
3. MySQL サーバーがリモート接続を許可しているか確認
4. ユーザーのホスト設定（`%` または特定の IP）を確認

### 権限が不足している場合

```sql
-- 権限を再付与
GRANT ALL PRIVILEGES ON lineat_gpt_test.* TO 'lineat_gpt_test_user'@'%';
GRANT ALL PRIVILEGES ON lineat_gpt_prod.* TO 'lineat_gpt_prod_user'@'%';
FLUSH PRIVILEGES;
```

## 次のステップ

ユーザー作成後は、以下のドキュメントを参照してデータベースをセットアップしてください：

- [DATABASE_SETUP.md](./DATABASE_SETUP.md) - データベースのセットアップ
- [DEPLOYMENT.md](./DEPLOYMENT.md) - デプロイ手順
