# grouplink

Render's links page. A Render Workflow reads the links from Notion, scrapes each link's description, and writes the result to Key Value. A web service reads the result from Key Value and serves one HTML page per profile.

## Project structure

- `src/rebuild.ts`: The `grouplink.rebuild` Workflow task
- `src/webhook.ts`: Web service that serves the pages and receives Notion's webhook
- `src/render.ts`: Renders the HTML page
- `assets/`: Fonts, icons, and logos
- `scripts/`: Local preview scripts
- `test/`: Unit, golden-page, and live tests
- `render.yaml`: Render Blueprint for the web service and the Key Value instance

## How it works

1. Someone edits a row in Notion.
2. Notion sends a webhook to the web service. The web service waits for 60 seconds with no new edits, then starts one `grouplink.rebuild` run.
3. The run reads both Notion databases, scrapes and health-checks each link, and writes a snapshot to Key Value under the `grouplink:site` key.
4. The web service renders each page from the snapshot on request.

There is no schedule. The run logs the live URL and any dead links. If a run fails, the error shows in the run's logs in the Render Dashboard.

## Notion databases

The links database has the following properties:

| Property   | Type     | Purpose                                                    |
| ---------- | -------- | ---------------------------------------------------------- |
| `Title`    | title    | Card text                                                  |
| `URL`      | url      | Where the card points                                      |
| `Visible`  | checkbox | Unchecked rows are not shown                               |
| `Everyone` | checkbox | Shows the link on every profile's page                     |
| `Profiles` | relation | The profiles whose pages show the link                     |
| `Icon`     | select   | A file name from `assets/link-icons/`. Empty means `arrow`. |
| `Order`    | number   | Card position, lowest first. Required.                     |

The profiles database has the following properties:

| Property  | Type  | Purpose                                 |
| --------- | ----- | --------------------------------------- |
| `Name`    | title | The heading on the profile's page       |
| `Slug`    | text  | The URL path. `shifra` serves at `/shifra`. |
| `Tagline` | text  | The page description in the metadata    |

The profile named by `SITE_DEFAULT_SLUG` is also served at `/`. The slugs `assets`, `healthz`, `links`, `tasks`, and `webhooks` are reserved.

## Local development

You need Node.js 22.13 or later, pnpm 11, the [Render CLI](https://render.com/docs/cli), and Docker or a local Redis.

1. Run `pnpm install` and `pnpm build`.
2. Copy `.env.example` to `.env` and fill in the Notion and Redis values.
3. Run `render workflows dev -- pnpm dev`.
4. In another terminal, start a dry run:

```bash
render workflows start grouplink.rebuild --local --input='[{"dryRun":true}]'
```

### Previewing the page

1. Start Redis with `docker run -p 6379:6379 redis`.
2. Write a snapshot from Notion with `pnpm preview`. To use the seed links instead of Notion, run `pnpm placeholder`.
3. Start the web service:

```bash
REDIS_URL=redis://localhost:6379 WORKFLOW_SLUG=local RENDER_API_KEY=local pnpm dev:web
```

4. Open `http://localhost:3000`.

The preview scripts refuse to write to a Redis that is not on your machine.

## Deployment

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Ho1yShif/grouplink-ts)

Blueprints don't support Workflows yet, so you create the Workflow in the Dashboard. The web service fails its first deploy because `WORKFLOW_SLUG` is empty. Step 5 fixes it.

1. Create a Notion connection at [notion.so/profile/integrations](https://www.notion.so/profile/integrations) with only the **Read content** capability. Copy its token, then connect it to both databases from each database's **⋯ > Connections** menu. Creating an internal connection needs workspace owner rights. If you are not an owner, see [Public Notion connection](#public-notion-connection).
2. Deploy the Blueprint. It creates the `grouplink-cache` Key Value instance and the `grouplink-webhook-ts` web service. Leave `WORKFLOW_SLUG` blank and note the web service's URL.
3. Create a Workflow on the same repo:
   - Build command: `pnpm install --frozen-lockfile && pnpm build`
   - Start command: `node dist/main.js`
4. Set the Workflow's environment variables from [Configuration](#configuration). Set `DRY_RUN=true` for the first deploy.
5. Set `WORKFLOW_SLUG` and `RENDER_API_KEY` on the web service and redeploy it.
6. Create the Notion webhook subscription. See [Notion webhook](#notion-webhook).
7. Remove `DRY_RUN` from the Workflow and edit a row in Notion. The page returns 503 until the first run writes the snapshot.

### Notion webhook

1. On the connection's **Webhooks** tab, create a subscription with the URL `https://<webhook-host>/webhooks/notion`.
2. Subscribe to `page.created`, `page.deleted`, `page.undeleted`, `page.properties_updated`, `page.content_updated`, `data_source.content_updated`, and `data_source.schema_updated`.
3. Notion sends a verification token to the web service. Find `notion verification_token: ntn_...` in the web service's logs.
4. Click **Verify** on the Webhooks tab and paste the token.
5. Set the same token as `NOTION_WEBHOOK_SECRET` on the web service and redeploy.

### Public Notion connection

1. Create the connection with the type **Public** and the redirect URI `https://<webhook-host>/oauth`. The web service has no route at that path, so the code stays in the address bar.
2. Open the **Authorization URL** from the **Configuration** tab, pick both databases, and approve.
3. Copy the `code` parameter from the address bar. It expires after ten minutes.
4. Exchange the code for a token:

```bash
curl -X POST https://api.notion.com/v1/oauth/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\": \"authorization_code\", \"code\": \"$CODE\", \"redirect_uri\": \"https://<webhook-host>/oauth\"}"
```

Use the `access_token` from the response as `NOTION_TOKEN`.

### Starting a run manually

```bash
curl -X POST https://<webhook-host>/tasks/grouplink.rebuild \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"dryRun":true}]'
```

## Configuration

The Workflow reads the following variables:

| Variable                      | Default  | Purpose                                     |
| ----------------------------- | -------- | ------------------------------------------- |
| `NOTION_TOKEN`                | —        | Notion connection token                     |
| `NOTION_LINKS_DATABASE_ID`    | —        | The links database                          |
| `NOTION_PROFILES_DATABASE_ID` | —        | The profiles database                       |
| `REDIS_URL`                   | —        | Internal connection string of `grouplink-cache` |
| `SITE_URL`                    | —        | Public URL, shown in the run log            |
| `SITE_DEFAULT_SLUG`           | —        | Slug of the profile served at `/`           |
| `DRY_RUN`                     | `false`  | Set to `true` to skip the snapshot write    |
| `METADATA_TTL_SECONDS`        | `604800` | How long a scraped description is cached    |
| `LINKS_LIMIT`                 | `100`    | Notion rows to read per run                 |

The web service reads the following variables:

| Variable                | Default             | Purpose                                       |
| ----------------------- | ------------------- | --------------------------------------------- |
| `REDIS_URL`             | —                   | Set by the Blueprint                          |
| `RENDER_API_KEY`        | —                   | Starts Workflow runs                          |
| `WORKFLOW_SLUG`         | —                   | Slug of the Workflow service                  |
| `NOTION_WEBHOOK_SECRET` | —                   | Verification token of the Notion subscription |
| `DISPATCH_TOKEN`        | —                   | Bearer token for `POST /tasks/:task`          |
| `REBUILD_TASK`          | `grouplink.rebuild` | Task the webhook starts                       |
| `DEBOUNCE_MS`           | `60000`             | Wait time after an edit before a run starts   |

## Checks

Run the following commands before you deploy:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`

`pnpm test:live` runs a dry run against real Notion, real sites, and a real Key Value instance.

After a change to `render.ts` or `styles.ts`, regenerate the golden pages in `test/golden/` and review the diff. grouplink-py keeps the same pages, so update both repos.

## License

MIT. See [LICENSE](LICENSE).
