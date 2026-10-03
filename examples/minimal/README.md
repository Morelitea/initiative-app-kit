# GitLab issues: a minimal declarative app

One read and one widget. `issue-counts` asks GitLab how many issues a project
has open and closed, and the `open-issues` widget draws the open count on a
dashboard. Nothing of it runs anywhere: Initiative makes the request with the
community's GitLab connection and maps the answer itself.

| File | What it is |
|---|---|
| `src/app.ts` | The app: its GitLab connection, the endpoint's request and map, the widget, the listing |
| `src/widgets/open-issues.ts` | The widget, typed from the endpoint it draws |
| `test/issue-counts.test.ts` | The request and map run against a recorded answer, `test/fixtures/` |
| `assets/avatar.png` | The listing's picture |

## Start

```sh
npx initiative-app-sdk init my-app
cd my-app
npm install
npm test
```

`init` gives the copy a uid of its own. Change `publicId` and
`listing.publisher` to your own prefix before you publish it.

## Build, pack, upload

```sh
npm run build          # manifest.json, checked
npm run pack           # example.gitlab-issues-1.0.0.json, the listing file
npm run dev -- --initiative https://initiative.example.com --api-key ppk_…
```

`pack` writes the file a deployment publishes as its own app, and `dev`
uploads it with its picture to yours, as its owner's API key, then again on
each change under `src/`.

## Make it work on your deployment

1. Register an OAuth application on GitLab (**User settings → Applications**)
   with the `read_api` scope, and the redirect address your deployment shows
   for the app under its app services.
2. Set the app's vendor values there: the application's ID and secret. The app
   is offered to communities once both are set.
3. In a community, install the app, connect its GitLab account, and add the
   **Open issues** widget to a dashboard with a project such as
   `gitlab-org/gitlab`.
