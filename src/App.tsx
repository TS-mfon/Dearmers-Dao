import { useCallback, useEffect, useState } from "react";
import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { ArrowRight, ArrowUpRight, Building2, Landmark, RefreshCw, Search as SearchIcon, Sparkles, Users, Wallet, X } from "lucide-react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Address, Hash } from "viem";
import { explainContractError, listDaos, REGISTRY_ADDRESS, walletClient, type DaoRecord } from "./lib/dao";
import { CreateOrganisationWizard } from "./components/forge/CreateOrganisationWizard";
import { ExplorerPage } from "./pages/ExplorerPage";
import { ProfilePage } from "./pages/ProfilePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { CreateProposalRoute, DaoAnnouncementsRoute, DaoChatRoute, DaoHistoryRoute, DaoMembersRoute, DaoOverviewRoute, DaoProposalsRoute, GrantApplyRoute, GrantDetailRoute, GrantExplorerRoute, ProposalDetailRoute } from "./pages/DaoRoutes";
import { AdminBulletinRoute, AdminDashboardRoute, AdminMembersRoute, AdminProposalsRoute, AdminSettingsRoute } from "./pages/AdminRoutes";
import "./App.css";

type Notice = { tone: "info" | "success" | "error"; text: string };

function App() {
  const [account, setAccount] = useState<Address | "">("");
  const [daos, setDaos] = useState<DaoRecord[]>([]);
  const [selected, setSelected] = useState<DaoRecord | null>(null);
  const [notice, setNotice] = useState<Notice>({ tone: "info", text: REGISTRY_ADDRESS ? "Connect your wallet to begin." : "Deploy the registry and set VITE_DEARMERS_REGISTRY." });
  const [busy, setBusy] = useState("");

  const connect = async (): Promise<Address | undefined> => {
    try {
      const client = await walletClient();
      setAccount(client.account!.address);
      setNotice({ tone: "success", text: `Connected ${client.account!.address}` });
      return client.account!.address;
    } catch (error) { setNotice({ tone: "error", text: explainContractError(error) }); return undefined; }
  };

  const refresh = useCallback(async () => {
    if (!REGISTRY_ADDRESS) return;
    try {
      const records = await listDaos();
      setDaos(records);
    } catch (error) { setNotice({ tone: "error", text: explainContractError(error) }); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const created = async (daoId: Hash) => { await refresh(); const record = (await listDaos()).find((item) => item.daoId === daoId); if (record) setSelected(record); };
  return <BrowserRouter><OnboardingGate onConnect={connect}><ProductShell><Routes>
    <Route path="/" element={<SanctuaryLanding account={account} onConnect={connect} />} />
    <Route path="/sanctuary" element={<SanctuaryLanding account={account} onConnect={connect} />} />
    <Route path="/explorer" element={<ExplorerPage daos={daos} />} />
    <Route path="/dao/:daoId" element={<DaoOverviewRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/overview" element={<DaoOverviewRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/proposals" element={<DaoProposalsRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/proposals/create" element={<CreateProposalRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/proposals/:proposalId" element={<ProposalDetailRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/chat" element={<DaoChatRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/announcements" element={<DaoAnnouncementsRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/history" element={<DaoHistoryRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/dao/:daoId/members" element={<DaoMembersRoute daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/profile/:wallet" element={<ProfilePage account={account} onNotice={setNotice} />} />
    <Route path="/profile/identity/:identity" element={<ProfilePage account={account} onNotice={setNotice} />} />
    <Route path="/profile" element={<ProfilePage account={account} onNotice={setNotice} />} />
    <Route path="/profile/edit" element={<ProfilePage account={account} onNotice={setNotice} />} />
    <Route path="/notifications" element={<NotificationsPage account={account} onNotice={setNotice} />} />
    <Route path="/__protocol" element={<Navigate to="/control-room" replace />} />
    <Route path="/control-room" element={<AdminDashboardRoute />} />
    <Route path="/control-room/bulletin" element={<AdminBulletinRoute onNotice={setNotice} />} />
    <Route path="/control-room/proposals" element={<AdminProposalsRoute onNotice={setNotice} />} />
    <Route path="/control-room/members" element={<AdminMembersRoute onNotice={setNotice} />} />
    <Route path="/control-room/settings" element={<AdminSettingsRoute />} />
    <Route path="/forge" element={<WorkspacePage title="Forge a Covenant" eyebrow="COVENANT INCEPTION" icon={<Landmark />} account={account} daos={daos} selected={selected} setSelected={setSelected} notice={notice} refresh={refresh} connect={connect} busy={busy}>
      <CreateOrganisationWizard account={account} onBusy={setBusy} onNotice={setNotice} onCreated={created} />
    </WorkspacePage>} />
    <Route path="/governance" element={<Navigate to="/explorer" replace />} />
    <Route path="/treasury" element={<Navigate to="/control-room" replace />} />
    <Route path="/council" element={<Navigate to="/explorer" replace />} />
    <Route path="/grants" element={<GrantExplorerRoute />} />
    <Route path="/grant-programs" element={<GrantExplorerRoute />} />
    <Route path="/grants/:grantId" element={<GrantDetailRoute />} />
    <Route path="/grants/:grantId/apply" element={<GrantApplyRoute onNotice={setNotice} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></ProductShell></OnboardingGate>{busy && <div className="busy-overlay"><RefreshCw className="spin"/><strong>{busy}</strong><span>Confirm in your wallet and keep this tab open.</span></div>}</BrowserRouter>;
}

function ProductShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const standalone = location.pathname === "/" || location.pathname === "/sanctuary";
  const embedded = ["/forge", "/governance", "/treasury", "/council"].includes(location.pathname);
  useEffect(() => {
    const open = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); } if (event.key === "Escape") setSearchOpen(false); };
    window.addEventListener("keydown", open); return () => window.removeEventListener("keydown", open);
  }, []);
  if (standalone || embedded) return <>{children}</>;
  return <div className="product-shell"><header className="product-nav-shell"><Link className="brand-lockup" to="/sanctuary"><img className="brand-logo" src="/dreamers-dao-logo.svg" alt="Dreamers DAO"/><span><span className="eyebrow">THE DAO FOR DREAMERS</span><strong>Dreamers<span>-Dao</span></strong></span></Link><nav className="product-nav-links" aria-label="Product navigation"><Link className={location.pathname === "/explorer" ? "active" : ""} to="/explorer">Explore</Link><Link className={location.pathname.startsWith("/grants") ? "active" : ""} to="/grants">Grants</Link><Link className={location.pathname.startsWith("/notifications") ? "active" : ""} to="/notifications">Signals</Link><Link className={location.pathname.startsWith("/profile") ? "active" : ""} to="/profile">Profile</Link></nav><div className="product-nav-actions"><button className="search-trigger" onClick={() => setSearchOpen(true)}><SearchIcon size={15}/><span>Search network</span><kbd>⌘K</kbd></button><Link className="primary-button" to="/forge">Forge</Link></div></header>{children}<nav className="mobile-product-nav" aria-label="Mobile navigation"><Link className={location.pathname === "/explorer" ? "active" : ""} to="/explorer"><SearchIcon size={17}/><span>Explore</span></Link><Link className={location.pathname === "/forge" ? "active" : ""} to="/forge"><Landmark size={17}/><span>Forge</span></Link><Link className={location.pathname === "/notifications" ? "active" : ""} to="/notifications"><Sparkles size={17}/><span>Signals</span></Link><Link className={location.pathname.startsWith("/profile") ? "active" : ""} to="/profile"><Users size={17}/><span>Profile</span></Link></nav>{searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} onNavigate={(path) => { setSearchOpen(false); navigate(path); }}/>}</div>;
}

function GlobalSearch({ onClose, onNavigate }: { onClose: () => void; onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [results, setResults] = useState<{ daos: Array<{ daoId: string; name: string; description?: string }>; profiles: Array<{ wallet?: string; identity?: string; username?: string; displayName?: string; bio?: string }> }>({ daos: [], profiles: [] });
  useEffect(() => { const timer = window.setTimeout(() => { if (!query.trim()) { setResults({ daos: [], profiles: [] }); return; } setLoading(true); setError(""); fetch(`/api/search?q=${encodeURIComponent(query.trim())}`).then(async (response) => { const body = await response.json() as typeof results & { error?: string }; if (!response.ok) throw new Error(body.error || "Search is unavailable."); setResults({ daos: body.daos || [], profiles: body.profiles || [] }); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Search is unavailable.")).finally(() => setLoading(false)); }, 220); return () => window.clearTimeout(timer); }, [query]);
  return <div className="search-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="global-search" role="dialog" aria-modal="true" aria-label="Search network"><div className="global-search-head"><div><span className="eyebrow"><SearchIcon size={13}/> NETWORK SEARCH</span><h2>Find your next<br/><em>covenant or collaborator.</em></h2></div><button className="icon-button" onClick={onClose} aria-label="Close search"><X size={18}/></button></div><label className="global-search-input"><SearchIcon size={18}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search DAOs, people, missions…"/><kbd>ESC</kbd></label>{loading && <div className="search-status">Reading the network signal…</div>}{error && <div className="search-error">{error}<button className="text-button" onClick={() => setQuery((value) => `${value} `)}>Retry</button></div>}{!loading && !error && query && !results.daos.length && !results.profiles.length && <div className="search-empty"><Sparkles size={22}/><strong>No matching signal yet.</strong><span>Try a DAO name, builder handle, or mission keyword.</span></div>}<div className="search-results">{results.daos.length > 0 && <div><span className="search-group-label">COVENANTS</span>{results.daos.map((dao) => <button key={dao.daoId} onClick={() => onNavigate(`/dao/${dao.daoId}`)}><span className="search-result-mark"><Landmark size={15}/></span><span><strong>{dao.name}</strong><small>{dao.description || "Constitution-led organisation"}</small></span><ArrowUpRight size={15}/></button>)}</div>}{results.profiles.length > 0 && <div><span className="search-group-label">PEOPLE</span>{results.profiles.map((profile) => <button key={profile.wallet || profile.identity || profile.username} onClick={() => onNavigate(profile.wallet ? `/profile/${profile.wallet}` : profile.identity ? `/profile/identity/${encodeURIComponent(profile.identity)}` : "/profile")}><span className="search-result-mark"><Users size={15}/></span><span><strong>{profile.displayName || profile.username || "Anonymous dreamer"}</strong><small>{profile.bio || "Network contributor"}</small></span><ArrowUpRight size={15}/></button>)}</div>}</div></section></div>;
}

function OnboardingGate({ onConnect, children }: { onConnect: () => Promise<Address | undefined>; children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const emailLogin = useLoginWithEmail({ onComplete: () => undefined });
  const [stage, setStage] = useState<"auth" | "profile">("auth");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [walletAccount, setWalletAccount] = useState<Address | "">("");
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem("dearmers_profile_prompt_seen") === "1");
  const isLanding = location.pathname === "/" || location.pathname === "/sanctuary";
  const open = ready && !isLanding && !dismissed;
  const close = () => { window.localStorage.setItem("dearmers_profile_prompt_seen", "1"); setDismissed(true); };
  const saveProfile = async () => { if (!handle.trim()) return; try { setSaving(true); const token = await getAccessToken(); const wallet = user?.wallet?.address || walletAccount || undefined; let signature = ""; if (wallet && !token) { const client = await walletClient(); signature = await client.signMessage({ account: client.account!, message: `Dearmers-Dao\nAction: save-profile\nWallet: ${wallet.toLowerCase()}\nResource: ${handle}` }); } const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ wallet, signature, identity: user ? `privy:${user.id}` : undefined, email: user?.email?.address || email, username: handle, displayName: handle, bio }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Profile could not be created."); window.dispatchEvent(new Event("dearmers:profile-updated")); close(); navigate("/profile"); } catch (error) { window.alert(error instanceof Error ? error.message : "Profile could not be created."); } finally { setSaving(false); } };
  const authenticateEmail = async () => { try { if (!codeSent) { await emailLogin.sendCode({ email: email.trim() }); setCodeSent(true); } else { await emailLogin.loginWithCode({ code }); } } catch (error) { window.alert(error instanceof Error ? error.message : "Privy email authentication failed."); } };
  const currentStage = authenticated ? "profile" : stage;
  return <>{children}{open && <div className="profile-onboarding-backdrop" role="presentation"><section className="profile-onboarding" role="dialog" aria-modal="true" aria-labelledby="profile-onboarding-title"><button className="profile-onboarding-close" onClick={close} aria-label="Close profile setup"><X size={18}/></button><div className="onboarding-sigil"><Sparkles size={18}/></div><span className="eyebrow">{currentStage === "auth" ? "FIRST ENTRY / AUTHENTICATE" : "SECOND ENTRY / PROFILE SIGNAL"}</span><h2 id="profile-onboarding-title">{currentStage === "auth" ? <>Enter the<br/><em>living network.</em></> : <>Make your presence<br/><em>legible to the network.</em></>}</h2><p>{currentStage === "auth" ? "Choose a wallet or use Privy email authentication. Your identity unlocks participation without blocking read-only discovery." : "Choose the name and signal other DAOs will recognise. You can refine this profile later."}</p>{currentStage === "auth" ? <div className="onboarding-options"><button className="onboarding-wallet" onClick={async () => { const connected = await onConnect(); if (connected) { setWalletAccount(connected); setStage("profile"); } }}><Wallet size={18}/><span><strong>Continue with wallet</strong><small>MetaMask identity for onchain actions</small></span><ArrowRight size={16}/></button><div className="onboarding-email"><span>Privy email login</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" disabled={codeSent}/>{codeSent && <input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="6-digit code"/>}<button type="button" disabled={!email || (codeSent && !code)} onClick={() => void authenticateEmail()}>{codeSent ? "Verify code" : "Send secure code"}</button>{authenticated && <button type="button" onClick={() => setStage("profile")}>Continue to profile</button>}</div></div> : <div className="onboarding-profile-form"><label><span>Public handle</span><input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="e.g. mfon.builds" autoFocus/></label><label><span>Role / short bio</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder="What are you building or contributing?" rows={4}/></label><button className="primary-button" disabled={saving || !handle.trim()} onClick={() => void saveProfile()}>{saving ? "Saving identity…" : "Create my profile"}<ArrowRight size={16}/></button></div>}<small className="onboarding-note">Wallet actions remain wallet-authorized. Privy handles email authentication; your profile is persisted in MongoDB.</small></section></div>}</>;
}

type WorkspaceProps = { title: string; eyebrow: string; icon: React.ReactNode; account: Address | ""; daos: DaoRecord[]; selected: DaoRecord | null; setSelected: (dao: DaoRecord) => void; notice: Notice; refresh: () => Promise<void>; connect: () => Promise<Address | undefined>; busy: string; children: React.ReactNode };
function WorkspacePage({ title, eyebrow, icon, account, daos, selected, setSelected, notice, refresh, connect, children }: WorkspaceProps) { return <div className="dearmers-shell workspace-shell"><header className="dearmers-header"><Link className="brand-lockup" to="/sanctuary"><img className="brand-logo" src="/dreamers-dao-logo.svg" alt="Dreamers DAO" /><span><span className="eyebrow">THE DAO FOR DREAMERS</span><h1>Dreamers<span>-Dao</span></h1></span></Link><nav className="protocol-nav" aria-label="Primary"><Link to="/explorer">Explore</Link><Link to="/sanctuary">Sanctuary</Link><Link to="/forge">Forge</Link><Link to="/governance">Governance</Link><Link to="/grants">Grants</Link><Link to="/notifications">Signals</Link></nav><div className="header-actions"><Link className="ghost-button" to={account ? `/profile/${account}` : "/profile"}>Profile</Link><button className="ghost-button" onClick={() => void refresh()}><RefreshCw size={16}/> Refresh</button><button className="primary-button" onClick={() => void connect()}><Wallet size={16}/>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Enter sanctuary"}</button></div></header><div className={`notice ${notice.tone}`}>{notice.text}</div><div className="page-banner"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><span className="page-symbol">{icon}</span></div><main className="dearmers-grid"><aside className="dao-sidebar"><div className="panel-title"><Building2 size={17}/> SOVEREIGN DAOS</div><Link className="sidebar-forge" to="/forge">+ Forge a covenant</Link><Link className="sidebar-forge" to="/explorer">Discover covenants →</Link><div className="dao-list">{daos.map((dao) => <button key={dao.daoId} className={`dao-card ${selected?.daoId === dao.daoId ? "active" : ""}`} onClick={() => setSelected(dao)}><strong>{dao.name}</strong><span>{dao.mode === 1 ? "Grant DAO" : "Operating DAO"}</span><small>{dao.dao.slice(0, 8)}…{dao.dao.slice(-6)}</small></button>)}{!daos.length && <p className="empty">No DAOs registered yet. Forge the first covenant.</p>}</div></aside><section className="workspace">{children}</section></main></div>; }

function SanctuaryLanding({ account, onConnect }: { account: Address | ""; onConnect: () => Promise<Address | undefined> }) {
  return <section className="sanctuary-landing" aria-label="Dearmers sanctuary">
    <header className="landing-topbar"><Link className="landing-brand" to="/"><img src="/dreamers-dao-logo.svg" alt="Dreamers DAO"/><span><b>Dreamers-Dao</b><small>The Dao for Dreamers</small></span></Link><nav><Link to="/explorer">Explore</Link><Link to="/profile">Profile</Link><Link className="primary-button" to="/forge">Forge a covenant</Link></nav></header>
    <div className="landing-orbit orbit-one" /><div className="landing-orbit orbit-two" />
    <div className="landing-copy"><span className="landing-sigil">AUTONOMOUS DAO OPERATING ENGINE <span>///</span></span><div className="landing-rule" /><h2>Forge communities<br /><em>that govern themselves.</em></h2><p>Publish a constitution. Let GenLayer deliberate over evidence. Let the assembly authorize bounded action. Every DAO keeps its own treasury, members, and operating memory.</p><div className="landing-actions"><Link className="primary-button landing-cta" to="/forge">Forge a covenant <ArrowRight size={16} /></Link><Link className="ghost-button" to="/explorer">Explore the sanctuary</Link><button className="ghost-button" onClick={() => void onConnect()}>{account ? "Enter sanctuary" : "Connect to enter"}</button></div></div>
    <div className="landing-ticker"><span>LIVE PROTOCOL TICKER</span><div><b>—</b> Sovereign DAOs <strong>Awaiting first covenant</strong></div><div><b>—</b> GenLayer verdicts <strong>Consensus-bound</strong></div><div><b>—</b> Treasuries isolated <strong>One contract. One authority.</strong></div></div>
  </section>;
}

export default App;
