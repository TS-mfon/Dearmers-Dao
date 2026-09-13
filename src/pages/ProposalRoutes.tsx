import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePrivy, useSignTypedData } from "@privy-io/react-auth";
import type { Address } from "viem";
import { ProposalReview, type ProposalResponse } from "../components/ProposalReview";
import { useSessionHeaders } from "../lib/session";
import type { DaoRecord } from "../lib/dao";

type Props = { daos: DaoRecord[]; account: Address | ""; onNotice: (notice: { tone: "info" | "success" | "error"; text: string }) => void };
export function CreateProposalRoute({ onNotice }: Props) {
  const { daoId } = useParams(); const [search] = useSearchParams(); const navigate = useNavigate(); const headers = useSessionHeaders(); const { authenticated, login, linkWallet } = usePrivy();
  const [form, setForm] = useState({ title: "", description: "", amount: "0", recipient: "", category: "general", evidence: "" });
  const [clientKey] = useState(() => crypto.randomUUID()); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const supersedes = search.get("supersedes") || undefined;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!authenticated) return login();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/proposals", { method: "POST", headers: { ...(await headers()), "content-type": "application/json" }, body: JSON.stringify({ ...form, daoId, supersedes, clientKey, evidence: form.evidence.split("\n").map((value) => value.trim()).filter(Boolean) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Proposal submission failed.");
      onNotice({ tone: body.warning ? "info" : "success", text: body.job?.genlayerTxHash ? "Proposal saved and AI review submitted." : "Proposal saved. Start or recover AI Review from its detail page." });
      navigate(`/dao/${daoId}/proposals/${body.proposal._id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Proposal submission failed."); }
    finally { setSaving(false); }
  };
  return <div className="route-page narrow-route"><Link className="back-link" to={`/dao/${daoId}/proposals`}>← DAO proposals</Link><h1>{supersedes ? "Revise your proposal" : "Create a proposal"}</h1><p className="route-lede">Save your proposal and start an independent GenLayer review. Member voting opens only after finalized approval.</p>{supersedes && <p className="notice">This creates a new proposal linked to the original; its evidence and review remain unchanged. <Link to={`/dao/${daoId}/proposals/${supersedes}`}>Read the original review →</Link></p>}{authenticated && <button className="ghost-button" onClick={() => linkWallet()}>Link or switch proposal wallet</button>}<form className="stack" onSubmit={submit}><label>Title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>What should the DAO resolve?<textarea required rows={7} maxLength={10000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Requested USDC<input type="number" min="0" step="0.000001" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /><small>Use 0 for a non-spending governance decision.</small></label>{Number(form.amount) > 0 && <label>Recipient wallet<input required value={form.recipient} onChange={(event) => setForm({ ...form, recipient: event.target.value })} placeholder="0x…" /></label>}<label>Evidence links <small>HTTPS only, one URL per line</small><textarea rows={4} value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} /></label>{error && <p className="notice error" role="alert">{error}</p>}<button className="primary-button" disabled={saving}>{saving ? "Saving and requesting review…" : authenticated ? "Submit proposal" : "Sign in to submit"}</button></form></div>;
}

export function ProposalDetailRoute({ onNotice }: Props) {
  const { daoId = "", proposalId = "" } = useParams(); const headers = useSessionHeaders(); const { signTypedData } = useSignTypedData();
  const [data, setData] = useState<ProposalResponse | null>(null); const [busy, setBusy] = useState(false); const [voteVersion, setVoteVersion] = useState(0); const [now, setNow] = useState(0);
  const update = useCallback((response: ProposalResponse) => setData(response), []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const vote = async (support: boolean) => {
    const proposal = data?.proposal; if (!proposal || !data.canVote) return;
    setBusy(true);
    try {
      const nonce = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`); const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const signed = await signTypedData({ types: { VoteIntent: [{ name: "daoId", type: "string" }, { name: "proposalId", type: "uint256" }, { name: "support", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "VoteIntent", domain: { name: "Dearmers DAO", version: "1", chainId: 84532, verifyingContract: proposal.daoAddress as Address }, message: { daoId, proposalId: BigInt(proposal.onchainProposalId!), support, nonce, deadline } });
      const response = await fetch("/api/votes", { method: "POST", headers: { ...(await headers()), "content-type": "application/json" }, body: JSON.stringify({ proposalId, support, signature: signed.signature, nonce: nonce.toString(), deadline: deadline.toString() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Vote failed.");
      onNotice({ tone: "success", text: result.message || "Vote submitted. Waiting for onchain confirmation." }); setVoteVersion((value) => value + 1);
    } catch (reason) { onNotice({ tone: "error", text: reason instanceof Error ? reason.message : "Vote failed." }); }
    finally { setBusy(false); }
  };
  const proposal = data?.proposal; const remaining = proposal?.votingEndsAt ? new Date(proposal.votingEndsAt).getTime() - now : 0;
  return <div className="route-page narrow-route"><Link className="back-link" to={`/dao/${daoId}/proposals`}>← DAO proposals</Link>{proposal && <><span className="status">{proposal.status.replaceAll("_", " ")}</span><h1>{proposal.title}</h1><p className="route-lede preserve-lines">{proposal.description}</p><p>{proposal.amount || "0"} USDC · {proposal.kind === "non_spend" ? "Non-spending decision" : "Funding request"}</p>{proposal.supersedes && <Link to={`/dao/${daoId}/proposals/${proposal.supersedes}`}>Original proposal and review →</Link>}</>}<ProposalReview key={`${proposalId}:${voteVersion}`} daoId={daoId} proposalId={proposalId} onUpdate={update} />{proposal?.status === "active_voting" && <section className="vote-panel"><h3>Member decision</h3><p>{remaining > 0 ? `${Math.floor(remaining / 3600000)}h ${Math.floor(remaining / 60000) % 60}m remaining` : "Voting closed · awaiting onchain finalization"}</p><p>Yes: {proposal.yesWeight || "0"} · No: {proposal.noWeight || "0"}</p>{data?.vote ? <p role="status">Your {data.vote.support ? "yes" : "no"} vote is {data.vote.status || "pending"}.{data.vote.txHash && <a href={`https://sepolia.basescan.org/tx/${data.vote.txHash}`} target="_blank" rel="noreferrer"> View transaction ↗</a>}</p> : data?.canVote && remaining > 0 ? <div className="vote-actions"><button className="primary-button" disabled={busy} onClick={() => void vote(true)}>{busy ? "Submitting…" : "Vote yes"}</button><button className="ghost-button" disabled={busy} onClick={() => void vote(false)}>Vote no</button></div> : <p>Voting requires active DAO membership and a verified linked wallet.</p>}</section>}{proposal?.executionHash && <a href={`https://sepolia.basescan.org/tx/${proposal.executionHash}`} target="_blank" rel="noreferrer">Confirmed execution transaction ↗</a>}</div>;
}
