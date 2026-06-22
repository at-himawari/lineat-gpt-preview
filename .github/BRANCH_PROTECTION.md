# GitHub Branch Protection 設定ガイド

## 概要

このプロジェクトでは、テストが成功した場合のみデプロイが実行されるように、GitHub Actions のワークフローを設定しています。

## ワークフローの構成

### CI/CD ワークフロー (`.github/workflows/ci-cd.yml`)

**トリガー条件:**

- `main` または `develop` ブランチへの push
- `main` または `develop` ブランチへの pull request
- 手動実行 (workflow_dispatch)

**ジョブ構成:**

1. **CI ジョブ**

   - Node.js 20.x で依存関係を固定インストール
   - ルートと `src` の `npm audit --audit-level=high` を実行
   - CDK TypeScript ビルドと `dev` スタックの synth を実行
   - Lambda の Jest テストをカバレッジ付きで実行
   - カバレッジを GitHub Actions artifact として保存

2. **Deploy ジョブ** (`needs: ci`)
   - **CI ジョブが成功した場合のみ実行**
   - AWS へのデプロイ
   - 環境: main → prod、develop → dev
   - 手動実行時は `dev` または `prod` を選択

**重要**: `needs: ci` により、CI ジョブが成功しない限り Deploy ジョブは実行されません。検証が失敗した場合、デプロイは自動的にスキップされます。

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
  - CI

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
  - CI
```

## 動作フロー

### Pull Request の場合

1. 開発者が feature ブランチから `main` または `develop` へ PR を作成
2. **CI/CD ワークフローの CI ジョブ**が自動実行される
3. テストが成功すると、PR のステータスチェックが緑色になる
4. Branch Protection により、テストが成功しないとマージできない
5. マージ後、**CI/CD ワークフローの CI ジョブ**が再度実行される
6. CI ジョブが成功すると、同じワークフロー内の Deploy ジョブが実行される
7. Deploy ジョブが `main` は `prod`、`develop` は `dev` にデプロイする

### Direct Push の場合（推奨しません）

1. `main` または `develop` ブランチへ直接 push
2. Branch Protection により、テストが成功していない場合は push が拒否される
3. push が成功した場合、**CI/CD ワークフローの CI ジョブ**が実行される
4. CI ジョブが成功すると、同じワークフロー内の Deploy ジョブが実行される
5. Deploy ジョブが対象環境へデプロイする

## テストが失敗した場合

- PR はマージできません
- `main` または `develop` への直接 push は拒否されます
- デプロイは実行されません

## 手動デプロイ

緊急時には、GitHub Actions の UI から手動でデプロイワークフローを実行できます：

1. GitHub リポジトリの **Actions** タブに移動
2. **Deploy to AWS** ワークフローを選択
3. **Run workflow** をクリック
4. 環境（dev または prod）を選択
5. **Run workflow** を実行

**注意**: 手動デプロイの場合でも、テストが成功していることを確認してから実行してください。

## トラブルシューティング

### テストが失敗してマージできない

1. ローカルで `cd src && npm test` を実行してテストを確認
2. 失敗したテストを修正
3. 修正をコミット・プッシュ
4. テストが成功するまで繰り返す

### Branch Protection が設定されていない

リポジトリの管理者権限が必要です。管理者に連絡して設定を依頼してください。

## 参考資料

- [GitHub Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Actions Status Checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)
