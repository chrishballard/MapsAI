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
import { Queue, Worker } from 'bullmq';
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

// Stop the queue reconnecting before the test ends: a reconnect loop that
// outlives the test logs during vitest's teardown and fails the run.
// close() disconnects a queue that never got a connection; a connected one
// would QUIT, which waits forever on a Redis refusing AUTH, so its client is
// disconnected first.
async function shutDown(queue: Queue, client?: { disconnect(): void }) {
  client?.disconnect();
  await queue.close();
  const settled = lines.length;
  await new Promise((r) => setTimeout(r, 300)); // several retry intervals
  expect(lines.slice(settled)).toEqual([]);
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

  it('spells out a refused connection (an AggregateError with no message)', () => {
    const err = new AggregateError(
      [
        new Error('connect ECONNREFUSED ::1:6379'),
        new Error('connect ECONNREFUSED 127.0.0.1:6379'),
      ],
      ''
    );
    expect(redisErrorMessage(err)).toBe(
      'AggregateError: connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379'
    );
  });

  it('falls back to the error code when the inner errors say nothing', () => {
    const err = Object.assign(new AggregateError([new Error('')], ''), { code: 'ECONNREFUSED' });
    expect(redisErrorMessage(err)).toBe('AggregateError: ECONNREFUSED');
  });

  it('still redacts a password with a stray % (which cannot be decoded)', () => {
    vi.stubEnv('REDIS_URL', 'redis://default:ab%zzSecret9@redis.internal:6379');
    const line = redisErrorMessage(new Error('auth ab%zzSecret9 refused'));
    expect(line).not.toContain('ab%zzSecret9');
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
      '[queue:test-queue] ReplyError: WRONGPASS invalid username-password pair or user is disabled.',
    ]);
    // A caller that later logs the same error object whole is safe too.
    expect(format('caller:', err)).not.toContain(PASSWORD);
    expect(err.command).toEqual({ name: 'auth', args: ['[redacted]'] });
  });

  it('logs an error re-emitted by a job scheduler on the same queue once', async () => {
    const { EventEmitter } = await import('node:events');
    const emitter = logRedisErrors(new EventEmitter(), 'test-queue');
    const err = wrongpassError();

    emitter.emit('error', err);
    emitter.emit('error', err);
    emitter.emit('error', wrongpassError());

    expect(lines).toHaveLength(2);
  });
});

describe('the Redis connection options', () => {
  // connection.ts parses REDIS_URL on import. Node's TypeError for a bad URL
  // carries the input, so an unencoded "/" in a rotated password would have
  // printed it on every boot of the web and worker processes.
  it('refuses a URL it cannot parse without repeating it', async () => {
    vi.resetModules();
    vi.stubEnv('REDIS_URL', `redis://default:abc/${PASSWORD}@redis.internal:6379`);

    const failure = await import('@/lib/queue/connection').then(
      () => null,
      (err: unknown) => err
    );

    expect(failure).toBeInstanceOf(Error);
    expect(format(failure)).not.toContain(PASSWORD);
    expect((failure as Error).message).toContain('REDIS_URL is not a valid URL');
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
        '[queue:test] ReplyError: WRONGPASS invalid username-password pair or user is disabled.'
      );
    } finally {
      await shutDown(queue);
      await redis.close();
    }
  });

  it('a Worker with logRedisErrors logs no password either', async () => {
    const redis = await fakeRedis('refusing');
    const worker = logRedisErrors(
      new Worker('redis-errors-test', async () => {}, {
        connection: {
          host: '127.0.0.1',
          port: redis.port,
          password: PASSWORD,
          maxRetriesPerRequest: null,
          retryStrategy: () => 50,
        },
      }),
      'test-worker'
    );
    try {
      await until(() => lines.filter((l) => l.includes('WRONGPASS')).length >= 2);
      expect(lines.some((l) => l.includes(PASSWORD))).toBe(false);
    } finally {
      await worker.close(true);
      const settled = lines.length;
      await new Promise((r) => setTimeout(r, 300));
      expect(lines.slice(settled)).toEqual([]);
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
      await shutDown(queue, await queue.client);
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
      // A commented-out call must not count.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const constructions =
        source.match(/new (Queue|Worker|QueueEvents|IORedis|Redis)\b/g) ?? [];
      const named = [
        ...source.matchAll(
          /(?:const|let)\s+(\w+)\s*=\s*new (?:Queue|Worker|QueueEvents|IORedis|Redis)\b/g
        ),
      ].map((m) => m[1]);
      const rel = path.relative(root, file);
      // Shapes this check can't follow: name them so the test is updated.
      if (/import\s*\{[^}]*\b(Queue|Worker|QueueEvents)\s+as\s+\w+/.test(source)) {
        missing.push(`${rel}: a BullMQ class imported under another name`);
      }
      if (/new\s+\w+\.(Queue|Worker|QueueEvents)\b|new FlowProducer\b|\.duplicate\(/.test(source)) {
        missing.push(`${rel}: a Redis connection this check does not cover`);
      }
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
