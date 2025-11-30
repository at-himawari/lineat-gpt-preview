"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LineChatbotStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const path = __importStar(require("path"));
class LineChatbotStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const env = props.environment;
        // Lambda実行ロール
        const lambdaRole = new iam.Role(this, "LineChatbotLambdaRole", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
            ],
        });
        // CloudWatch Logsグループ
        const logGroup = new logs.LogGroup(this, "LineChatbotLogGroup", {
            logGroupName: `/aws/lambda/line-chatbot-webhook-${env}`,
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
                GEMINI_RESPONSE_CHAR_LIMIT: process.env.GEMINI_RESPONSE_CHAR_LIMIT || "500",
                GEMINI_BASIC_MODEL: process.env.GEMINI_BASIC_MODEL || "gemini-2.0-flash-exp",
                GEMINI_PREMIUM_MODEL: process.env.GEMINI_PREMIUM_MODEL ||
                    "gemini-2.0-flash-thinking-exp-01-21",
                DB_HOST: process.env.DB_HOST || "",
                DB_USER: process.env.DB_USER || "",
                DB_PASSWORD: process.env.DB_PASSWORD || "",
                DB_NAME: process.env.DB_NAME || "",
                SKIP_SIGNATURE_VALIDATION: process.env.SKIP_SIGNATURE_VALIDATION || "false",
                STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
                STRIPE_QUOTA_PRICE_ID: process.env.STRIPE_QUOTA_PRICE_ID || "",
                STRIPE_PREMIUM_PRICE_ID: process.env.STRIPE_PREMIUM_PRICE_ID || "",
                STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL || "",
                STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL || "",
            },
        });
        // CloudWatch Logsグループ（Stripe Webhook用）
        const stripeLogGroup = new logs.LogGroup(this, "StripeWebhookLogGroup", {
            logGroupName: `/aws/lambda/stripe-webhook-handler-${env}`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Lambda関数（Stripe Webhook）
        const stripeWebhookFunction = new lambda.Function(this, "StripeWebhookFunction", {
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
        });
        // API Gateway
        const api = new apigateway.RestApi(this, "LineChatbotApi", {
            restApiName: `LINE Chatbot API (${env})`,
            description: `API for LINE Chatbot with Google Gemini - ${env} environment`,
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
            },
        });
        // Lambda統合（プロキシ統合）
        const lambdaIntegration = new apigateway.LambdaIntegration(webhookFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: "200",
                },
            ],
        });
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
        const stripeLambdaIntegration = new apigateway.LambdaIntegration(stripeWebhookFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: "200",
                },
            ],
        });
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
exports.LineChatbotStack = LineChatbotStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGluZS1jaGF0Ym90LXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGluZS1jaGF0Ym90LXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQsdUVBQXlEO0FBQ3pELHlEQUEyQztBQUMzQywyREFBNkM7QUFFN0MsMkNBQTZCO0FBTTdCLE1BQWEsZ0JBQWlCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDN0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE0QjtRQUNwRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsV0FBVyxDQUFDO1FBRTlCLGNBQWM7UUFDZCxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQzdELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDeEMsMENBQTBDLENBQzNDO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxzQkFBc0I7UUFDdEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUM5RCxZQUFZLEVBQUUsb0NBQW9DLEdBQUcsRUFBRTtZQUN2RCxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO1lBQ3RDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgseUJBQXlCO1FBQ3pCLE1BQU0sZUFBZSxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUs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VyxFQUFFLGlCQUFpQjtTQUMvQixDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwQyxLQUFLLEVBQUUsR0FBRyxHQUFHLENBQUMsR0FBRyxTQUFTO1lBQzFCLFdBQVcsRUFBRSxrQkFBa0I7U0FDaEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsR0FBRyxHQUFHLENBQUMsR0FBRyxnQkFBZ0I7WUFDakMsV0FBVyxFQUFFLG9CQUFvQjtTQUNsQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUExS0QsNENBMEtDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcblxuaW50ZXJmYWNlIExpbmVDaGF0Ym90U3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIExpbmVDaGF0Ym90U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTGluZUNoYXRib3RTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBlbnYgPSBwcm9wcy5lbnZpcm9ubWVudDtcblxuICAgIC8vIExhbWJkYeWun+ihjOODreODvOODq1xuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgXCJMaW5lQ2hhdGJvdExhbWJkYVJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcbiAgICAgICAgKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZ3PjgrDjg6vjg7zjg5dcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIFwiTGluZUNoYXRib3RMb2dHcm91cFwiLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2xhbWJkYS9saW5lLWNoYXRib3Qtd2ViaG9vay0ke2Vudn1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRh6Zai5pWw77yITElORSBXZWJob29r77yJXG4gICAgY29uc3Qgd2ViaG9va0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIldlYmhvb2tGdW5jdGlvblwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlcnMvd2ViaG9vay5oYW5kbGVyXCIsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi9zcmNcIikpLFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGxvZ0dyb3VwOiBsb2dHcm91cCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgRGVwbG95ZWQgYXQgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9YCxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIExJTkVfQ0hBTk5FTF9BQ0NFU1NfVE9LRU46IHByb2Nlc3MuZW52LkxJTkVfQ0hBTk5FTF9BQ0NFU1NfVE9LRU4gfHwgXCJcIixcbiAgICAgICAgTElORV9DSEFOTkVMX1NFQ1JFVDogcHJvY2Vzcy5lbnYuTElORV9DSEFOTkVMX1NFQ1JFVCB8fCBcIlwiLFxuICAgICAgICBHRU1JTklfQVBJX0tFWTogcHJvY2Vzcy5lbnYuR0VNSU5JX0FQSV9LRVkgfHwgXCJcIixcbiAgICAgICAgR0VNSU5JX01PREVMOiBwcm9jZXNzLmVudi5HRU1JTklfTU9ERUwgfHwgXCJnZW1pbmktMi41LWZsYXNoXCIsXG4gICAgICAgIEdFTUlOSV9NQVhfVE9LRU5TOiBwcm9jZXNzLmVudi5HRU1JTklfTUFYX1RPS0VOUyB8fCBcIjgwMDBcIixcbiAgICAgICAgR0VNSU5JX1RFTVBFUkFUVVJFOiBwcm9jZXNzLmVudi5HRU1JTklfVEVNUEVSQVRVUkUgfHwgXCIxXCIsXG4gICAgICAgIEdFTUlOSV9SRVNQT05TRV9DSEFSX0xJTUlUOlxuICAgICAgICAgIHByb2Nlc3MuZW52LkdFTUlOSV9SRVNQT05TRV9DSEFSX0xJTUlUIHx8IFwiNTAwXCIsXG4gICAgICAgIEdFTUlOSV9CQVNJQ19NT0RFTDpcbiAgICAgICAgICBwcm9jZXNzLmVudi5HRU1JTklfQkFTSUNfTU9ERUwgfHwgXCJnZW1pbmktMi4wLWZsYXNoLWV4cFwiLFxuICAgICAgICBHRU1JTklfUFJFTUlVTV9NT0RFTDpcbiAgICAgICAgICBwcm9jZXNzLmVudi5HRU1JTklfUFJFTUlVTV9NT0RFTCB8fFxuICAgICAgICAgIFwiZ2VtaW5pLTIuMC1mbGFzaC10aGlua2luZy1leHAtMDEtMjFcIixcbiAgICAgICAgREJfSE9TVDogcHJvY2Vzcy5lbnYuREJfSE9TVCB8fCBcIlwiLFxuICAgICAgICBEQl9VU0VSOiBwcm9jZXNzLmVudi5EQl9VU0VSIHx8IFwiXCIsXG4gICAgICAgIERCX1BBU1NXT1JEOiBwcm9jZXNzLmVudi5EQl9QQVNTV09SRCB8fCBcIlwiLFxuICAgICAgICBEQl9OQU1FOiBwcm9jZXNzLmVudi5EQl9OQU1FIHx8IFwiXCIsXG4gICAgICAgIFNLSVBfU0lHTkFUVVJFX1ZBTElEQVRJT046XG4gICAgICAgICAgcHJvY2Vzcy5lbnYuU0tJUF9TSUdOQVRVUkVfVkFMSURBVElPTiB8fCBcImZhbHNlXCIsXG4gICAgICAgIFNUUklQRV9TRUNSRVRfS0VZOiBwcm9jZXNzLmVudi5TVFJJUEVfU0VDUkVUX0tFWSB8fCBcIlwiLFxuICAgICAgICBTVFJJUEVfUVVPVEFfUFJJQ0VfSUQ6IHByb2Nlc3MuZW52LlNUUklQRV9RVU9UQV9QUklDRV9JRCB8fCBcIlwiLFxuICAgICAgICBTVFJJUEVfUFJFTUlVTV9QUklDRV9JRDogcHJvY2Vzcy5lbnYuU1RSSVBFX1BSRU1JVU1fUFJJQ0VfSUQgfHwgXCJcIixcbiAgICAgICAgU1RSSVBFX1NVQ0NFU1NfVVJMOiBwcm9jZXNzLmVudi5TVFJJUEVfU1VDQ0VTU19VUkwgfHwgXCJcIixcbiAgICAgICAgU1RSSVBFX0NBTkNFTF9VUkw6IHByb2Nlc3MuZW52LlNUUklQRV9DQU5DRUxfVVJMIHx8IFwiXCIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2dz44Kw44Or44O844OX77yIU3RyaXBlIFdlYmhvb2vnlKjvvIlcbiAgICBjb25zdCBzdHJpcGVMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIFwiU3RyaXBlV2ViaG9va0xvZ0dyb3VwXCIsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvbGFtYmRhL3N0cmlwZS13ZWJob29rLWhhbmRsZXItJHtlbnZ9YCxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYemWouaVsO+8iFN0cmlwZSBXZWJob29r77yJXG4gICAgY29uc3Qgc3RyaXBlV2ViaG9va0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICBcIlN0cmlwZVdlYmhvb2tGdW5jdGlvblwiLFxuICAgICAge1xuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgICAgaGFuZGxlcjogXCJoYW5kbGVycy9zdHJpcGUtd2ViaG9vay5oYW5kbGVyXCIsXG4gICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL3NyY1wiKSksXG4gICAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgICBsb2dHcm91cDogc3RyaXBlTG9nR3JvdXAsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgU1RSSVBFX1NFQ1JFVF9LRVk6IHByb2Nlc3MuZW52LlNUUklQRV9TRUNSRVRfS0VZIHx8IFwiXCIsXG4gICAgICAgICAgU1RSSVBFX1dFQkhPT0tfU0VDUkVUOiBwcm9jZXNzLmVudi5TVFJJUEVfV0VCSE9PS19TRUNSRVQgfHwgXCJcIixcbiAgICAgICAgICBEQl9IT1NUOiBwcm9jZXNzLmVudi5EQl9IT1NUIHx8IFwiXCIsXG4gICAgICAgICAgREJfVVNFUjogcHJvY2Vzcy5lbnYuREJfVVNFUiB8fCBcIlwiLFxuICAgICAgICAgIERCX1BBU1NXT1JEOiBwcm9jZXNzLmVudi5EQl9QQVNTV09SRCB8fCBcIlwiLFxuICAgICAgICAgIERCX05BTUU6IHByb2Nlc3MuZW52LkRCX05BTUUgfHwgXCJcIixcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gQVBJIEdhdGV3YXlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsIFwiTGluZUNoYXRib3RBcGlcIiwge1xuICAgICAgcmVzdEFwaU5hbWU6IGBMSU5FIENoYXRib3QgQVBJICgke2Vudn0pYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIGZvciBMSU5FIENoYXRib3Qgd2l0aCBHb29nbGUgR2VtaW5pIC0gJHtlbnZ9IGVudmlyb25tZW50YCxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRh57Wx5ZCI77yI44OX44Ot44Kt44K357Wx5ZCI77yJXG4gICAgY29uc3QgbGFtYmRhSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihcbiAgICAgIHdlYmhvb2tGdW5jdGlvbixcbiAgICAgIHtcbiAgICAgICAgcHJveHk6IHRydWUsXG4gICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDBcIixcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyAvd2ViaG9vayDjgqjjg7Pjg4njg53jgqTjg7Pjg4jvvIhMSU5F55So77yJXG4gICAgY29uc3Qgd2ViaG9va1Jlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoXCJ3ZWJob29rXCIpO1xuICAgIHdlYmhvb2tSZXNvdXJjZS5hZGRNZXRob2QoXCJQT1NUXCIsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAwXCIsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICBcIm1ldGhvZC5yZXNwb25zZS5oZWFkZXIuQ29udGVudC1UeXBlXCI6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGHntbHlkIjvvIhTdHJpcGUgV2ViaG9va+eUqO+8iVxuICAgIGNvbnN0IHN0cmlwZUxhbWJkYUludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oXG4gICAgICBzdHJpcGVXZWJob29rRnVuY3Rpb24sXG4gICAgICB7XG4gICAgICAgIHByb3h5OiB0cnVlLFxuICAgICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAwXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gL3N0cmlwZS93ZWJob29rIOOCqOODs+ODieODneOCpOODs+ODiFxuICAgIGNvbnN0IHN0cmlwZVJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoXCJzdHJpcGVcIik7XG4gICAgY29uc3Qgc3RyaXBlV2ViaG9va1Jlc291cmNlID0gc3RyaXBlUmVzb3VyY2UuYWRkUmVzb3VyY2UoXCJ3ZWJob29rXCIpO1xuICAgIHN0cmlwZVdlYmhvb2tSZXNvdXJjZS5hZGRNZXRob2QoXCJQT1NUXCIsIHN0cmlwZUxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAwXCIsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICBcIm1ldGhvZC5yZXNwb25zZS5oZWFkZXIuQ29udGVudC1UeXBlXCI6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyDlh7rliptcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaUdhdGV3YXlVcmxcIiwge1xuICAgICAgdmFsdWU6IGFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogXCJBUEkgR2F0ZXdheSBVUkxcIixcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiV2ViaG9va1VybFwiLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH13ZWJob29rYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkxJTkUgV2ViaG9vayBVUkxcIixcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU3RyaXBlV2ViaG9va1VybFwiLCB7XG4gICAgICB2YWx1ZTogYCR7YXBpLnVybH1zdHJpcGUvd2ViaG9va2AsXG4gICAgICBkZXNjcmlwdGlvbjogXCJTdHJpcGUgV2ViaG9vayBVUkxcIixcbiAgICB9KTtcbiAgfVxufVxuIl19