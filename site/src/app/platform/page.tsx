import type { Metadata } from "next";
import Link from "next/link";
import registryFile from "@/lib/generated/stack-registry.json";
import { GITHUB_URL } from "@/lib/nav";

// Renders platform/stack-registry.v1.json through its committed copy at
// src/lib/generated/stack-registry.json (scripts/check-stack-registry.mjs --write;
// drift-checked in CI). Nothing is fetched. Filters are plain links that set
// query parameters, so they work without JavaScript.

const DESCRIPTION =
  "Which Starlight agent runs where, on which model, with which tools. Every row links to the files that prove it, and every status follows a written evidence rule.";

export const metadata: Metadata = {
  title: "Where every agent runs",
  description: DESCRIPTION,
  openGraph: {
    title: "Where every agent runs — Starlight Intelligence",
    description: DESCRIPTION,
    type: "article",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Starlight Intelligence — Where every agent runs" }],
  },
};

type Status = "live" | "wired" | "planned";
type LiveCheck = { url: string; observedAt: string; httpStatus: number; note: string };
type Evidence = { evidence: string[]; deployEvidence?: string[]; validatedBy?: string[]; liveCheck?: LiveCheck };
type Provider = Evidence & {
  id: string;
  name: string;
  kind: string;
  status: Status;
  surface: { integration: string; package?: string; envVars: string[] };
  models?: string[];
  notes: string;
};
type Runtime = Evidence & { id: string; name: string; platform: string; status: Status; notes: string };
type AgentSpec = Evidence & { id: string; name: string; status: Status; notes: string };
type McpServer = Evidence & {
  id: string;
  name: string;
  transport: string;
  runtime: string | null;
  status: Status;
  entry: string;
  package?: string;
  tools: string[];
  notes: string;
};
type Deployment = Evidence & {
  id: string;
  agent: { kind: "registered" | "service-identity"; id: string };
  runtime: string;
  modelRoute: { provider: string; via?: string; models: string[]; calls: boolean };
  mcpServers: string[];
  skills: string[];
  status: Status;
  notes: string;
};
type Registry = {
  schemaVersion: string;
  verifiedAt: string;
  owner: string;
  statusRules: Record<Status, string>;
  providers: Provider[];
  runtimes: Runtime[];
  agentSpecs: AgentSpec[];
  mcpServers: McpServer[];
  deployments: Deployment[];
};

const registry = registryFile as unknown as Registry;

const STATUSES: Status[] = ["live", "wired", "planned"];
const STATUS_LABEL: Record<Status, string> = { live: "Live", wired: "Wired", planned: "Planned" };
const STATUS_TONE: Record<Status, string> = {
  live: "border-emerald-400/35 bg-emerald-400/[0.08] text-emerald-300",
  wired: "border-cyan-400/30 bg-cyan-400/[0.07] text-cyan-300",
  planned: "border-white/[0.14] bg-white/[0.03] text-slate-300",
};
const PLATFORM_LABEL: Record<string, string> = {
  local: "Local machine",
  vercel: "Vercel",
  "cloudflare-workers": "Cloudflare Workers",
  "gcp-cloud-run": "GCP Cloud Run",
  oci: "Oracle Cloud",
};

const LINK =
  "text-violet-300 underline decoration-violet-400/40 underline-offset-4 transition-micro hover:text-white hover:decoration-white/60";
const CODE = "font-mono text-[12px] text-slate-200 [overflow-wrap:anywhere]";

const runtimeById = new Map(registry.runtimes.map((r) => [r.id, r]));
const providerById = new Map(registry.providers.map((p) => [p.id, p]));
const mcpById = new Map(registry.mcpServers.map((m) => [m.id, m]));

function fileUrl(path: string) {
  return `${GITHUB_URL}/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

type Filters = { status: Status | null; platform: string | null; provider: string | null };

function hrefWith(filters: Filters, change: Partial<Filters>) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.status) params.set("status", next.status);
  if (next.platform) params.set("platform", next.platform);
  if (next.provider) params.set("provider", next.provider);
  const qs = params.toString();
  return qs ? `/platform?${qs}#deployments` : "/platform#deployments";
}

function deploymentPlatform(d: Deployment) {
  return runtimeById.get(d.runtime)?.platform ?? "unknown";
}

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const platforms = [...new Set(registry.runtimes.map((r) => r.platform))];
  const routedProviders = [...new Set(registry.deployments.map((d) => d.modelRoute.provider))];
  const filters: Filters = {
    status: pick(params.status, STATUSES),
    platform: pick(params.platform, platforms),
    provider: pick(params.provider, routedProviders),
  };
  const matches = (status: Status, platform: string, provider?: string) =>
    (!filters.status || filters.status === status) &&
    (!filters.platform || filters.platform === platform) &&
    (!filters.provider || provider === undefined || filters.provider === provider);

  const deployments = registry.deployments.filter((d) => matches(d.status, deploymentPlatform(d), d.modelRoute.provider));
  const runtimes = registry.runtimes.filter((r) => matches(r.status, r.platform));
  const providers = registry.providers.filter((p) => !filters.status || filters.status === p.status);
  const filtered = Boolean(filters.status || filters.platform || filters.provider);
  const toolCount = registry.mcpServers.reduce((n, m) => n + m.tools.length, 0);

  return (
    <div>
      <section className="border-b border-white/[0.08]">
        <div className="mx-auto max-w-5xl px-6 pb-12 pt-20 md:pt-28">
          <p className="text-[11px] font-medium normal-case tracking-wider text-violet-400">Platform</p>
          <h1 className="mt-3 font-serif text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-white">
            Where every agent runs
          </h1>
          <p className="mt-6 max-w-2xl text-[15px] leading-[1.8] text-slate-400">
            One registry answers four questions: which agent runs, on which runtime, through which model, and with
            which tools. Every row links to the files that prove it. A row is only marked live when production
            answered for it.
          </p>
          <dl className="mt-8 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-4">
            <Stat term="Deployments" value={registry.deployments.length} />
            <Stat term="Runtimes" value={registry.runtimes.length} />
            <Stat term="Providers" value={registry.providers.length} />
            <Stat term="MCP tools" value={toolCount} />
          </dl>
          <p className="mt-6 text-[13px] text-slate-400">
            Checked <time dateTime={registry.verifiedAt}>{registry.verifiedAt}</time> · Source{" "}
            <a href={fileUrl("platform/stack-registry.v1.json")} className={LINK} target="_blank" rel="noopener noreferrer">
              platform/stack-registry.v1.json
            </a>{" "}
            · Checker{" "}
            <a href={fileUrl("scripts/check-stack-registry.mjs")} className={LINK} target="_blank" rel="noopener noreferrer">
              scripts/check-stack-registry.mjs
            </a>
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
        <Section id="status" eyebrow="How to read it" heading="What each status means">
          <ul className="grid gap-4 md:grid-cols-3">
            {STATUSES.map((s) => (
              <li key={s} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
                <StatusChip status={s} />
                <p className="mt-3 text-[14px] leading-[1.7] text-slate-300">{registry.statusRules[s]}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-[1.7] text-slate-400">
            The checker enforces these rules in CI: every cited file must exist, a live row needs deploy evidence and a
            recorded production response, and no row can be further along than the runtime it runs on.
          </p>
        </Section>

        <Section id="deployments" eyebrow="01" heading="Agents and where they run">
          <nav aria-label="Filter deployments" className="space-y-3">
            <FilterRow label="Status">
              <FilterLink href={hrefWith(filters, { status: null })} active={!filters.status}>All</FilterLink>
              {STATUSES.map((s) => (
                <FilterLink key={s} href={hrefWith(filters, { status: s })} active={filters.status === s}>
                  {STATUS_LABEL[s]}
                </FilterLink>
              ))}
            </FilterRow>
            <FilterRow label="Runtime">
              <FilterLink href={hrefWith(filters, { platform: null })} active={!filters.platform}>All</FilterLink>
              {platforms.map((p) => (
                <FilterLink key={p} href={hrefWith(filters, { platform: p })} active={filters.platform === p}>
                  {PLATFORM_LABEL[p] ?? p}
                </FilterLink>
              ))}
            </FilterRow>
            <FilterRow label="Model provider">
              <FilterLink href={hrefWith(filters, { provider: null })} active={!filters.provider}>All</FilterLink>
              {routedProviders.map((p) => (
                <FilterLink key={p} href={hrefWith(filters, { provider: p })} active={filters.provider === p}>
                  {providerById.get(p)?.name ?? p}
                </FilterLink>
              ))}
            </FilterRow>
          </nav>

          <p className="mt-6 text-[13px] text-slate-400" aria-live="polite">
            Showing {deployments.length} of {registry.deployments.length} deployments
            {filtered ? (
              <>
                {" "}
                ·{" "}
                <Link href="/platform#deployments" className={LINK}>
                  Clear filters
                </Link>
              </>
            ) : null}
          </p>

          {deployments.length === 0 ? (
            <p className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 text-[14px] text-slate-300">
              No deployment matches these filters. Try another runtime or clear the filters.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0c0c12]" tabIndex={0} role="region" aria-label="Deployments table">
              <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
                <caption className="sr-only">Agents, their runtime, model route, tools, skills, status, and evidence</caption>
                <thead>
                  <tr className="border-b border-white/[0.08] font-mono text-[10px] normal-case tracking-wider text-slate-400">
                    <th scope="col" className="px-4 py-3 font-medium">Agent</th>
                    <th scope="col" className="px-4 py-3 font-medium">Runtime</th>
                    <th scope="col" className="px-4 py-3 font-medium">Model route</th>
                    <th scope="col" className="px-4 py-3 font-medium">Tools and skills</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] align-top">
                  {deployments.map((d) => {
                    const runtime = runtimeById.get(d.runtime);
                    const provider = providerById.get(d.modelRoute.provider);
                    const via = d.modelRoute.via ? providerById.get(d.modelRoute.via) : undefined;
                    return (
                      <tr key={d.id}>
                        <th scope="row" className="px-4 py-4 font-normal">
                          {d.agent.kind === "registered" ? (
                            <a href={fileUrl(`agents/${d.agent.id}.md`)} className={`${LINK} font-mono text-[12px]`} target="_blank" rel="noopener noreferrer">
                              {d.agent.id}
                            </a>
                          ) : (
                            <span className={CODE}>{d.agent.id}</span>
                          )}
                          <span className="mt-1 block text-[12px] text-slate-400">
                            {d.agent.kind === "registered" ? "Registered agent" : "Service identity, not in agents/"}
                          </span>
                          <p className="mt-2 max-w-[18rem] text-[12px] leading-[1.6] text-slate-400">{d.notes}</p>
                          <EvidenceList item={d} />
                        </th>
                        <td className="px-4 py-4 text-slate-200">
                          {runtime?.name ?? d.runtime}
                          <span className="mt-1 block text-[12px] text-slate-400">{PLATFORM_LABEL[runtime?.platform ?? ""] ?? runtime?.platform}</span>
                        </td>
                        <td className="px-4 py-4 text-slate-200">
                          {provider?.name ?? d.modelRoute.provider}
                          {via ? <span className="block text-[12px] text-slate-400">via {via.name}</span> : null}
                          <ul className="mt-2 space-y-1">
                            {d.modelRoute.models.map((m) => (
                              <li key={m} className={CODE}>{m}</li>
                            ))}
                          </ul>
                          {!d.modelRoute.calls ? (
                            <span className="mt-2 block text-[12px] text-amber-300/90">Selects a model; makes no call</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          {d.mcpServers.length === 0 && d.skills.length === 0 ? (
                            <span className="text-[12px] text-slate-400">None recorded</span>
                          ) : null}
                          {d.mcpServers.map((id) => (
                            <span key={id} className="block text-[12px]">
                              MCP: {mcpById.get(id)?.name ?? id}
                            </span>
                          ))}
                          {d.skills.length > 0 ? (
                            <ul className="mt-1 space-y-0.5">
                              {d.skills.map((s) => (
                                <li key={s} className="font-mono text-[11px] text-slate-400">{s}</li>
                              ))}
                            </ul>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">
                          <StatusChip status={d.status} />
                          {d.liveCheck ? <LiveCheckNote check={d.liveCheck} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section id="runtimes" eyebrow="02" heading="Runtimes">
          <p className="text-[14px] leading-[1.75] text-slate-400">
            Each deployable unit and the config that defines it.{" "}
            {filtered ? `Filtered to ${runtimes.length} of ${registry.runtimes.length}.` : null}
          </p>
          {runtimes.length === 0 ? (
            <p className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 text-[14px] text-slate-300">
              No runtime matches these filters.
            </p>
          ) : (
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {runtimes.map((r) => (
                <Card key={r.id} title={r.name} meta={PLATFORM_LABEL[r.platform] ?? r.platform} status={r.status} item={r}>
                  {r.notes}
                </Card>
              ))}
            </ul>
          )}
        </Section>

        <Section id="providers" eyebrow="03" heading="Model and service providers">
          <p className="text-[14px] leading-[1.75] text-slate-400">
            Only environment variable names are recorded, never values.
            {filters.status ? ` Filtered to ${providers.length} ${STATUS_LABEL[filters.status].toLowerCase()} providers.` : null}
          </p>
          {providers.length === 0 ? (
            <p className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 text-[14px] text-slate-300">
              No provider has this status.
            </p>
          ) : (
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {providers.map((p) => (
                <Card key={p.id} title={p.name} meta={p.surface.integration} status={p.status} item={p}>
                  {p.surface.envVars.length > 0 ? (
                    <span className="block">
                      Env:{" "}
                      {p.surface.envVars.map((v, i) => (
                        <span key={v}>
                          {i > 0 ? ", " : null}
                          <code className={CODE}>{v}</code>
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {p.models && p.models.length > 0 ? (
                    <span className="mt-1 block">
                      Models:{" "}
                      {p.models.map((m, i) => (
                        <span key={m}>
                          {i > 0 ? ", " : null}
                          <code className={CODE}>{m}</code>
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="mt-2 block">{p.notes}</span>
                </Card>
              ))}
            </ul>
          )}
        </Section>

        <Section id="mcp" eyebrow="04" heading="MCP servers and their tools">
          <ul className="grid gap-4 md:grid-cols-2">
            {registry.mcpServers.map((m) => (
              <Card
                key={m.id}
                title={m.name}
                meta={`${m.transport} · ${m.runtime ? runtimeById.get(m.runtime)?.name ?? m.runtime : "Third-party host"}`}
                status={m.status}
                item={m}
              >
                <span className="block">{m.notes}</span>
                {m.tools.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[13px] text-slate-200 hover:text-white">
                      {m.tools.length} tool{m.tools.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {m.tools.map((t) => (
                        <li key={t} className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                          {t}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <span className="mt-2 block text-slate-400">Tools are defined by the host and not listed here.</span>
                )}
              </Card>
            ))}
          </ul>
        </Section>

        <Section id="specs" eyebrow="05" heading="Agent specs this repository implements">
          <ul className="grid gap-4 md:grid-cols-2">
            {registry.agentSpecs.map((s) => (
              <Card key={s.id} title={s.name} meta={s.validatedBy ? "Has a checker" : "No checker"} status={s.status} item={s}>
                {s.notes}
              </Card>
            ))}
          </ul>
        </Section>

        <Section id="limits" eyebrow="06" heading="What this page does not prove">
          <ul className="space-y-2 text-[14px] leading-[1.75] text-slate-300">
            <li>That a credential is set in production. Live means the deployed code path answered, not that every call behind it succeeds.</li>
            <li>That an agent is busy. A row records where an agent can run, not how often it does.</li>
            <li>
              Anything outside this repository. Agents that run only on someone&apos;s laptop or in another repository are
              not listed.
            </li>
          </ul>
          <p className="mt-6 text-[14px] leading-[1.75] text-slate-400">
            Found a wrong row? Edit{" "}
            <a href={fileUrl("platform/stack-registry.v1.json")} className={LINK} target="_blank" rel="noopener noreferrer">
              the registry
            </a>{" "}
            and run <code className={CODE}>node scripts/check-stack-registry.mjs --write</code>. See also{" "}
            <Link href="/verify" className={LINK}>Verify</Link> and <Link href="/architecture" className={LINK}>Architecture</Link>.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Stat({ term, value }: { term: string; value: number }) {
  return (
    <div className="bg-[#0a0a10] px-4 py-3">
      <dt className="font-mono text-[10px] normal-case tracking-wider text-slate-400">{term}</dt>
      <dd className="mt-1 font-mono text-xl text-white tabular-nums">{value}</dd>
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-[11px] normal-case tracking-wider ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function LiveCheckNote({ check }: { check: LiveCheck }) {
  return (
    <p className="mt-2 max-w-[14rem] text-[12px] leading-[1.6] text-slate-400">
      <a href={check.url} className={LINK} target="_blank" rel="noopener noreferrer">
        HTTP {check.httpStatus}
      </a>{" "}
      on <time dateTime={check.observedAt}>{check.observedAt}</time>. {check.note}
    </p>
  );
}

function EvidenceList({ item }: { item: Evidence }) {
  const groups: Array<[string, string[] | undefined]> = [
    ["Evidence", item.evidence],
    ["Deploy", item.deployEvidence],
    ["Checked by", item.validatedBy],
  ];
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[12px] text-slate-300 hover:text-white">Evidence files</summary>
      <dl className="mt-2 space-y-2">
        {groups
          .filter(([, paths]) => paths && paths.length > 0)
          .map(([label, paths]) => (
            <div key={label}>
              <dt className="font-mono text-[10px] normal-case tracking-wider text-slate-400">{label}</dt>
              <dd>
                <ul className="space-y-0.5">
                  {paths!.map((p) => (
                    <li key={p}>
                      <a href={fileUrl(p)} className={`${LINK} font-mono text-[11px] [overflow-wrap:anywhere]`} target="_blank" rel="noopener noreferrer">
                        {p}
                      </a>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
      </dl>
    </details>
  );
}

function Card({
  title,
  meta,
  status,
  item,
  children,
}: {
  title: string;
  meta: string;
  status: Status;
  item: Evidence;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        <StatusChip status={status} />
      </div>
      <p className="mt-1 text-[12px] text-slate-400">{meta}</p>
      <div className="mt-3 text-[13px] leading-[1.7] text-slate-300">{children}</div>
      {item.liveCheck ? <LiveCheckNote check={item.liveCheck} /> : null}
      <div className="mt-auto pt-2">
        <EvidenceList item={item} />
      </div>
    </li>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full font-mono text-[10px] normal-case tracking-wider text-slate-400 sm:w-32">{label}</span>
      <ul className="flex flex-wrap gap-2">{children}</ul>
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        aria-current={active ? "page" : undefined}
        className={`inline-flex min-h-[36px] items-center rounded-full border px-3 text-[12px] transition-micro ${
          active
            ? "border-violet-400/50 bg-violet-400/[0.12] text-white"
            : "border-white/[0.1] text-slate-300 hover:border-white/[0.25] hover:text-white"
        }`}
      >
        {children}
      </Link>
    </li>
  );
}

function Section({
  id,
  eyebrow,
  heading,
  children,
}: {
  id: string;
  eyebrow: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-16 scroll-mt-24 first:mt-0">
      <p className="text-[11px] font-medium normal-case tracking-wider text-slate-400">{eyebrow}</p>
      <h2 id={`${id}-heading`} className="mt-3 text-2xl font-semibold text-white md:text-3xl">
        {heading}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}
