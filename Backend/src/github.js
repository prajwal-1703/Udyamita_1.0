// GitHub access for the backend.
//
// v1.0 computed XP in the browser from contributionCalendar.totalContributions, which covers
// only the last 12 months (so XP fell as old work aged out), counts private contributions
// when the viewer's token can see them, and could be read with any token the user pasted.
// v1.1 counts ALL-TIME PUBLIC contributions of four kinds, year by year, using one server
// token, so every number on chain can be recomputed by anyone from GitHub's public API.

const GITHUB_API = "https://api.github.com";
const KINDS = [
  "totalCommitContributions",
  "totalIssueContributions",
  "totalPullRequestContributions",
  "totalPullRequestReviewContributions",
];

class GitHubError extends Error {}

function makeClient({ token, fetchImpl = fetch, userAgent = "udyamita-backend/1.1" }) {
  const headers = { Authorization: `Bearer ${token}`, "User-Agent": userAgent, Accept: "application/vnd.github+json" };

  async function rest(path) {
    const res = await fetchImpl(`${GITHUB_API}${path}`, { headers });
    if (!res.ok) throw new GitHubError(`GitHub REST ${path} -> ${res.status}`);
    return res.json();
  }

  async function graphql(query, variables) {
    const res = await fetchImpl(`${GITHUB_API}/graphql`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new GitHubError(`GitHub GraphQL -> ${res.status}`);
    const body = await res.json();
    if (body.errors && body.errors.length) throw new GitHubError(`GitHub GraphQL: ${body.errors[0].message}`);
    return body.data;
  }

  /** Current login for an immutable numeric account id (logins can be renamed). */
  async function loginForId(githubId) {
    const u = await rest(`/user/${encodeURIComponent(String(githubId))}`);
    return { login: u.login, createdAt: u.created_at, id: u.id };
  }

  /** All-time public contribution count for a numeric GitHub id. */
  async function contributionCount(githubId, now = new Date()) {
    const { login, createdAt, id } = await loginForId(githubId);
    if (Number(id) !== Number(githubId)) throw new GitHubError("GitHub id mismatch");
    const firstYear = new Date(createdAt).getUTCFullYear();
    const lastYear = now.getUTCFullYear();
    // contributionsCollection spans at most one year, so request one aliased field per year.
    const fields = [];
    for (let y = firstYear; y <= lastYear; y++) {
      const to = y === lastYear ? now.toISOString() : `${y}-12-31T23:59:59Z`;
      fields.push(`y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${to}") { ${KINDS.join(" ")} }`);
    }
    // `login` is passed as a variable, never interpolated (v1.0 interpolated on-chain usernames into queries).
    const query = `query($login: String!) { user(login: $login) { databaseId ${fields.join(" ")} } }`;
    const data = await graphql(query, { login });
    if (!data.user || Number(data.user.databaseId) !== Number(githubId)) throw new GitHubError("GitHub user lookup failed");
    const byYear = {};
    let total = 0;
    for (let y = firstYear; y <= lastYear; y++) {
      const c = data.user[`y${y}`];
      const n = KINDS.reduce((s, k) => s + (c ? Number(c[k]) || 0 : 0), 0);
      byYear[y] = n;
      total += n;
    }
    return { githubId: Number(githubId), login, total, byYear };
  }

  /** OAuth: exchange an authorization code for a token, read the identity, and drop the token. */
  async function identityFromOAuthCode({ clientId, clientSecret, code }) {
    const res = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const body = await res.json();
    if (!body.access_token) throw new GitHubError(`OAuth exchange failed: ${body.error || res.status}`);
    const me = await fetchImpl(`${GITHUB_API}/user`, {
      headers: { Authorization: `Bearer ${body.access_token}`, "User-Agent": userAgent, Accept: "application/vnd.github+json" },
    });
    if (!me.ok) throw new GitHubError(`GitHub /user -> ${me.status}`);
    const u = await me.json();
    return { githubId: Number(u.id), login: u.login, avatarUrl: u.avatar_url };
  }

  return { rest, graphql, loginForId, contributionCount, identityFromOAuthCode };
}

module.exports = { makeClient, GitHubError, KINDS };
