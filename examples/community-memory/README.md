# Run Starlight Memory locally

This standalone example installs the public `@starlight-intelligence/memory@0.2.0` release. It works with Node.js and npm, without a cloud account or a model key. Use Node 22 or 24. Run these commands from this directory in a checkout of the public Starlight Intelligence System repository.

```sh
npm ci --workspaces=false --omit=optional --ignore-scripts --no-audit --no-fund
npm run demo --workspaces=false
```

The demo creates a temporary vault, writes one fictional project milestone over MCP, closes the server, then recalls the milestone from a new read-only server. It deletes its temporary vault on exit. The install requires access to npm. Retrieval uses local lexical search with embeddings off.

## Connect a real agent

Create a private vault directory that your user owns. Register a local stdio server with your MCP client using the command and arguments below. Replace the example paths with absolute paths on your machine. Use the same vault and tenant when you want different authorized local clients to see the same records.

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/community-memory/node_modules/@starlight-intelligence/memory/bin/starlight-memory.mjs",
    "mcp", "serve", "--vault", "/absolute/path/to/my-private-vault",
    "--tenant", "my-workspace", "--embeddings", "off", "--profile", "reads"
  ]
}
```

Set a separate trusted writer to the `writes` profile for capture. Filesystem permissions protect a local vault. A tenant label and a limited tool profile alone are insufficient for untrusted users sharing a host. Keep the vault outside Git and configure backups under the owner's control. The connected agent's own model billing and handling of retrieved text still apply.

The example covers the released filesystem vault and local stdio transport. Hosted accounts, remote MCP, PostgreSQL evidence history and provider billing require separate integration and release evidence.

## Moving the same client into a deployment

| Placement | Owner of records and credentials | Operational boundary |
|---|---|---|
| Private machine or server | The operator owns the vault, filesystem permissions, backup and any external model account. | Launch one local stdio connection per trusted client. |
| Customer cloud | The customer owns the deployment accounts, database or vault and model credentials. | A remote transport needs authenticated identity, scoped grants and a private evidence store. Validate restore, export, revocation and billing in that account before enabling it. |
| Managed coordination with customer execution | The customer owns the execution account and secrets. The managed operator runs the interface and accounts. | Agree on metadata retention and service fees, restrict callback payloads, and verify that losing the customer key stops billable model execution. |

Only the first row is exercised by this example.
