#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting MapsAI workers..."
node --import tsx workers/index.ts &
WORKER_PID=$!

echo "Starting Next.js server..."
node server.js &
NEXT_PID=$!

# Forward termination signals so both children shut down gracefully
# (workers/index.ts drains in-flight BullMQ jobs on SIGTERM/SIGINT).
shutdown() {
  echo "Received $1, forwarding to workers and web server..."
  kill -"$1" "$WORKER_PID" "$NEXT_PID" 2>/dev/null || true
  wait "$WORKER_PID" 2>/dev/null || true
  wait "$NEXT_PID" 2>/dev/null || true
  exit 0
}
trap 'shutdown TERM' TERM
trap 'shutdown INT' INT

# If either process dies on its own, take the container down so the
# platform restarts it.
wait -n "$WORKER_PID" "$NEXT_PID" || true
echo "A process exited unexpectedly, shutting down..."
kill -TERM "$WORKER_PID" "$NEXT_PID" 2>/dev/null || true
wait "$WORKER_PID" "$NEXT_PID" 2>/dev/null || true
exit 1
