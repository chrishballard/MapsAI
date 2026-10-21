import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/prompt-templates (Settings > AI Prompt Templates). A duplicate, a
// template for a profile that doesn't exist, and an edit or delete of a
// template that's already gone all reached the client as a bare 500; and a
// PATCH with nothing in it ran an update that changed nothing.

const mocks = vi.hoisted(() => ({
  prisma: {
    promptTemplate: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));

const listRoute = await import('@/app/api/prompt-templates/route');
const itemRoute = await import('@/app/api/prompt-templates/[id]/route');

function jsonRequest(method: string, body: unknown): Request {
  return new Request('http://localhost:3000/api/prompt-templates', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const prismaError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/prompt-templates', () => {
  const body = { name: 'Plumbers', prompt: 'Write like a plumber.', category: 'Plumber' };

  it('creates a template', async () => {
    mocks.prisma.promptTemplate.create.mockResolvedValue({ id: 't1', ...body });
    const res = await listRoute.POST(jsonRequest('POST', body));
    expect(res.status).toBe(201);
  });

  it('409s on a duplicate (P2002)', async () => {
    mocks.prisma.promptTemplate.create.mockRejectedValue(prismaError('P2002'));
    const res = await listRoute.POST(jsonRequest('POST', body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/i);
  });

  it('404s when the profile it names does not exist (P2003)', async () => {
    mocks.prisma.promptTemplate.create.mockRejectedValue(prismaError('P2003'));
    const res = await listRoute.POST(jsonRequest('POST', { ...body, profileId: 'gone' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/profile not found/i);
  });

  it('still throws on anything else', async () => {
    mocks.prisma.promptTemplate.create.mockRejectedValue(new Error('db down'));
    await expect(listRoute.POST(jsonRequest('POST', body))).rejects.toThrow('db down');
  });
});

describe('PATCH /api/prompt-templates/[id]', () => {
  it('400s on an empty body without touching the DB', async () => {
    const res = await itemRoute.PATCH(jsonRequest('PATCH', {}), params('t1'));
    expect(res.status).toBe(400);
    expect(mocks.prisma.promptTemplate.update).not.toHaveBeenCalled();
  });

  it('updates the fields it is given', async () => {
    mocks.prisma.promptTemplate.update.mockResolvedValue({ id: 't1', name: 'New' });
    const res = await itemRoute.PATCH(jsonRequest('PATCH', { name: 'New' }), params('t1'));
    expect(res.status).toBe(200);
    expect(mocks.prisma.promptTemplate.update.mock.calls[0][0].data).toEqual({ name: 'New' });
  });

  it('404s for a template that does not exist (P2025)', async () => {
    mocks.prisma.promptTemplate.update.mockRejectedValue(prismaError('P2025'));
    const res = await itemRoute.PATCH(jsonRequest('PATCH', { name: 'New' }), params('gone'));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/prompt-templates/[id]', () => {
  it('404s for a template that does not exist (P2025)', async () => {
    mocks.prisma.promptTemplate.delete.mockRejectedValue(prismaError('P2025'));
    const res = await itemRoute.DELETE(new Request('http://localhost:3000'), params('gone'));
    expect(res.status).toBe(404);
  });

  it('still throws on anything else', async () => {
    mocks.prisma.promptTemplate.delete.mockRejectedValue(new Error('db down'));
    await expect(
      itemRoute.DELETE(new Request('http://localhost:3000'), params('t1'))
    ).rejects.toThrow('db down');
  });
});
