/**
 * A declarative app: one read Initiative makes to GitLab for a community, and
 * a widget that draws it on a dashboard. Nothing of it runs anywhere:
 * Initiative makes the call with the community's GitLab connection and maps
 * the answer itself.
 */

import { defineApp, defineEndpoint } from "initiative-app-sdk/manifest";

/** How many issues a GitLab project has open and closed. */
export const issueCounts = defineEndpoint({
  direction: "read",
  label: { en: "Issue counts" },
  params: {
    project: { type: "string", label: { en: "Project, such as gitlab-org/gitlab" }, required: true },
  },
  returns: { opened: "int", closed: "int" },
  request: {
    method: "GET",
    url: '"https://gitlab.com/api/v4/projects/" & $encodeUrlComponent(params.project) & "/issues_statistics"',
    connection: "gitlab",
  },
  map: '{"opened": response.body.statistics.counts.opened, "closed": response.body.statistics.counts.closed}',
  cache_ttl_seconds: 300,
});

export default defineApp({
  publicId: "example.gitlab-issues",
  uid: "ZNV2THEZGPHXXG", // npx initiative-app uid, once
  name: "GitLab issues",
  hosts: ["gitlab.com"],

  // The GitLab application the deployment's operator registers once.
  vendor: {
    fields: [
      { key: "client_id", type: "string", required: true, label: { en: "Application ID" } },
      { key: "client_secret", type: "secret", required: true, label: { en: "Secret" } },
    ],
  },

  // The community's GitLab account, which an admin connects once. Every
  // request carries a connection's credential.
  connections: {
    gitlab: {
      scope: "static",
      label: { en: "GitLab account" },
      fields: [],
      flow: {
        type: "oauth2",
        authorize_url: "https://gitlab.com/oauth/authorize",
        token_url: "https://gitlab.com/oauth/token",
        client_id: "{vendor.client_id}",
        client_secret: "{vendor.client_secret}",
        scopes: ["read_api"],
        pkce: true,
      },
    },
  },

  endpoints: { "issue-counts": issueCounts },

  widgets: {
    "open-issues": {
      meta: { name: { en: "Open issues" } },
      endpoints: ["issue-counts"],
      module: "src/widgets/open-issues.ts",
      sample_data: { "issue-counts": { opened: 12, closed: 30 } },
    },
  },

  listing: {
    publisher: "example",
    summary: "A GitLab project's open issues, on a dashboard.",
    avatar: "assets/avatar.png",
    version: "1.0.0",
  },
});
