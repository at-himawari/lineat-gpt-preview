import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";

export class LineChatbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda実行ロール
    const lambdaRole = new iam.Role(this, "LineChatbotLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    // CloudWatch Logsグループ
    const logGroup = new logs.LogGroup(this, "LineChatbotLogGroup", {
      logGroupName: "/aws/lambda/line-chatbot-webhook",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda関数（LINE Webhook）
    const webhookFunction = new lambda.Function(this, "WebhookFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handlers/webhook.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src")),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: logGroup,
      description: `Deployed at ${new Date().toISOString()}`,
      environment: {
        LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
        LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET || "",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
        GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        GEMINI_MAX_TOKENS: process.env.GEMINI_MAX_TOKENS || "8000",
        GEMINI_TEMPERATURE: process.env.GEMINI_TEMPERATURE || "1",
        GEMINI_RESPONSE_CHAR_LIMIT:
          process.env.GEMINI_RESPONSE_CHAR_LIMIT || "500",
        GEMINI_BASIC_MODEL:
          process.env.GEMINI_BASIC_MODEL || "gemini-2.0-flash-exp",
        GEMINI_PREMIUM_MODEL:
          process.env.GEMINI_PREMIUM_MODEL ||
          "gemini-2.0-flash-thinking-exp-01-21",
        DB_HOST: process.env.DB_HOST || "",
        DB_USER: process.env.DB_USER || "",
        DB_PASSWORD: process.env.DB_PASSWORD || "",
        DB_NAME: process.env.DB_NAME || "",
        SKIP_SIGNATURE_VALIDATION:
          process.env.SKIP_SIGNATURE_VALIDATION || "false",
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
        STRIPE_QUOTA_PRICE_ID: process.env.STRIPE_QUOTA_PRICE_ID || "",
        STRIPE_PREMIUM_PRICE_ID: process.env.STRIPE_PREMIUM_PRICE_ID || "",
        STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL || "",
        STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL || "",
      },
    });

    // CloudWatch Logsグループ（Stripe Webhook用）
    const stripeLogGroup = new logs.LogGroup(this, "StripeWebhookLogGroup", {
      logGroupName: "/aws/lambda/stripe-webhook-handler",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda関数（Stripe Webhook）
    const stripeWebhookFunction = new lambda.Function(
      this,
      "StripeWebhookFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "handlers/stripe-webhook.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../src")),
        role: lambdaRole,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        logGroup: stripeLogGroup,
        environment: {
          STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
          STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
          DB_HOST: process.env.DB_HOST || "",
          DB_USER: process.env.DB_USER || "",
          DB_PASSWORD: process.env.DB_PASSWORD || "",
          DB_NAME: process.env.DB_NAME || "",
        },
      }
    );

    // API Gateway
    const api = new apigateway.RestApi(this, "LineChatbotApi", {
      restApiName: "LINE Chatbot API",
      description: "API for LINE Chatbot with Google Gemini",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Lambda統合（プロキシ統合）
    const lambdaIntegration = new apigateway.LambdaIntegration(
      webhookFunction,
      {
        proxy: true,
        integrationResponses: [
          {
            statusCode: "200",
          },
        ],
      }
    );

    // /webhook エンドポイント（LINE用）
    const webhookResource = api.root.addResource("webhook");
    webhookResource.addMethod("POST", lambdaIntegration, {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Content-Type": true,
          },
        },
      ],
    });

    // Lambda統合（Stripe Webhook用）
    const stripeLambdaIntegration = new apigateway.LambdaIntegration(
      stripeWebhookFunction,
      {
        proxy: true,
        integrationResponses: [
          {
            statusCode: "200",
          },
        ],
      }
    );

    // /stripe/webhook エンドポイント
    const stripeResource = api.root.addResource("stripe");
    const stripeWebhookResource = stripeResource.addResource("webhook");
    stripeWebhookResource.addMethod("POST", stripeLambdaIntegration, {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Content-Type": true,
          },
        },
      ],
    });

    // 出力
    new cdk.CfnOutput(this, "ApiGatewayUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: `${api.url}webhook`,
      description: "LINE Webhook URL",
    });

    new cdk.CfnOutput(this, "StripeWebhookUrl", {
      value: `${api.url}stripe/webhook`,
      description: "Stripe Webhook URL",
    });
  }
}
