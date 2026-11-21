// Setup the Android specs do on the server directly, from Node: a second person and a friendship,
// through the admin API (E2E_SERVER_URL, E2E_ADMIN_PASSWORD). The phone only ever sees the result.
const base = process.env.E2E_SERVER_URL ?? 'http://127.0.0.1:6190';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password';

/** A signed-in session's cookie header, from POST /auth/login. */
async function signIn(username: string, password: string): Promise<string> {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`signing ${username} in: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

async function call<T>(cookie: string, path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
}

/**
 * A new account, friends with `friendOf`, with `password` as its own (an account an admin makes
 * has to choose one first, which this does for it).
 */
export async function friendFor(
  friendOf: string,
  username: string,
  password: string,
): Promise<void> {
  const admin = await signIn('admin', adminPassword);
  const made = await call<{ id: string; password: string }>(admin, '/api/admin/users', 'POST', {
    username,
  });
  const users = await call<{ id: string; username: string }[]>(admin, '/api/admin/users', 'GET');
  const other = users.find((each) => each.username === friendOf);
  if (!other) throw new Error(`no account ${friendOf}`);
  await call(admin, '/api/admin/friendships', 'POST', { userA: other.id, userB: made.id });
  const own = await signIn(username, made.password);
  await call(own, '/auth/password', 'POST', { current: made.password, next: password });
}
