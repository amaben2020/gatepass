import { SQSClient } from '@aws-sdk/client-sqs';

// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
// Drop AWS_ENDPOINT_URL to talk to real AWS.
export const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT_URL,
});
