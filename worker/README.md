# Warcraft Logs Worker (no sign-in for public reports)

A small Cloudflare Worker that loads public Warcraft Logs reports for the page using this site's own
Warcraft Logs client (client credentials). The secret lives only in the Worker. Callers can run only the
page's two queries (`web/js/wcl-queries.js`), only from https://dogshep.github.io (and localhost), and
identical requests are cached for 10 minutes. Private reports still need the viewer's own sign-in.

## One-time setup

1. **Warcraft Logs client.** At https://www.warcraftlogs.com/api/clients/ create a new client:
   name `warrior-dps-analyzer-server`, redirect URL `https://dogshep.github.io/warrior-dps-analyzer/`,
   and leave **Public Client unchecked**. Copy the client id and the secret.
2. **Cloudflare.** Make a free account at https://dash.cloudflare.com/sign-up. Open
   **Workers & Pages** once so Cloudflare sets up your `workers.dev` subdomain. Then go to
   **My Profile → API Tokens → Create Token**, use the **Edit Cloudflare Workers** template, and copy the token.
3. **GitHub secrets.** In the repo, go to **Settings → Secrets and variables → Actions** and add
   `WCL_SERVER_CLIENT_ID`, `WCL_SERVER_CLIENT_SECRET` and `CLOUDFLARE_API_TOKEN`.
   If your Cloudflare token can see more than one account, also add `CLOUDFLARE_ACCOUNT_ID`.
4. Run the **Deploy** workflow (Actions → Deploy → Run workflow). It deploys the Worker, stores the two
   Warcraft Logs values as Worker secrets, and writes the Worker's address into the page.

Without these secrets the deploy skips the Worker and the page keeps sign-in only.
