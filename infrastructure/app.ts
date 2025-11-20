#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LineChatbotStack } from "./line-chatbot-stack";

const app = new cdk.App();

new LineChatbotStack(app, "LineChatbotStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-northeast-1",
  },
});
