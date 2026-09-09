import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSessionHeaders } from "../lib/session";

type Job = { daoId?: string; daoAddress?: string; txHash?: string; status?: string; error?: string; indexed?: boolean };

export function DaoCreationStatusPage() {
  const { clientKey } = useParams();
  const navigate = useNavigate();
  const headers = useSessionHeaders();
  const [job, setJob] = useState<Job>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!clientKey) return;
    try {
      const response = await fetch(`/api/dao-creation?clientKey=${encodeURIComponent(clientKey)}`, { headers: await headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Creation status unavailable.");
      setJob(body); setError("");
      if (body.indexed && body.daoId) navigate(`/dao/${body.daoId}`, { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Creation status unavailable."); }
  }, [clientKey, headers, navigate]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); const interval = window.setInterval(() => void load(), 5000); return () => { window.clearTimeout(timer); window.clearInterval(interval); }; }, [load]);
  const failed = job.status === "failed" || Boolean(error);
  const complete = job.status === "indexed" || job.indexed;
  return <div className="route-page creation-status-page"><Link className="back-link" to="/explorer">Back to explorer</Link><span className="eyebrow">DAO CREATION</span><h1>{failed ? "Creation needs attention." : complete ? "Your DAO is ready." : "Your DAO is being created."}</h1><p className="route-lede">{failed ? job.error || error : complete ? "The covenant is indexed and ready to explore." : "The platform relayer is confirming the registry transaction. Keep this page open; we will move you forward automatically."}</p><section className="creation-status-card"><div className={`creation-status-icon ${failed ? "failed" : complete ? "complete" : "pending"}`}>{failed ? <XCircle size={28}/> : complete ? <CheckCircle2 size={28}/> : <Clock3 size={28}/>}</div><div><strong>{job.status || "checking"}</strong><span>{job.daoId ? `DAO id: ${job.daoId.slice(0, 14)}…` : "Waiting for the creation job"}</span>{job.txHash && <a href={`https://sepolia.basescan.org/tx/${job.txHash}`} target="_blank" rel="noreferrer">View Base Sepolia transaction <ExternalLink size={14}/></a>}</div></section><div className="creation-status-actions"><button className="ghost-button" onClick={() => void load()}><RefreshCw size={15}/> Refresh status</button>{complete && job.daoId && <Link className="primary-button" to={`/dao/${job.daoId}`}>Open DAO <ArrowRight size={15}/></Link>}{failed && <button className="primary-button" onClick={() => void load()}>Retry status</button>}</div></div>;
}
