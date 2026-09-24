#!/usr/bin/env bash
# Integration tests against a local mock of the Kanka API.
set -e
cd "$(dirname "$0")/.."
node test/mock-kanka.js > /tmp/mock.out 2>/tmp/mock.err &
MOCKPID=$!
sleep 1
PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/mock.out','utf8')).port)")
node test/run-tests.js $PORT
RC=$?
kill $MOCKPID 2>/dev/null || true
exit $RC
