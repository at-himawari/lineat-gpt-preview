import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
interface LineChatbotStackProps extends cdk.StackProps {
    environment: string;
}
export declare class LineChatbotStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: LineChatbotStackProps);
}
export {};
