#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LineChatbotStack } from "./line-chatbot-stack";

const app = new cdk.App();

// 環境を取得（デフォルトはdev）
const environment = process.env.ENVIRONMENT || "dev";

// 環境ごとのスタックを作成
new LineChatbotStack(app, `LineChatbotStack-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-northeast-1",
  },
  environment: environment,
});
