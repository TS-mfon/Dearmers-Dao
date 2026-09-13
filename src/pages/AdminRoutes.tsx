import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Activity, Bell, ClipboardList, LogOut, RefreshCw, Settings, Shield, Users, Wallet } from "lucide-react";
import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { createWalletClient, custom, type Address } from "viem";

type Session = { actor: string; wallet: string; authMethod: string; csrf: string; expiresAt: string };
type Row = { _id?: string; identity?: string; wallet?: string; username?: string; name?: string; daoId?: string; title?: string; status?: string; banned?: boolean; type?: string; actor?: string; target?: string; createdAt?: string; kind?: string; error?: string; proposalId?: string };
type AdminData = { checks?: Array<{ name: string; ok: boolean; state: string; detail: string }>; analytics?: Record<string, number>; failedJobs?: Row[]; users?: Row[]; daos?: Row[]; proposals?: Row[]; events?: Row[]; duplicate?: boolean; email?: { status?: string; error?: string }; notifications?: number };
type AuthContext = { session: Session; request: (action: string, payload?: Record<string, unknown>) => Promise<AdminData> };
const AdminContext = createContext<AuthContext | null>(null);

async function loginRequest(payload?: Record<string, unknown>, csrf?: string) {
  const response = await fetch("/api/admin-auth", payload ? { method: "POST", headers: { "content-type": "application/json", ...(csrf ? { "x-admin-csrf": csrf } : {}) }, body: JSON.stringify(payload) } : undefined);
  const body = await response.json() as { session?: Session | null; error?: string };
  if (!response.ok) throw new Error(body.error || "Admin authentication failed.");
  return body;
}

function AdminShell() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void loginRequest().then((body) => { if (active) setSession(body.session || null); }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setReady(true); }); return () => { active = false; }; }, []);
  const request = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    const response = await fetch(`/api/admin?action=${encodeURIComponent(action)}`, payload ? { method: "POST", headers: { "content-type": "application/json", "x-admin-csrf": session?.csrf || "" }, body: JSON.stringify(payload) } : undefined);
    const body = await response.json() as AdminData & { error?: string };
    if (response.status === 401) setSession(null);
    if (!response.ok) throw new Error(body.error || "Admin request failed.");
    return body;
  }, [session?.csrf]);
  const authenticate = async (mode: "wallet" | "password") => {
    setBusy(mode); setError("");
    try {
      let result;
      if (mode === "password") result = await loginRequest({ action: "password", password });
      else {
        const provider = (window as unknown as { ethereum?: Parameters<typeof custom>[0] }).ethereum;
        if (!provider) throw new Error("No browser wallet was found. Open this page in your wallet browser, install a wallet extension, or use password login.");
        const client = createWalletClient({ transport: custom(provider) });
        const [wallet] = await client.requestAddresses();
        if (!wallet) throw new Error("Select an admin wallet to continue.");
        const challengeResponse = await fetch("/api/admin-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "challenge", wallet }) });
        const challenge = await challengeResponse.json() as { nonce: string; message: string; error?: string };
        if (!challengeResponse.ok) throw new Error(challenge.error || "Could not obtain a wallet challenge.");
        const signature = await client.signMessage({ account: wallet as Address, message: challenge.message });
        result = await loginRequest({ action: "wallet", wallet, nonce: challenge.nonce, signature });
      }
      setSession(result.session || null); setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in failed."); }
    finally { setBusy(""); }
  };
  const logout = async () => { setBusy("logout"); try { await loginRequest({ action: "logout" }, session?.csrf); setSession(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Logout failed."); } finally { setBusy(""); } };
  return <div className="admin-route"><aside className="admin-sidebar"><a className="back-link" href="/explorer">← Back to covenants</a><span className="eyebrow"><Shield size={14} /> PROTOCOL ADMIN</span><h1>Network<br /><em>operations.</em></h1>{session && <><p className="hint">Signed in with {session.authMethod}{session.wallet ? ` · ${session.wallet.slice(0, 8)}…` : ""}</p><button className="ghost-button" disabled={Boolean(busy)} onClick={() => void logout()}><LogOut size={14} /> Sign out</button><nav aria-label="Protocol administration">{[["", "Monitor", Activity], ["bulletin", "Bulletin", Bell], ["proposals", "Proposals", ClipboardList], ["members", "Members", Users], ["settings", "Settings", Settings], ["audit", "Audit", Shield]].map(([path, label, Icon]) => { const Symbol = Icon as typeof Activity; return <NavLink key={String(path)} end to={`/control-room${path ? `/${path}` : ""}`}><Symbol size={15} />{String(label)}</NavLink>; })}</nav></>}</aside><main className="admin-route-main">{error && <p className="notice error" role="alert">{error}</p>}{!ready ? <p role="status">Checking admin session…</p> : session ? <AdminContext.Provider value={{ session, request }}><Outlet /></AdminContext.Provider> : <section className="route-section narrow-route"><span className="eyebrow">RESTRICTED ACCESS</span><h2>Sign in to administration</h2><p className="route-lede">Use an allowlisted wallet or the protocol password. Neither method grants access to another DAO’s treasury.</p><button className="primary-button" disabled={Boolean(busy)} onClick={() => void authenticate("wallet")}><Wallet size={16} />{busy === "wallet" ? "Waiting for wallet…" : "Connect admin wallet"}</button><form className="stack admin-login-form" onSubmit={(event) => { event.preventDefault(); void authenticate("password"); }}><label>Admin password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /></label><button className="ghost-button" disabled={Boolean(busy) || !password}>{busy === "password" ? "Signing in…" : "Sign in with password"}</button></form></section>}</main></div>;
}

function useAdminData(action: string) {
  const auth = useContext(AdminContext)!;
  const [data, setData] = useState<AdminData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await auth.request(action)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load admin data."); } finally { setLoading(false); } }, [action, auth]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  return { data, loading, error, load, request: auth.request };
}
function Heading({ title, children }: { title: string; children?: ReactNode }) { return <header className="admin-page-heading"><h2>{title}</h2>{children}</header>; }
function Feedback({ loading, error }: { loading: boolean; error: string }) { return <>{loading && <p role="status">Loading…</p>}{error && <p className="notice error" role="alert">{error}</p>}</>; }
function Dashboard() {
  const { data, loading, error, load } = useAdminData("monitor");
  return <><Heading title="Network overview"><button className="ghost-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} /> Refresh</button></Heading><Feedback loading={loading} error={error} /><div className="route-grid admin-metrics">{Object.entries(data.analytics || {}).map(([name, value]) => <article className="route-card" key={name}><span className="eyebrow">{name}</span><strong className="admin-metric-value">{value}</strong></article>)}</div><section className="route-section"><h3>Integration status</h3><div className="route-card-grid">{data.checks?.map((check) => <article className="route-card" key={check.name}><span className={`status ${check.ok ? "status-1" : "status-3"}`}>{check.state.replaceAll("_", " ")}</span><h3>{check.name}</h3><p>{check.detail}</p></article>)}</div></section><section className="route-section"><h3>Needs attention</h3>{!loading && !error && !data.failedJobs?.length && <p className="empty">No failed jobs recorded.</p>}{data.failedJobs?.map((job, index) => <article className="admin-log-row" key={index}><strong>{job.kind} · {job.status}</strong><p>{job.error}</p>{job.daoId && <a href={`/dao/${job.daoId}${job.proposalId ? `/proposals/${job.proposalId}` : "/control-room"}`}>Open affected item →</a>}</article>)}</section></>;
}
function Bulletin() {
  const { request } = useContext(AdminContext)!;
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setNotice(""); try { const result = await request("protocol-announcement", { title, body }); setNotice(result.duplicate ? "This bulletin was already published." : `Bulletin published. ${result.notifications || 0} notifications; email ${result.email?.status || "not attempted"}${result.email?.error ? `: ${result.email.error}` : ""}.`); setTitle(""); setBody(""); } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Publishing failed."); } finally { setBusy(false); } };
  return <><Heading title="Publish a protocol bulletin" /><p className="route-lede">A platform announcement, separate from individual DAO announcements.</p><form className="stack narrow-route" onSubmit={submit}><label>Title<input required maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Message<textarea required maxLength={5000} rows={8} value={body} onChange={(event) => setBody(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? "Publishing…" : "Publish bulletin"}</button></form>{notice && <p className="notice" role="status">{notice}</p>}</>;
}
function Proposals() { const { data, loading, error } = useAdminData("overview"); return <><Heading title="Protocol proposal directory" /><p className="route-lede">Review and voting interventions belong to each DAO’s administrators.</p><Feedback loading={loading} error={error} />{!loading && !error && !data.proposals?.length && <p className="empty">No proposals yet.</p>}<div className="route-card-grid">{data.proposals?.map((item) => <a className="route-card" key={item._id} href={`/dao/${item.daoId}/proposals/${item._id}`}><span className="status">{item.status?.replaceAll("_", " ")}</span><h3>{item.title}</h3><span>Open proposal →</span></a>)}</div></>; }
function Members() {
  const { data, loading, error, request, load } = useAdminData("overview"); const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const moderate = async (item: Row, kind: "ban-user" | "ban-dao") => { const target = kind === "ban-user" ? item.identity : item.daoId; if (!target) return; setBusy(target); try { await request(kind, { target, banned: !item.banned }); setNotice("Discovery moderation saved."); await load(); } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Moderation failed."); } finally { setBusy(""); } };
  return <><Heading title="Discovery moderation" /><Feedback loading={loading} error={error} />{notice && <p role="status" className="notice">{notice}</p>}{([['Profiles', data.users, 'ban-user'], ['DAOs', data.daos, 'ban-dao']] as const).map(([label, items, kind]) => <section className="route-section" key={label}><h3>{label}</h3>{!loading && !error && !items?.length && <p className="empty">No {label.toLowerCase()} yet.</p>}{items?.map((item) => <article className="admin-log-row" key={item._id}><strong>{item.username || item.name || "Unnamed profile"}</strong><span>{item.banned ? "Hidden from discovery" : "Visible"}</span><button className="ghost-button" disabled={Boolean(busy) || !(item.identity || item.daoId)} onClick={() => void moderate(item, kind)}>{item.banned ? "Restore visibility" : "Hide from discovery"}</button></article>)}</section>)}</>;
}
function SettingsPage() { const { data, loading, error } = useAdminData("settings"); return <><Heading title="Configuration and DAO controls" /><Feedback loading={loading} error={error} /><section className="route-section"><h3>Deployment configuration</h3><p className="hint">Secrets are managed in the deployment environment, never in browser forms.</p>{data.checks?.map((check) => <div className="admin-log-row" key={check.name}><strong>{check.name}</strong><span>{check.state.replaceAll("_", " ")} · {check.detail}</span></div>)}</section><section className="route-section"><h3>DAO-owned settings</h3><p className="route-lede">Mission, media, constitution and enforced treasury limits are edited by that DAO’s authorized administrator.</p>{!loading && !error && !data.daos?.length && <p className="empty">Create a DAO to configure its identity and treasury.</p>}{data.daos?.map((dao) => <div className="admin-log-row" key={dao.daoId}><strong>{dao.name}</strong><a href={`/dao/${dao.daoId}/control-room/identity`}>Identity →</a><a href={`/dao/${dao.daoId}/control-room/settings`}>Treasury and policy →</a></div>)}</section></>; }
function Audit() { const { data, loading, error } = useAdminData("audit"); return <><Heading title="Protocol audit history" /><Feedback loading={loading} error={error} />{!loading && !error && !data.events?.length && <p className="empty">No protocol actions recorded.</p>}{data.events?.map((event) => <article className="admin-log-row" key={event._id}><strong>{event.type}</strong><span>{event.actor} · {event.target || "Protocol"}</span><time>{event.createdAt ? new Date(event.createdAt).toLocaleString() : ""}</time></article>)}</>; }

export function ProtocolAdminRoutes() { return <Routes><Route element={<AdminShell />}><Route index element={<Dashboard />} /><Route path="bulletin" element={<Bulletin />} /><Route path="proposals" element={<Proposals />} /><Route path="members" element={<Members />} /><Route path="settings" element={<SettingsPage />} /><Route path="audit" element={<Audit />} /><Route path="*" element={<Navigate to="/control-room" replace />} /></Route></Routes>; }
