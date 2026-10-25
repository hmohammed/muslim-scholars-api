import * as Sentry from '@sentry/node';

/** Starts error reporting when SENTRY_DSN is set. Local runs and tests leave it unset. */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    beforeSend(event) {
      const headers = event.request?.headers;
      if (headers) {
        delete headers['x-api-key'];
        delete headers['X-API-Key'];
        delete headers.cookie;
        delete headers.Cookie;
      }
      return event;
    },
  });
}

export function captureServerError(error: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(error);
}

export async function closeSentry(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  await Sentry.close(2000);
}
