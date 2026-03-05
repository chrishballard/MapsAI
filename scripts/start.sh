#!/bin/sh
set -e

echo "Starting MapsAI workers..."
node --import tsx workers/index.ts &
WORKER_PID=$!

echo "Starting Next.js server..."
npm run start &
NEXT_PID=$!

# Wait for either process to exit
wait -n $WORKER_PID $NEXT_PID

# If either exits, kill both and exit with error
kill $WORKER_PID $NEXT_PID 2>/dev/null
exit 1
