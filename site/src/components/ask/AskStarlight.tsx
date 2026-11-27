"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, CornerDownLeft } from "lucide-react";
import { askDesk, waitPhrase, type DeskOutcome, type DeskResponse } from "@/lib/desk/ask-client";
import { costFigure } from "@/lib/desk/cost-copy";
import { MAX_QUESTION_CHARS } from "@/lib/desk/question";
import { referenceList } from "@/lib/desk/references";
import { DeskBrief } from "@/components/desk/DeskBrief";

type Failure = Extract<DeskOutcome, { ok: false }>;

type State =
  | { phase: "idle" }
  | { phase: "loading"; question: string }
  | { phase: "done"; question: string; data: DeskResponse }
  | { phase: "error"; question: string; failure: Failure };

/** A run's deadline is 55 s; past this the copy says it is near the end. */
const SLOW_AFTER_MS = 30_000;
/** Show the counter once the question is this close to the limit. */
const COUNT_FROM = MAX_QUESTION_CHARS - 80;

/**
 * Ask Starlight: the homepage's one-question front door to the Desk.
 *
 * It posts to the same metered endpoint the Desk page uses and shows a compact
 * result: the brief, its numbered references, the cited share, the cost, and
 * the receipt ID. The Desk page keeps the stage-by-stage view.
 */
export function AskStarlight({ suggestions }: { suggestions: string[] }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ids = useId();
  const inputId = `${ids}-question`;
  const hintId = `${ids}-hint`;
  const countId = `${ids}-count`;

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const pending = state.phase === "loading";
  const trimmed = question.trim();

  const submit = useCallback(async () => {
    if (!trimmed || pending) return;
    setState({ phase: "loading", question: trimmed });
    setExpanded(false);
    setElapsed(0);
    const startedAt = Date.now();
    timer.current = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    const outcome = await askDesk(trimmed);
    if (timer.current) clearInterval(timer.current);
    setState(
      outcome.ok
        ? { phase: "done", question: trimmed, data: outcome.data }
        : { phase: "error", question: trimmed, failure: outcome },
    );
  }, [trimmed, pending]);

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a12]/90 shadow-[0_0_60px_rgba(124,58,237,0.12)] backdrop-blur"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${ids}-title`} className="text-sm font-semibold text-white">
            <label htmlFor={inputId}>Ask Starlight</label>
          </h2>
          <p className="font-mono text-[11px] text-slate-500" aria-hidden={pending ? true : undefined}>
            {pending ? <Elapsed ms={elapsed} /> : "Metered · daily limits"}
          </p>
        </div>
        <p id={hintId} className="mt-1.5 text-[13px] leading-6 text-slate-400">
          Ask a research question. The Desk searches the web, keeps only quotes it finds word for word in a source, and
          writes a short brief that cites them.
        </p>

        <div className="relative mt-3">
          <textarea
            ref={inputRef}
            id={inputId}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={2}
            maxLength={MAX_QUESTION_CHARS}
            aria-describedby={`${hintId} ${countId}`}
            readOnly={pending}
            placeholder="What should I know about…"
            className="block w-full resize-none rounded-lg border border-white/[0.1] bg-black/50 py-3 pl-4 pr-28 text-[15px] leading-7 text-slate-100 outline-none transition-micro placeholder:text-slate-600 focus:border-violet-400/50 focus-visible:ring-2 focus-visible:ring-violet-400/60 read-only:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || trimmed.length === 0}
            className="absolute bottom-2 right-2 inline-flex min-h-10 items-center gap-1.5 rounded-md bg-white px-3.5 text-[13px] font-semibold text-slate-950 transition-micro hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a12] disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-slate-500"
          >
            {pending ? "Running…" : "Ask"}
            {pending ? null : <CornerDownLeft size={14} aria-hidden="true" />}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>Enter to ask · Shift+Enter for a new line</span>
          <span
            id={countId}
            className={`font-mono tabular-nums ${question.length >= MAX_QUESTION_CHARS ? "text-amber-300" : ""}`}
          >
            {question.length >= COUNT_FROM ? `${question.length} / ${MAX_QUESTION_CHARS} characters` : ""}
          </span>
        </div>

        {suggestions.length > 0 ? (
          <div className="mt-3">
            <p className="sr-only">Suggested questions. Choosing one fills the box; nothing runs until you ask.</p>
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setQuestion(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="max-w-full rounded-md border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-left text-[12px] leading-5 text-slate-300 transition-micro hover:border-white/[0.2] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:opacity-40"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-3 text-[12px] leading-5 text-slate-500">
          Every run calls paid models and web search, so runs are metered and capped per address and per day. A run can
          take up to a minute. Public runs don&rsquo;t read or write memory.
        </p>
      </form>

      <div aria-live="polite" className={state.phase === "idle" ? undefined : "border-t border-white/[0.08]"}>
        {state.phase === "loading" ? <Loading elapsed={elapsed} /> : null}
        {state.phase === "error" ? <ErrorView failure={state.failure} /> : null}
        {state.phase === "done" ? (
          <ResultView data={state.data} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
        ) : null}
      </div>
    </section>
  );
}

function Elapsed({ ms }: { ms: number }) {
  return <span className="tabular-nums">{(ms / 1000).toFixed(0)} s</span>;
}

function Loading({ elapsed }: { elapsed: number }) {
  return (
    <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-400 motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div className="text-[13px] leading-6 text-slate-300">
        <p>Searching, checking quotes, and writing the brief.</p>
        {/* Visual only: a ticking number in a live region would be read out every second. */}
        <p className="text-slate-500" aria-hidden="true">
          {(elapsed / 1000).toFixed(0)} s elapsed
          {elapsed > SLOW_AFTER_MS ? " · nearly there; runs stop at about 55 s" : " · usually under a minute"}
        </p>
      </div>
    </div>
  );
}

function ErrorView({ failure }: { failure: Failure }) {
  if (failure.kind === "offline") {
    return (
      <div role="status" className="px-4 py-4 text-[13px] leading-6 sm:px-5">
        <p className="font-medium text-slate-200">The Desk is offline right now.</p>
        <p className="mt-1 text-slate-400">
          Nothing ran and nothing was spent. It needs its model and search keys and a working run counter before it takes
          questions.
        </p>
        <Link
          href="/desk"
          className="mt-2 inline-flex min-h-10 items-center gap-1.5 font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
        >
          Read how the Desk works
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (failure.kind === "limit") {
    return (
      <div role="alert" className="px-4 py-4 text-[13px] leading-6 sm:px-5">
        <p className="font-medium text-amber-200">You&rsquo;ve hit a run limit.</p>
        <p className="mt-1 text-slate-300">{failure.error}</p>
        {failure.retryAfter !== null ? (
          <p className="mt-1 text-slate-400">Try again in {waitPhrase(failure.retryAfter)}.</p>
        ) : null}
      </div>
    );
  }

  if (failure.kind === "invalid") {
    return (
      <div role="alert" className="px-4 py-4 text-[13px] leading-6 sm:px-5">
        <p className="font-medium text-amber-200">That question can&rsquo;t run as written.</p>
        <p className="mt-1 text-slate-300">{failure.error}</p>
      </div>
    );
  }

  return (
    <div role="alert" className="px-4 py-4 text-[13px] leading-6 sm:px-5">
      <p className="font-medium text-rose-200">
        {failure.kind === "unreachable" ? "No answer from the Desk." : "The run stopped before it finished."}
      </p>
      <p className="mt-1 text-slate-300">{failure.error}</p>
      <p className="mt-1 text-slate-500">Try again, or try a narrower question.</p>
    </div>
  );
}

function ResultView({ data, expanded, onToggle }: { data: DeskResponse; expanded: boolean; onToggle: () => void }) {
  const references = useMemo(() => referenceList(data.claims ?? [], data.sources), [data]);
  const briefId = useId();
  const long = data.brief.length > 900;
  const seconds = (data.receipt.totals.latencyMs / 1000).toFixed(1);

  return (
    <div>
      <dl className="grid grid-cols-2 gap-px bg-white/[0.06] sm:grid-cols-4">
        <Stat label="Cited share" value={`${Math.round(data.groundingRate * 100)}%`} />
        <Stat label="Cost" value={costFigure(data.costComplete, data.receipt.totals.costEur)} />
        <Stat label="Time" value={`${seconds} s`} />
        <Stat label="Receipt" value={data.signed ? "Signed" : "Draft, unsigned"} />
      </dl>

      <div className="px-4 py-4 sm:px-5">
        <h3 className="text-[12px] font-semibold text-slate-400">Brief</h3>
        <div
          id={briefId}
          className={`relative mt-2 ${long && !expanded ? "max-h-72 overflow-hidden" : ""}`}
        >
          <DeskBrief text={data.brief} headingLevel={4} />
          {long && !expanded ? (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0a0a12] to-transparent"
              aria-hidden="true"
            />
          ) : null}
        </div>
        {long ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={briefId}
            className="mt-2 inline-flex min-h-10 items-center text-[13px] font-medium text-violet-300 underline decoration-violet-300/30 underline-offset-4 hover:decoration-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
          >
            {expanded ? "Show less" : "Show the full brief"}
          </button>
        ) : null}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-4 sm:px-5">
        <h3 className="text-[12px] font-semibold text-slate-400">
          References {references.length > 0 ? `(${references.length})` : ""}
        </h3>
        {references.length > 0 ? (
          <ol className="mt-2 space-y-2.5">
            {references.map((reference) => (
              <li key={reference.index} className="flex gap-3 text-[13px] leading-6">
                <span className="w-7 shrink-0 font-mono text-[11px] leading-6 text-slate-500">[{reference.index}]</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-3 break-words text-slate-300">&ldquo;{reference.quote}&rdquo;</p>
                  <a
                    href={reference.url}
                    rel="noopener noreferrer nofollow ugc"
                    target="_blank"
                    className="block truncate text-[12px] text-slate-400 underline decoration-white/20 underline-offset-4 hover:text-white"
                  >
                    {reference.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-[13px] leading-6 text-slate-400">
            {data.sources.length === 0
              ? "No sources came back for this question, so the brief has nothing to cite."
              : `${data.sources.length} source${data.sources.length === 1 ? "" : "s"} came back, but no quote survived the check, so the brief cites nothing. Treat it as unsupported.`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="min-w-0 break-all font-mono text-[11px] leading-5 text-slate-500">
          Receipt {data.receipt.receiptId}
        </p>
        <Link
          href="/desk"
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 self-start rounded-md border border-white/[0.14] px-3.5 text-[13px] font-semibold text-white transition-micro hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 sm:self-auto"
        >
          See every stage in the Desk
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse bg-[#0a0a12] px-4 py-3">
      <dt className="mt-0.5 text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className="truncate font-mono text-[15px] tabular-nums text-white">{value}</dd>
    </div>
  );
}
