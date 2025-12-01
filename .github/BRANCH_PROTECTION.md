# GitHub Branch Protection 設定ガイド

## 概要

このプロジェクトでは、テストが成功した場合のみデプロイが実行されるように、GitHub Actions のワークフローを設定しています。

## ワークフローの構成

### 1. Test ワークフロー (`.github/workflows/test.yml`)

**トリガー条件:**

- `main` または `develop` ブランチへの push
- `main` または `develop` ブランチへの pull request

**実行内容:**

- Node.js 18.x と 20.x でテストを実行
- カバレッジレポートを生成
- Codecov にアップロード

### 2. Deploy ワークフロー (`.github/workflows/deploy.yml`)

**トリガー条件:**

- `main` または `develop` ブランチへの push
- 手動実行 (workflow_dispatch)

**実行内容:**

- AWS へのデプロイ
- **注意**: このワークフローは独立して実行されますが、Branch Protection ルールによりテストが成功した場合のみ push が許可されます

## Branch Protection ルールの設定

GitHub リポジトリの設定で、以下の Branch Protection ルールを設定してください。

### main ブランチ

1. GitHub リポジトリの **Settings** → **Branches** に移動
2. **Add branch protection rule** をクリック
3. 以下の設定を行う:

```
Branch name pattern: main

☑ Require a pull request before merging
  ☑ Require approvals (推奨: 1)
  ☑ Dismiss stale pull request approvals when new commits are pushed

☑ Require status checks to pass before merging
  ☑ Require branches to be up to date before merging

  Status checks that are required:
  - test (Node.js 18.x)
  - test (Node.js 20.x)
  - lint

☑ Require conversation resolution before merging

☑ Do not allow bypassing the above settings
```

### develop ブランチ

同様の設定を `develop` ブランチにも適用します。

```
Branch name pattern: develop

☑ Require status checks to pass before merging
  ☑ Require branches to be up to date before merging

  Status checks that are required:
  - test (Node.js 18.x)
  - test (Node.js 20.x)
  - lint
```

## 動作フロー

### Pull Request の場合

1. 開発者が feature ブランチから `main` または `develop` へ PR を作成
2. **Test ワークフロー**が自動実行される
3. テストが成功すると、PR のステータスチェックが緑色になる
4. Branch Protection により、テストが成功しないとマージできない
5. マージ後、**Deploy ワークフロー**が自動実行される

### Direct Push の場合（推奨しません）

1. `main` または `develop` ブランチへ直接 push
2. Branch Protection により、テストが成功していない場合は push が拒否される
3. push が成功した場合、**Deploy ワークフロー**が自動実行される

## テストが失敗した場合

- PR はマージできません
- `main` または `develop` への直接 push は拒否されます
- デプロイは実行されません

## 手動デプロイ

緊急時には、GitHub Actions の UI から手動でデプロイワークフローを実行できます：

1. GitHub リポジトリの **Actions** タブに移動
2. **Deploy to AWS** ワークフローを選択
3. **Run workflow** をクリック
4. 環境（test または prod）を選択
5. **Run workflow** を実行

**注意**: 手動デプロイの場合でも、テストが成功していることを確認してから実行してください。

## トラブルシューティング

### テストが失敗してマージできない

1. ローカルで `npm test` を実行してテストを確認
2. 失敗したテストを修正
3. 修正をコミット・プッシュ
4. テストが成功するまで繰り返す

### Branch Protection が設定されていない

リポジトリの管理者権限が必要です。管理者に連絡して設定を依頼してください。

## 参考資料

- [GitHub Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Actions Status Checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)
