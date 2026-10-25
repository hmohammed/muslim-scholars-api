import type { FastifyError, FastifyInstance } from 'fastify';
import { captureServerError } from './sentry.ts';

export function problem(status: number, detail: string): Error & { statusCode: number } {
  return Object.assign(new Error(detail), { statusCode: status });
}

export function registerErrors(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) {
      request.log.error({ err: error }, 'request failed');
      captureServerError(error);
    }
    const titles: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
    };
    return reply.code(status).type('application/problem+json').send({
      type: 'about:blank',
      title: titles[status] ?? 'Error',
      status,
      detail: status === 500 ? 'Something went wrong' : error.message,
    });
  });
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).type('application/problem+json').send({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `No route ${request.method} ${request.url}`,
    });
  });
}

export function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
