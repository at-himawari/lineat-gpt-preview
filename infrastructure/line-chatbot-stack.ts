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

    // Lambda関数
    const webhookFunction = new lambda.Function(this, "WebhookFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handlers/webhook.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src")),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: logGroup,
      environment: {
        LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
        LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET || "",
        AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY || "",
        AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT || "",
        AZURE_OPENAI_DEPLOYMENT_NAME:
          process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "",
        DB_HOST: process.env.DB_HOST || "",
        DB_USER: process.env.DB_USER || "",
        DB_PASSWORD: process.env.DB_PASSWORD || "",
        DB_NAME: process.env.DB_NAME || "",
        SKIP_SIGNATURE_VALIDATION:
          process.env.SKIP_SIGNATURE_VALIDATION || "false",
      },
    });

    // API Gateway
    const api = new apigateway.RestApi(this, "LineChatbotApi", {
      restApiName: "LINE Chatbot API",
      description: "API for LINE Chatbot with Azure OpenAI",
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

    // /webhook エンドポイント
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

    // 出力
    new cdk.CfnOutput(this, "ApiGatewayUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: `${api.url}webhook`,
      description: "LINE Webhook URL",
    });
  }
}
