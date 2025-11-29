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
        // Lambda実行ロール
        const lambdaRole = new iam.Role(this, "LineChatbotLambdaRole", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
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
            logGroupName: "/aws/lambda/stripe-webhook-handler",
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
            restApiName: "LINE Chatbot API",
            description: "API for LINE Chatbot with Google Gemini",
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGluZS1jaGF0Ym90LXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGluZS1jaGF0Ym90LXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQsdUVBQXlEO0FBQ3pELHlEQUEyQztBQUMzQywyREFBNkM7QUFFN0MsMkNBQTZCO0FBRTdCLE1BQWEsZ0JBQWlCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDN0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixjQUFjO1FBQ2QsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUM3RCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQ3hDLDBDQUEwQyxDQUMzQzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsc0JBQXNCO1FBQ3RCLE1BQU0sUUFBUSxHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDOUQsWUFBWSxFQUFFLGtDQUFrQztZQUNoRCxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO1lBQ3RDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgseUJBQXlCO1FBQ3pCLE1BQU0sZUFBZSxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDbkUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FB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a0JBQWtCO1NBQ2hDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsZ0JBQWdCO1lBQ2pDLFdBQVcsRUFBRSxvQkFBb0I7U0FDbEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdktELDRDQXVLQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcbmltcG9ydCAqIGFzIGlhbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5cbmV4cG9ydCBjbGFzcyBMaW5lQ2hhdGJvdFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gTGFtYmRh5a6f6KGM44Ot44O844OrXG4gICAgY29uc3QgbGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBcIkxpbmVDaGF0Ym90TGFtYmRhUm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImxhbWJkYS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIlxuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nc+OCsOODq+ODvOODl1xuICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgXCJMaW5lQ2hhdGJvdExvZ0dyb3VwXCIsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogXCIvYXdzL2xhbWJkYS9saW5lLWNoYXRib3Qtd2ViaG9va1wiLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRh6Zai5pWw77yITElORSBXZWJob29r77yJXG4gICAgY29uc3Qgd2ViaG9va0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIldlYmhvb2tGdW5jdGlvblwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlcnMvd2ViaG9vay5oYW5kbGVyXCIsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi9zcmNcIikpLFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGxvZ0dyb3VwOiBsb2dHcm91cCxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIExJTkVfQ0hBTk5FTF9BQ0NFU1NfVE9LRU46IHByb2Nlc3MuZW52LkxJTkVfQ0hBTk5FTF9BQ0NFU1NfVE9LRU4gfHwgXCJcIixcbiAgICAgICAgTElORV9DSEFOTkVMX1NFQ1JFVDogcHJvY2Vzcy5lbnYuTElORV9DSEFOTkVMX1NFQ1JFVCB8fCBcIlwiLFxuICAgICAgICBHRU1JTklfQVBJX0tFWTogcHJvY2Vzcy5lbnYuR0VNSU5JX0FQSV9LRVkgfHwgXCJcIixcbiAgICAgICAgR0VNSU5JX01PREVMOiBwcm9jZXNzLmVudi5HRU1JTklfTU9ERUwgfHwgXCJnZW1pbmktMi41LWZsYXNoXCIsXG4gICAgICAgIEdFTUlOSV9NQVhfVE9LRU5TOiBwcm9jZXNzLmVudi5HRU1JTklfTUFYX1RPS0VOUyB8fCBcIjgwMDBcIixcbiAgICAgICAgR0VNSU5JX1RFTVBFUkFUVVJFOiBwcm9jZXNzLmVudi5HRU1JTklfVEVNUEVSQVRVUkUgfHwgXCIxXCIsXG4gICAgICAgIEdFTUlOSV9SRVNQT05TRV9DSEFSX0xJTUlUOlxuICAgICAgICAgIHByb2Nlc3MuZW52LkdFTUlOSV9SRVNQT05TRV9DSEFSX0xJTUlUIHx8IFwiNTAwXCIsXG4gICAgICAgIEdFTUlOSV9CQVNJQ19NT0RFTDpcbiAgICAgICAgICBwcm9jZXNzLmVudi5HRU1JTklfQkFTSUNfTU9ERUwgfHwgXCJnZW1pbmktMi4wLWZsYXNoLWV4cFwiLFxuICAgICAgICBHRU1JTklfUFJFTUlVTV9NT0RFTDpcbiAgICAgICAgICBwcm9jZXNzLmVudi5HRU1JTklfUFJFTUlVTV9NT0RFTCB8fFxuICAgICAgICAgIFwiZ2VtaW5pLTIuMC1mbGFzaC10aGlua2luZy1leHAtMDEtMjFcIixcbiAgICAgICAgREJfSE9TVDogcHJvY2Vzcy5lbnYuREJfSE9TVCB8fCBcIlwiLFxuICAgICAgICBEQl9VU0VSOiBwcm9jZXNzLmVudi5EQl9VU0VSIHx8IFwiXCIsXG4gICAgICAgIERCX1BBU1NXT1JEOiBwcm9jZXNzLmVudi5EQl9QQVNTV09SRCB8fCBcIlwiLFxuICAgICAgICBEQl9OQU1FOiBwcm9jZXNzLmVudi5EQl9OQU1FIHx8IFwiXCIsXG4gICAgICAgIFNLSVBfU0lHTkFUVVJFX1ZBTElEQVRJT046XG4gICAgICAgICAgcHJvY2Vzcy5lbnYuU0tJUF9TSUdOQVRVUkVfVkFMSURBVElPTiB8fCBcImZhbHNlXCIsXG4gICAgICAgIFNUUklQRV9TRUNSRVRfS0VZOiBwcm9jZXNzLmVudi5TVFJJUEVfU0VDUkVUX0tFWSB8fCBcIlwiLFxuICAgICAgICBTVFJJUEVfUVVPVEFfUFJJQ0VfSUQ6IHByb2Nlc3MuZW52LlNUUklQRV9RVU9UQV9QUklDRV9JRCB8fCBcIlwiLFxuICAgICAgICBTVFJJUEVfUFJFTUlVTV9QUklDRV9JRDogcHJvY2Vzcy5lbnYuU1RSSVBFX1BSRU1JVU1fUFJJQ0VfSUQgfHwgXCJcIixcbiAgICAgICAgU1RSSVBFX1NVQ0NFU1NfVVJMOiBwcm9jZXNzLmVudi5TVFJJUEVfU1VDQ0VTU19VUkwgfHwgXCJcIixcbiAgICAgICAgU1RSSVBFX0NBTkNFTF9VUkw6IHByb2Nlc3MuZW52LlNUUklQRV9DQU5DRUxfVVJMIHx8IFwiXCIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2dz44Kw44Or44O844OX77yIU3RyaXBlIFdlYmhvb2vnlKjvvIlcbiAgICBjb25zdCBzdHJpcGVMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIFwiU3RyaXBlV2ViaG9va0xvZ0dyb3VwXCIsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogXCIvYXdzL2xhbWJkYS9zdHJpcGUtd2ViaG9vay1oYW5kbGVyXCIsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGHplqLmlbDvvIhTdHJpcGUgV2ViaG9va++8iVxuICAgIGNvbnN0IHN0cmlwZVdlYmhvb2tGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgXCJTdHJpcGVXZWJob29rRnVuY3Rpb25cIixcbiAgICAgIHtcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICAgIGhhbmRsZXI6IFwiaGFuZGxlcnMvc3RyaXBlLXdlYmhvb2suaGFuZGxlclwiLFxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi9zcmNcIikpLFxuICAgICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgICAgbG9nR3JvdXA6IHN0cmlwZUxvZ0dyb3VwLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFNUUklQRV9TRUNSRVRfS0VZOiBwcm9jZXNzLmVudi5TVFJJUEVfU0VDUkVUX0tFWSB8fCBcIlwiLFxuICAgICAgICAgIFNUUklQRV9XRUJIT09LX1NFQ1JFVDogcHJvY2Vzcy5lbnYuU1RSSVBFX1dFQkhPT0tfU0VDUkVUIHx8IFwiXCIsXG4gICAgICAgICAgREJfSE9TVDogcHJvY2Vzcy5lbnYuREJfSE9TVCB8fCBcIlwiLFxuICAgICAgICAgIERCX1VTRVI6IHByb2Nlc3MuZW52LkRCX1VTRVIgfHwgXCJcIixcbiAgICAgICAgICBEQl9QQVNTV09SRDogcHJvY2Vzcy5lbnYuREJfUEFTU1dPUkQgfHwgXCJcIixcbiAgICAgICAgICBEQl9OQU1FOiBwcm9jZXNzLmVudi5EQl9OQU1FIHx8IFwiXCIsXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCBcIkxpbmVDaGF0Ym90QXBpXCIsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBcIkxJTkUgQ2hhdGJvdCBBUElcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBmb3IgTElORSBDaGF0Ym90IHdpdGggR29vZ2xlIEdlbWluaVwiLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGHntbHlkIjvvIjjg5fjg63jgq3jgrfntbHlkIjvvIlcbiAgICBjb25zdCBsYW1iZGFJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKFxuICAgICAgd2ViaG9va0Z1bmN0aW9uLFxuICAgICAge1xuICAgICAgICBwcm94eTogdHJ1ZSxcbiAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMFwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIC93ZWJob29rIOOCqOODs+ODieODneOCpOODs+ODiO+8iExJTkXnlKjvvIlcbiAgICBjb25zdCB3ZWJob29rUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZShcIndlYmhvb2tcIik7XG4gICAgd2ViaG9va1Jlc291cmNlLmFkZE1ldGhvZChcIlBPU1RcIiwgbGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDBcIixcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgIFwibWV0aG9kLnJlc3BvbnNlLmhlYWRlci5Db250ZW50LVR5cGVcIjogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYee1seWQiO+8iFN0cmlwZSBXZWJob29r55So77yJXG4gICAgY29uc3Qgc3RyaXBlTGFtYmRhSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihcbiAgICAgIHN0cmlwZVdlYmhvb2tGdW5jdGlvbixcbiAgICAgIHtcbiAgICAgICAgcHJveHk6IHRydWUsXG4gICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDBcIixcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyAvc3RyaXBlL3dlYmhvb2sg44Ko44Oz44OJ44Od44Kk44Oz44OIXG4gICAgY29uc3Qgc3RyaXBlUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZShcInN0cmlwZVwiKTtcbiAgICBjb25zdCBzdHJpcGVXZWJob29rUmVzb3VyY2UgPSBzdHJpcGVSZXNvdXJjZS5hZGRSZXNvdXJjZShcIndlYmhvb2tcIik7XG4gICAgc3RyaXBlV2ViaG9va1Jlc291cmNlLmFkZE1ldGhvZChcIlBPU1RcIiwgc3RyaXBlTGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDBcIixcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgIFwibWV0aG9kLnJlc3BvbnNlLmhlYWRlci5Db250ZW50LVR5cGVcIjogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIOWHuuWKm1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQXBpR2F0ZXdheVVybFwiLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBHYXRld2F5IFVSTFwiLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJXZWJob29rVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBgJHthcGkudXJsfXdlYmhvb2tgLFxuICAgICAgZGVzY3JpcHRpb246IFwiTElORSBXZWJob29rIFVSTFwiLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTdHJpcGVXZWJob29rVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBgJHthcGkudXJsfXN0cmlwZS93ZWJob29rYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlN0cmlwZSBXZWJob29rIFVSTFwiLFxuICAgIH0pO1xuICB9XG59XG4iXX0=