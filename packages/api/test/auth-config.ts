import type { AuthConfig } from '../src/auth/config.ts';

export const testAuth: AuthConfig = {
  githubClientId: 'client',
  githubClientSecret: 'secret',
  sessionKey: 'test-session-key',
  pepper: 'test-pepper',
  adminLogins: ['ada'],
  publicUrl: 'http://localhost:3000',
  exchangeCode: async (code: string) => {
    if (code === 'admin') return { githubId: 7, login: 'ada', email: 'ada@example.com' };
    if (code === 'dev') return { githubId: 8, login: 'grace', email: null };
    throw new Error(`unexpected code ${code}`);
  },
};
