#!/bin/bash
# Runs inside the LocalStack container once it's ready. LocalStack forgets
# everything on restart, so the queues are recreated every time.
set -e

awslocal sqs create-queue --queue-name gatepass-jobs-dlq

awslocal sqs create-queue --queue-name gatepass-jobs --attributes '{
  "VisibilityTimeout": "10",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:gatepass-jobs-dlq\",\"maxReceiveCount\":\"3\"}"
}'

# Payments: FIFO, so messages for one order are processed in order and one at a time.
# The webhook sets MessageGroupId = orderId and MessageDeduplicationId = Stripe's event id.
awslocal sqs create-queue --queue-name gatepass-payments-dlq.fifo --attributes FifoQueue=true

awslocal sqs create-queue --queue-name gatepass-payments.fifo --attributes '{
  "FifoQueue": "true",
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:gatepass-payments-dlq.fifo\",\"maxReceiveCount\":\"3\"}"
}'
