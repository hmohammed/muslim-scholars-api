import type { AuthConfig, GitHubProfile } from './config.ts';

export async function exchangeGitHubCode(config: AuthConfig, code: string): Promise<GitHubProfile> {
  if (config.exchangeCode) return config.exchangeCode(code);
  const redirectUri = `${config.publicUrl}/portal/callback`;
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'muslim-scholars-api' },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenBody = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(tokenBody.error ?? 'GitHub token exchange failed');

  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${tokenBody.access_token}`,
    'user-agent': 'muslim-scholars-api',
  };
  const userResponse = await fetch('https://api.github.com/user', { headers });
  const user = await userResponse.json() as { id?: number; login?: string; email?: string | null };
  if (!userResponse.ok || !user.id || !user.login) throw new Error('GitHub user lookup failed');

  let email = user.email ?? null;
  if (!email) {
    const emailsResponse = await fetch('https://api.github.com/user/emails', { headers });
    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as { email?: string; primary?: boolean; verified?: boolean }[];
      email = emails.find(item => item.primary && item.verified)?.email ?? emails.find(item => item.verified)?.email ?? null;
    }
  }
  return { githubId: user.id, login: user.login, email };
}
