/**
 * The Redis password must never reach a log line.
 *
 * On 2026-10-22 the Redis password was rotated while the app ran with the old
 * one. Every reconnect failed AUTH, ioredis tagged the error with the AUTH
 * args, and BullMQ (no 'error' listener on the queues) printed the raw error:
 * the old password, in plain text, in Railway's logs. A caller logging a
 * failed queue.add() whole printed it too.
 *
 * The BullMQ tests run real Queues against a fake Redis that speaks just
 * enough RESP to accept a connection and then refuse the password.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { format } from 'node:util';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Queue } from 'bullmq';
import { logRedisErrors, redisErrorMessage } from '@/lib/queue/redis-errors';

const PASSWORD = 'oldRedisPassw0rdXYZ';

// ---------------------------------------------------------------------------
// Console capture: every console line, formatted the way Node prints it.

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function wrongpassError(): Error & { command?: unknown } {
  // What ioredis builds for a refused AUTH (DataHandler.returnError).
  const err = new Error(
    'WRONGPASS invalid username-password pair or user is disabled.'
  ) as Error & { command?: unknown };
  err.name = 'ReplyError';
  err.command = { name: 'auth', args: ['default', PASSWORD] };
  return err;
}

// ---------------------------------------------------------------------------
// A fake Redis. 'accepting' answers enough for BullMQ to connect; after
// rotate() every connection is cut and every command gets WRONGPASS.

function countCommands(chunk: string): number {
  return chunk.match(/(?:^|\r\n)\*\d+\r\n/g)?.length ?? 0;
}

async function fakeRedis(initial: 'accepting' | 'refusing') {
  let mode = initial;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (data) => {
      const text = data.toString();
      if (mode === 'refusing') {
        const n = Math.max(countCommands(text), 1);
        socket.write(
          '-WRONGPASS invalid username-password pair or user is disabled.\r\n'.repeat(n)
        );
        return;
      }
      // One reply per command, in order.
      for (const command of text.split(/(?:^|\r\n)(?=\*\d+\r\n)/).filter(Boolean)) {
        if (/\$4\r\ninfo\r\n/i.test(command)) {
          const info =
            'redis_version:7.2.4\r\nloading:0\r\nmaxmemory_policy:noeviction\r\n';
          socket.write(`$${info.length}\r\n${info}\r\n`);
        } else {
          socket.write('+OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    rotate() {
      mode = 'refusing';
      for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function queueOn(port: number) {
  return new Queue('redis-errors-test', {
    connection: {
      host: '127.0.0.1',
      port,
      password: PASSWORD,
      maxRetriesPerRequest: null,
      retryStrategy: () => 50,
    },
  });
}

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function shutDown(queue: Queue) {
  await Promise.race([
    queue.disconnect().catch(() => {}),
    new Promise((r) => setTimeout(r, 1_000)),
  ]);
}

// ---------------------------------------------------------------------------

describe('redisErrorMessage', () => {
  it('is the name and message, without command args', () => {
    const line = redisErrorMessage(wrongpassError());
    expect(line).toBe(
      'ReplyError: WRONGPASS invalid username-password pair or user is disabled.'
    );
    expect(line).not.toContain(PASSWORD);
  });

  it('removes the configured password and URL wherever the message has them', () => {
    vi.stubEnv('REDIS_URL', `redis://default:${PASSWORD}@redis.internal:6379`);
    const err = new Error(
      `connect failed for redis://default:${PASSWORD}@redis.internal:6379 (auth ${PASSWORD})`
    );
    const line = redisErrorMessage(err);
    expect(line).not.toContain(PASSWORD);
    expect(line).toContain('[redacted]');
  });

  it('removes credentials from any redis URL, configured or not', () => {
    const line = redisErrorMessage(
      new Error('bad url rediss://someone:hunter2hunter2@elsewhere:6380')
    );
    expect(line).not.toContain('hunter2hunter2');
    expect(line).toContain('rediss://[redacted]@elsewhere:6380');
  });

  it('handles a thrown non-Error', () => {
    expect(redisErrorMessage('plain string')).toBe('plain string');
  });
});

describe('logRedisErrors', () => {
  it('logs one sanitized line and strips the AUTH args off the error itself', async () => {
    const { EventEmitter } = await import('node:events');
    const emitter = logRedisErrors(new EventEmitter(), 'test-queue');
    const err = wrongpassError();

    emitter.emit('error', err);

    expect(lines).toEqual([
      '[redis:test-queue] ReplyError: WRONGPASS invalid username-password pair or user is disabled.',
    ]);
    // A caller that later logs the same error object whole is safe too.
    expect(format('caller:', err)).not.toContain(PASSWORD);
    expect(err.command).toEqual({ name: 'auth', args: ['[redacted]'] });
  });
});

describe('BullMQ against a Redis that refuses the password', () => {
  it('without a listener, BullMQ prints the password (the 2026-10-22 leak)', async () => {
    const redis = await fakeRedis('refusing');
    const queue = queueOn(redis.port);
    try {
      await until(() => lines.some((l) => l.includes('WRONGPASS')));
      expect(lines.some((l) => l.includes(PASSWORD))).toBe(true);
    } finally {
      await shutDown(queue);
      await redis.close();
    }
  });

  it('with logRedisErrors, no log line carries the password', async () => {
    const redis = await fakeRedis('refusing');
    const queue = logRedisErrors(queueOn(redis.port), 'test');
    try {
      await until(() => lines.filter((l) => l.includes('WRONGPASS')).length >= 2);
      expect(lines.some((l) => l.includes(PASSWORD))).toBe(false);
      expect(lines[0]).toBe(
        '[redis:test] ReplyError: WRONGPASS invalid username-password pair or user is disabled.'
      );
    } finally {
      await shutDown(queue);
      await redis.close();
    }
  });

  it('after a rotation, a failed queue.add() logged whole carries no password', async () => {
    const redis = await fakeRedis('accepting');
    const queue = logRedisErrors(queueOn(redis.port), 'test');
    try {
      const client = await queue.client;
      expect(client.status).toBe('ready');

      redis.rotate();
      await until(() => client.status === 'reconnecting');

      // A caller that logs the rejection the careless way.
      const failed = queue.add('job', { id: 1 }).then(
        () => 'added',
        (err: unknown) => {
          console.warn('Failed to queue job:', err);
          return 'rejected';
        }
      );
      await expect(failed).resolves.toBe('rejected');

      expect(lines.some((l) => l.startsWith('Failed to queue job: ReplyError: WRONGPASS'))).toBe(true);
      expect(lines.some((l) => l.includes(PASSWORD))).toBe(false);
    } finally {
      await shutDown(queue);
      await redis.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Every Queue, Worker and QueueEvents the app builds has the listener.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === 'generated' || name === 'node_modules' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('every BullMQ object logs its Redis errors safely', () => {
  const root = path.resolve(__dirname, '../..');
  const files = ['src', 'workers', 'scripts'].flatMap((dir) =>
    sourceFiles(path.join(root, dir))
  );

  it('finds the queues and workers', () => {
    const constructed = files.filter((f) =>
      /new (Queue|Worker|QueueEvents)\b/.test(readFileSync(f, 'utf8'))
    );
    // 8 queues + 8 workers today; the exact count is not the point.
    expect(constructed.length).toBeGreaterThanOrEqual(16);
  });

  it('passes each one to logRedisErrors', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const constructions =
        source.match(/new (Queue|Worker|QueueEvents|IORedis|Redis)\b/g) ?? [];
      const named = [
        ...source.matchAll(
          /(?:const|let)\s+(\w+)\s*=\s*new (?:Queue|Worker|QueueEvents|IORedis|Redis)\b/g
        ),
      ].map((m) => m[1]);
      const rel = path.relative(root, file);
      // Every construction is assigned to a name, and that name is passed
      // to logRedisErrors in the same file.
      if (named.length !== constructions.length) {
        missing.push(`${rel}: a Queue/Worker not assigned to a name`);
      }
      for (const name of named) {
        if (!new RegExp(`logRedisErrors\\(\\s*${name}\\b`).test(source)) {
          missing.push(`${rel}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
