import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSessionHeaders } from "../lib/session";
import { reviewAdvisory, reviewLabel, reviewMessage, reviewPending, reviewSettled, type EvidenceFinding, type ExecutionJob, type Proposal, type ReviewCapabilities, type ReviewJob } from "../../shared/proposals";

export type ProposalResponse = { proposal: Proposal; job: ReviewJob | null; executionJob?: ExecutionJob | null; capabilities: ReviewCapabilities; canVote: boolean; vote?: { status: string; txHash?: string; support: boolean } | null };
type SourceRecord = EvidenceFinding & { content?: string };

function compact(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeSourceUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}

function summarizeHtml(content: string) {
  if (typeof DOMParser === "undefined") return { title: "", description: "", excerpt: compact(content.replace(/<[^>]+>/g, " "), 900) };
  const document = new DOMParser().parseFromString(content, "text/html");
  return {
    title: compact(document.querySelector("title")?.textContent || "", 240),
    description: compact(document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute("content") || "", 600),
    excerpt: compact(document.body?.textContent || "", 900),
  };
}

function normalizeSource(value: unknown): SourceRecord | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const content = typeof source.content === "string" ? source.content : "";
  const legacy = content ? summarizeHtml(content) : { title: "", description: "", excerpt: "" };
  const status = Number(source.status);
  return {
    url: safeSourceUrl(source.url),
    retrieved: source.retrieved === true,
    status: Number.isFinite(status) ? status : undefined,
    title: compact(String(source.title || legacy.title || ""), 240),
    description: compact(String(source.description || legacy.description || ""), 600),
    excerpt: compact(String(source.excerpt || legacy.excerpt || ""), 900),
    limitations: compact(String(source.limitations || source.uncertainty || ""), 500),
  };
}

function parseEvidenceReport(raw?: string) {
  if (!raw) return [] as SourceRecord[];
  try {
    const decoded = JSON.parse(raw) as unknown;
    const values = Array.isArray(decoded) ? decoded : [decoded];
    return values.map(normalizeSource).filter((value): value is SourceRecord => Boolean(value));
  } catch {
    const legacy = summarizeHtml(raw);
    return [{ retrieved: false, title: legacy.title || "Legacy evidence report", description: legacy.description, excerpt: legacy.excerpt, limitations: "This older report was not stored as structured source data." }];
  }
}

function FindingSection({ title, value }: { title: string; value?: string }) {
  if (!value) return null;
  return <section><h4>{title}</h4><p className="preserve-lines">{value}</p></section>;
}

export function ProposalReview({ daoId, proposalId, onUpdate }: { daoId: string; proposalId: string; onUpdate?: (data: ProposalResponse) => void }) {
  const headers = useSessionHeaders();
  const { authenticated, login } = usePrivy();
  const [data, setData] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [recoveryHash, setRecoveryHash] = useState("");
  const url = `/api/proposals?daoId=${encodeURIComponent(daoId)}&proposalId=${encodeURIComponent(proposalId)}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(url, { headers: await headers(), signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Proposal status unavailable.");
    setData(body);
    onUpdate?.(body);
    setError("");
    return body as ProposalResponse;
  }, [url, headers, onUpdate]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal).catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, authenticated]);
  const run = useCallback(async (action: string, hash?: string) => {
    setBusy(action);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { ...(await headers()), "content-type": "application/json" }, body: JSON.stringify({ action, hash }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update AI review.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Review request failed."); }
    finally { setBusy(""); }
  }, [url, headers, load]);
  useEffect(() => {
    // A settled job cannot change without a member action, and polling it burns GenLayer execution slots.
    if (!data || reviewSettled(data.job) || (!reviewPending(data.proposal.status) && !["active_voting", "passed", "execution_pending"].includes(data.proposal.status))) return;
    const timer = window.setInterval(() => {
      if (document.hidden || busy) return;
      if (data.capabilities.canRefresh) void run("refresh-review");
      else void load().catch((reason: Error) => setError(reason.message));
    }, 8000);
    return () => window.clearInterval(timer);
  }, [data, busy, load, run]);
  const sources = useMemo(() => parseEvidenceReport(data?.proposal.evaluation?.evidence_report), [data?.proposal.evaluation?.evidence_report]);
  if (!data) return <section className="evaluation-panel"><p role={error ? "alert" : "status"}>{error || "Loading proposal review…"}</p>{error && <button className="ghost-button" onClick={() => void load().catch((reason: Error) => setError(reason.message))}>Try again</button>}</section>;
  const { proposal, job, executionJob, capabilities } = data;
  const evaluation = proposal.evaluation;
  const advisory = reviewAdvisory(proposal.status, job);
  const notice = reviewMessage(job);
  return <section className="evaluation-panel" aria-label="AI review">
    <span className="eyebrow"><ShieldCheck size={14} /> GENLAYER REVIEW</span>
    <h3 aria-live="polite">{reviewLabel(proposal.status, job)}</h3>
    <p>{evaluation?.reasoning || evaluation?.critique || "Claims and evidence are unverified until independently evaluated against this DAO’s mission and constitution. AI approval opens member voting; it does not transfer funds."}</p>
    {job?.genlayerStatus && <p className="hint">Network: {job.genlayerStatus} · {job.updatedAt ? `Updated ${new Date(job.updatedAt).toLocaleTimeString()}` : ""}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!error && advisory && <p className="notice" role="status">{notice || "This DAO’s validators did not reach consensus on this review. Anything shown below is advisory only — it does not open member voting."}</p>}
    {!error && !advisory && (notice || executionJob?.error) && <p className="notice error" role="alert">{notice || executionJob?.error}</p>}
    <div className="admin-actions">
      {capabilities.canStart && <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run("start-review")}>{busy === "start-review" ? "Submitting review…" : "Start AI Review"}</button>}
      {capabilities.canRetry && <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run("retry-review")}>{job?.status === "relay_failed" ? "Complete Review Relay" : "Retry AI Review"}</button>}
      {capabilities.canRefresh && <button className="ghost-button" disabled={Boolean(busy)} onClick={() => void run("refresh-review")}><RefreshCw size={14} />{busy ? "Checking…" : "Check Status"}</button>}
      {capabilities.canReconcileExecution && <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run("reconcile-execution")}>{busy === "reconcile-execution" ? "Reconciling…" : proposal.status === "active_voting" ? "Finalize voting and execute" : "Retry automatic execution"}</button>}
      {!authenticated && reviewPending(proposal.status) && <button className="ghost-button" onClick={() => login()}>Sign in to manage your review</button>}
      {job?.genlayerTxHash && <a href={job.explorerUrl || `https://explorer-studio-dev.genlayer.com/tx/${job.genlayerTxHash}`} target="_blank" rel="noreferrer">GenLayer transaction <ExternalLink size={13} /></a>}
    </div>
    {executionJob && <p className="hint">Execution: {executionJob.status.replaceAll("_", " ")}{executionJob.paymentHash ? " · payment confirmed" : ""}</p>}
    {capabilities.canRecover && <form className="stack" onSubmit={(event) => { event.preventDefault(); void run("recover-review", recoveryHash); }}><label>Finalized GenLayer transaction hash<input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value)} placeholder="0x…" pattern="0x[a-fA-F0-9]{64}" required /></label><button className="ghost-button" disabled={Boolean(busy)}>Recover submitted review</button></form>}
    {evaluation && <details className="review-evidence" open>
      <summary>{advisory ? "Advisory assessment — no consensus reached" : "Evidence and evaluation report"}</summary>
      <div className="evaluation-metrics">{advisory && <span>Consensus <strong>Not reached</strong></span>}<span>Outcome <strong>{evaluation.outcome?.replaceAll("_", " ") || evaluation.decision}</strong></span>{evaluation.score !== undefined && <span>Score <strong>{evaluation.score}/100</strong></span>}{evaluation.fit_score !== undefined && <span>Fit <strong>{evaluation.fit_score}/100</strong></span>}{evaluation.risk !== undefined && <span>Risk <strong>{evaluation.risk}/100</strong></span>}</div>
      <FindingSection title="Reasoning" value={evaluation.reasoning || evaluation.critique} />
      <FindingSection title="Weak spots" value={evaluation.weak_spots} />
      <FindingSection title="Required corrections" value={evaluation.corrections} />
      <FindingSection title="Suggested improvements" value={evaluation.improvements} />
      <FindingSection title="Uncertainty" value={evaluation.uncertainty} />
      <section><h4>Sources</h4>{sources.length ? <div className="evidence-source-list">{sources.map((source, index) => <article className="evidence-source" key={`${source.url || "source"}-${index}`}><div><span className={`source-status ${source.retrieved ? "retrieved" : "unavailable"}`}>{source.retrieved ? `Retrieved${source.status ? ` · HTTP ${source.status}` : ""}` : `Unavailable${source.status ? ` · HTTP ${source.status}` : ""}`}</span>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title || new URL(source.url).hostname} <ExternalLink size={12} /></a> : <strong>{source.title || `Source ${index + 1}`}</strong>}</div>{source.description && <p>{source.description}</p>}{source.excerpt && <p className="source-excerpt">{source.excerpt}</p>}{source.limitations && <small>{source.limitations}</small>}</article>)}</div> : <p className="hint">No source records were stored for this evaluation.</p>}</section>
      {evaluation.evidence_report && <details className="raw-evidence"><summary>Raw normalized report</summary><pre>{evaluation.evidence_report.slice(0, 4000)}</pre></details>}
      <p className="hint">Policy version: {evaluation.rules_version || "Not reported"}</p>
    </details>}
    {capabilities.canReplace && <Link className="ghost-button" to={`/dao/${daoId}/proposals/create?supersedes=${proposalId}`}>Create revised proposal →</Link>}
  </section>;
}
