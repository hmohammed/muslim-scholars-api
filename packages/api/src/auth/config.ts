export interface GitHubProfile {
  githubId: number;
  login: string;
  email: string | null;
}

export interface AuthConfig {
  githubClientId: string;
  githubClientSecret: string;
  sessionKey: string;
  pepper: string;
  adminLogins: string[];
  publicUrl: string;
  exchangeCode?: (code: string) => Promise<GitHubProfile>;
}

export function resolveAuth(input: Partial<AuthConfig> = {}): AuthConfig {
  const admin = input.adminLogins ?? (process.env.ADMIN_GITHUB_LOGINS ?? '').split(',');
  return {
    githubClientId: input.githubClientId ?? process.env.GITHUB_CLIENT_ID ?? '',
    githubClientSecret: input.githubClientSecret ?? process.env.GITHUB_CLIENT_SECRET ?? '',
    sessionKey: input.sessionKey ?? process.env.SESSION_KEY ?? '',
    pepper: input.pepper ?? process.env.API_KEY_PEPPER ?? '',
    adminLogins: admin.map(login => login.trim().toLowerCase()).filter(Boolean),
    publicUrl: (input.publicUrl ?? process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    exchangeCode: input.exchangeCode,
  };
}
