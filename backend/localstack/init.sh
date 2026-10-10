#!/bin/bash
# Runs inside the LocalStack container once it's ready. LocalStack forgets
# everything on restart, so the queues are recreated every time.
set -e

awslocal sqs create-queue --queue-name gatepass-jobs-dlq

awslocal sqs create-queue --queue-name gatepass-jobs --attributes '{
  "VisibilityTimeout": "10",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:gatepass-jobs-dlq\",\"maxReceiveCount\":\"3\"}"
}'
