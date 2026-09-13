import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSessionHeaders } from "../lib/session";
import { reviewLabel, reviewPending, type Proposal, type ReviewCapabilities, type ReviewJob } from "../../shared/proposals";

export type ProposalResponse = { proposal: Proposal; job: ReviewJob | null; capabilities: ReviewCapabilities; canVote: boolean; vote?: { status: string; txHash?: string; support: boolean } | null };
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
    setData(body); onUpdate?.(body); setError("");
    return body as ProposalResponse;
  }, [url, headers, onUpdate]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal).catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, authenticated]);
  const run = useCallback(async (action: string, hash?: string) => {
    setBusy(action); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { ...(await headers()), "content-type": "application/json" }, body: JSON.stringify({ action, hash }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update AI review.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Review request failed."); }
    finally { setBusy(""); }
  }, [url, headers, load]);
  useEffect(() => {
    if (!data || (!reviewPending(data.proposal.status) && !["active_voting", "passed", "execution_pending"].includes(data.proposal.status))) return;
    const timer = window.setInterval(() => {
      if (document.hidden || busy) return;
      if (data.capabilities.canRefresh) void run("refresh-review");
      else void load().catch((reason: Error) => setError(reason.message));
    }, 8000);
    return () => window.clearInterval(timer);
  }, [data, busy, load, run]);
  if (!data) return <section className="evaluation-panel"><p role={error ? "alert" : "status"}>{error || "Loading proposal review…"}</p>{error && <button className="ghost-button" onClick={() => void load().catch((reason: Error) => setError(reason.message))}>Try again</button>}</section>;
  const { proposal, job, capabilities } = data;
  return <section className="evaluation-panel" aria-label="AI review"><span className="eyebrow"><ShieldCheck size={14} /> GENLAYER REVIEW</span><h3 aria-live="polite">{reviewLabel(proposal.status, job)}</h3><p>{proposal.evaluation?.reasoning || proposal.evaluation?.critique || "Claims and evidence are unverified until independently evaluated against this DAO’s mission and constitution. AI approval opens member voting; it does not transfer funds."}</p>{job?.genlayerStatus && <p className="hint">Network: {job.genlayerStatus} · {job.updatedAt ? `Updated ${new Date(job.updatedAt).toLocaleTimeString()}` : ""}</p>}{(error || job?.error) && <p className="notice error" role="alert">{error || job?.error}</p>}<div className="admin-actions">{capabilities.canStart && <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run("start-review")}>{busy === "start-review" ? "Submitting review…" : "Start AI Review"}</button>}{capabilities.canRetry && <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run("retry-review")}>{job?.status === "relay_failed" ? "Complete Review Relay" : "Retry AI Review"}</button>}{capabilities.canRefresh && <button className="ghost-button" disabled={Boolean(busy)} onClick={() => void run("refresh-review")}><RefreshCw size={14} />{busy ? "Checking…" : "Check Status"}</button>}{!authenticated && reviewPending(proposal.status) && <button className="ghost-button" onClick={() => login()}>Sign in to manage your review</button>}{job?.genlayerTxHash && <a href={job.explorerUrl || `https://explorer-studio-dev.genlayer.com/tx/${job.genlayerTxHash}`} target="_blank" rel="noreferrer">GenLayer transaction <ExternalLink size={13} /></a>}</div>{capabilities.canRecover && <form className="stack" onSubmit={(event) => { event.preventDefault(); void run("recover-review", recoveryHash); }}><label>Finalized GenLayer transaction hash<input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value)} placeholder="0x…" pattern="0x[a-fA-F0-9]{64}" required /></label><button className="ghost-button" disabled={Boolean(busy)}>Recover submitted review</button></form>}{proposal.evaluation && <details className="review-evidence"><summary>Evidence and evaluation report</summary>{[["Evidence", proposal.evaluation.evidence_report], ["Corrections", proposal.evaluation.corrections], ["Uncertainty", proposal.evaluation.uncertainty]].map(([label, value]) => value && <section key={label}><h4>{label}</h4><p className="preserve-lines">{value}</p></section>)}<p className="hint">Policy version: {proposal.evaluation.rules_version || "Not reported"}</p></details>}{capabilities.canReplace && <Link className="ghost-button" to={`/dao/${daoId}/proposals/create?supersedes=${proposalId}`}>Create revised proposal →</Link>}</section>;
}
