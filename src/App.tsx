import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Brain, Building2, CircleDollarSign, FileCheck2, Landmark, RefreshCw, ShieldCheck, Sparkles, Users, Wallet, X } from "lucide-react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Address, Hash } from "viem";
import { parseUnits } from "viem";
import { explainContractError, listDaos, readDao, REGISTRY_ADDRESS, USDC_ADDRESS, walletClient, writeDao, type DaoRecord } from "./lib/dao";
import { executorAddress, requestDelegationPermissions } from "./lib/delegation";
import { evaluateWithDearmers, setDearmersConstitution, setEvaluatorAddress } from "./lib/dearmers-genlayer";
import { CreateOrganisationWizard } from "./components/forge/CreateOrganisationWizard";
import { ExplorerPage } from "./pages/ExplorerPage";
import { DaoDetailPage } from "./pages/DaoDetailPage";
import { ProfilePage } from "./pages/ProfilePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProtocolAdminPage } from "./pages/ProtocolAdminPage";
import { GrantAssemblyPage } from "./pages/GrantAssemblyPage";
import "./App.css";

const statusNames = ["Pending review", "Revision required", "Voting", "Rejected", "Approved", "Executed", "Escalated", "Paused"];
const applicationStatusNames = ["Submitted", "Revision required", "Eligible", "Rejected", "Voting", "Selected", "Not selected", "Active", "Completed", "Cancelled"];
const zeroAddress = "0x0000000000000000000000000000000000000000";

type Notice = { tone: "info" | "success" | "error"; text: string };

type ProposalView = {
  proposer: Address; recipient: Address; amount: bigint; constitutionVersion: bigint; eligibleWeightSnapshot: bigint;
  yesWeight: bigint; noWeight: bigint; createdAt: bigint; votingEndsAt: bigint; kind: number; status: number;
  evidenceHash: Hash; verdictHash: Hash; executionHash: Hash; title: string; description: string; category: string; evidenceUri: string;
};

function App() {
  const [account, setAccount] = useState<Address | "">("");
  const [daos, setDaos] = useState<DaoRecord[]>([]);
  const [selected, setSelected] = useState<DaoRecord | null>(null);
  const [proposalCount, setProposalCount] = useState(0n);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [notice, setNotice] = useState<Notice>({ tone: "info", text: REGISTRY_ADDRESS ? "Connect your wallet to begin." : "Deploy the registry and set VITE_DEARMERS_REGISTRY." });
  const [busy, setBusy] = useState("");

  const connect = async () => {
    try {
      const client = await walletClient();
      setAccount(client.account!.address);
      setNotice({ tone: "success", text: `Connected ${client.account!.address}` });
    } catch (error) { setNotice({ tone: "error", text: explainContractError(error) }); }
  };

  const refresh = useCallback(async () => {
    if (!REGISTRY_ADDRESS) return;
    try {
      const records = await listDaos();
      setDaos(records);
    } catch (error) { setNotice({ tone: "error", text: explainContractError(error) }); }
  }, []);

  const refreshProposals = useCallback(async () => {
    if (!selected) return;
    try {
      const count = await readDao<bigint>(selected.dao, "proposalCount");
      const loaded = await Promise.all(Array.from({ length: Number(count) }, (_, index) => readDao<ProposalView>(selected.dao, "getProposal", [BigInt(index)])));
      setProposalCount(count);
      setProposals(loaded);
    } catch (error) { setNotice({ tone: "error", text: explainContractError(error) }); }
  }, [selected]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { const timer = window.setTimeout(() => void refreshProposals(), 0); return () => window.clearTimeout(timer); }, [refreshProposals]);

  const created = async (daoId: Hash) => { await refresh(); const record = (await listDaos()).find((item) => item.daoId === daoId); if (record) setSelected(record); };
  return <BrowserRouter><OnboardingGate onConnect={connect}><Routes>
    <Route path="/" element={<SanctuaryLanding account={account} onConnect={connect} />} />
    <Route path="/sanctuary" element={<SanctuaryLanding account={account} onConnect={connect} />} />
    <Route path="/explorer" element={<ExplorerPage daos={daos} />} />
    <Route path="/dao/:daoId" element={<DaoDetailPage daos={daos} account={account} onNotice={setNotice} />} />
    <Route path="/profile/:wallet" element={<ProfilePage account={account} onNotice={setNotice} />} />
    <Route path="/profile" element={<ProfilePage account={account} onNotice={setNotice} />} />
    <Route path="/notifications" element={<NotificationsPage account={account} onNotice={setNotice} />} />
    <Route path="/__protocol" element={<ProtocolAdminPage account={account} onNotice={setNotice} />} />
    <Route path="/forge" element={<WorkspacePage title="Forge a Covenant" eyebrow="COVENANT INCEPTION" icon={<Landmark />} account={account} daos={daos} selected={selected} setSelected={setSelected} notice={notice} refresh={refresh} connect={connect} busy={busy}>
      <CreateOrganisationWizard account={account} onBusy={setBusy} onNotice={setNotice} onCreated={created} />
    </WorkspacePage>} />
    <Route path="/governance" element={<WorkspacePage title="Governance Chamber" eyebrow="SACRED DECREES" icon={<FileCheck2 />} account={account} daos={daos} selected={selected} setSelected={setSelected} notice={notice} refresh={refresh} connect={connect} busy={busy}>
      {selected ? <><WorkspaceMasthead selected={selected} proposalCount={proposalCount} /><div className="action-grid"><ProposalForm dao={selected} onBusy={setBusy} onNotice={setNotice} onDone={refreshProposals} /><ConstitutionForm dao={selected.dao} onBusy={setBusy} onNotice={setNotice} /></div><ProposalBoard dao={selected} proposals={proposals} account={account} onBusy={setBusy} onNotice={setNotice} onDone={refreshProposals} /></> : <SelectDao />}
    </WorkspacePage>} />
    <Route path="/treasury" element={<WorkspacePage title="Treasury Sanctum" eyebrow="ISOLATED SPENDING AUTHORITY" icon={<CircleDollarSign />} account={account} daos={daos} selected={selected} setSelected={setSelected} notice={notice} refresh={refresh} connect={connect} busy={busy}>
      {selected ? <><WorkspaceMasthead selected={selected} proposalCount={proposalCount} /><div className="action-grid"><DelegationForm dao={selected} onBusy={setBusy} onNotice={setNotice} /><ConstitutionForm dao={selected.dao} onBusy={setBusy} onNotice={setNotice} /></div></> : <SelectDao />}
    </WorkspacePage>} />
    <Route path="/council" element={<WorkspacePage title="Council Registry" eyebrow="INITIATES & CONVICTION" icon={<Users />} account={account} daos={daos} selected={selected} setSelected={setSelected} notice={notice} refresh={refresh} connect={connect} busy={busy}>
      {selected ? <><WorkspaceMasthead selected={selected} proposalCount={proposalCount} /><div className="action-grid"><MembershipForm dao={selected.dao} onBusy={setBusy} onNotice={setNotice} /><ProfileForm account={account} onBusy={setBusy} onNotice={setNotice} /></div></> : <SelectDao />}
    </WorkspacePage>} />
    <Route path="/grants" element={<GrantAssemblyPage daos={daos} account={account} onConnect={connect} onBusy={setBusy} onNotice={setNotice} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></OnboardingGate>{busy && <div className="busy-overlay"><RefreshCw className="spin"/><strong>{busy}</strong><span>Confirm in your wallet and keep this tab open.</span></div>}</BrowserRouter>;
}

function OnboardingGate({ onConnect, children }: { onConnect: () => Promise<void>; children: React.ReactNode }) {
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem("dearmers_profile_prompt_seen") === "1");
  const isLanding = location.pathname === "/" || location.pathname === "/sanctuary";
  const open = !isLanding && !dismissed;
  const close = () => { window.localStorage.setItem("dearmers_profile_prompt_seen", "1"); setDismissed(true); };
  return <>{children}{open && <div className="profile-onboarding-backdrop" role="presentation"><section className="profile-onboarding" role="dialog" aria-modal="true" aria-labelledby="profile-onboarding-title"><button className="profile-onboarding-close" onClick={close} aria-label="Close profile setup"><X size={18}/></button><div className="onboarding-sigil"><Sparkles size={18}/></div><span className="eyebrow">FIRST ENTRY / IDENTITY RITUAL</span><h2 id="profile-onboarding-title">Make your presence<br/><em>legible to the network.</em></h2><p>Set up a lightweight profile so DAOs can recognise your work, evidence, and contribution history. You can browse without it and finish later.</p><div className="onboarding-options"><button className="onboarding-wallet" onClick={async () => { await onConnect(); close(); }}><Wallet size={18}/><span><strong>Continue with wallet</strong><small>Best for voting, forging, and treasury actions</small></span><ArrowRight size={16}/></button><label className="onboarding-email"><span>Email signal</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/><button type="button" onClick={() => { if (email) window.localStorage.setItem("dearmers_profile_email", email); close(); }}>Save and browse</button></label></div><small className="onboarding-note">Your wallet remains the source of truth for onchain actions. No custody. No hidden permissions.</small></section></div>}</>;
}

type WorkspaceProps = { title: string; eyebrow: string; icon: React.ReactNode; account: Address | ""; daos: DaoRecord[]; selected: DaoRecord | null; setSelected: (dao: DaoRecord) => void; notice: Notice; refresh: () => Promise<void>; connect: () => Promise<void>; busy: string; children: React.ReactNode };
function WorkspacePage({ title, eyebrow, icon, account, daos, selected, setSelected, notice, refresh, connect, children }: WorkspaceProps) { return <div className="dearmers-shell workspace-shell"><header className="dearmers-header"><Link className="brand-lockup" to="/sanctuary"><span className="brand-mark">◈</span><span><span className="eyebrow">SOVEREIGN OPERATING ENGINE</span><h1>Dearmers<span>-Dao</span></h1></span></Link><nav className="protocol-nav" aria-label="Primary"><Link to="/explorer">Explore</Link><Link to="/sanctuary">Sanctuary</Link><Link to="/forge">Forge</Link><Link to="/governance">Governance</Link><Link to="/grants">Grants</Link><Link to="/notifications">Signals</Link></nav><div className="header-actions"><Link className="ghost-button" to={account ? `/profile/${account}` : "/profile"}>Profile</Link><button className="ghost-button" onClick={() => void refresh()}><RefreshCw size={16}/> Refresh</button><button className="primary-button" onClick={() => void connect()}><Wallet size={16}/>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Enter sanctuary"}</button></div></header><div className={`notice ${notice.tone}`}>{notice.text}</div><div className="page-banner"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><span className="page-symbol">{icon}</span></div><main className="dearmers-grid"><aside className="dao-sidebar"><div className="panel-title"><Building2 size={17}/> SOVEREIGN DAOS</div><Link className="sidebar-forge" to="/forge">+ Forge a covenant</Link><Link className="sidebar-forge" to="/explorer">Discover covenants →</Link><div className="dao-list">{daos.map((dao) => <button key={dao.daoId} className={`dao-card ${selected?.daoId === dao.daoId ? "active" : ""}`} onClick={() => setSelected(dao)}><strong>{dao.name}</strong><span>{dao.mode === 1 ? "Grant DAO" : "Operating DAO"}</span><small>{dao.dao.slice(0, 8)}…{dao.dao.slice(-6)}</small></button>)}{!daos.length && <p className="empty">No DAOs registered yet. Forge the first covenant.</p>}</div></aside><section className="workspace">{children}</section></main></div>; }
function WorkspaceMasthead({ selected, proposalCount }: { selected: DaoRecord; proposalCount: bigint }) { return <><div className="workspace-heading"><div><span className="eyebrow">{selected.mode === 1 ? "GRANT DAO" : "OPERATING DAO"}</span><h3>{selected.name}</h3><p>{selected.dao}</p></div><div className="pill">Treasury {selected.treasury.slice(0, 8)}…</div></div><div className="metric-row"><Metric icon={<FileCheck2/>} label="Sacred decrees" value={proposalCount.toString()}/><Metric icon={<ShieldCheck/>} label="Constitution" value="Versioned"/><Metric icon={<CircleDollarSign/>} label="Treasury" value="Isolated"/><Metric icon={<Brain/>} label="Review" value="GenLayer"/></div></>; }
function SelectDao() { return <div className="select-state"><Building2 size={34}/><h3>Select a sovereign DAO</h3><p>Choose a covenant from the left rail to enter its chamber.</p></div>; }
function SelectGrantDao() { return <div className="select-state"><Brain size={34}/><h3>This is not a Grant DAO</h3><p>Choose a grant fund or forge one at the covenant inception page.</p></div>; }

function SanctuaryLanding({ account, onConnect }: { account: Address | ""; onConnect: () => Promise<void> }) {
  return <section className="sanctuary-landing" aria-label="Dearmers sanctuary">
    <div className="landing-orbit orbit-one" /><div className="landing-orbit orbit-two" />
    <div className="landing-copy"><span className="landing-sigil">AUTONOMOUS DAO OPERATING ENGINE <span>///</span></span><div className="landing-rule" /><h2>Forge communities<br /><em>that govern themselves.</em></h2><p>Publish a constitution. Let GenLayer deliberate over evidence. Let the assembly authorize bounded action. Every DAO keeps its own treasury, members, and operating memory.</p><div className="landing-actions"><Link className="primary-button landing-cta" to="/forge">Forge a covenant <ArrowRight size={16} /></Link><Link className="ghost-button" to="/explorer">Explore the sanctuary</Link><button className="ghost-button" onClick={() => void onConnect()}>{account ? "Enter sanctuary" : "Connect to enter"}</button></div></div>
    <div className="landing-ticker"><span>LIVE PROTOCOL TICKER</span><div><b>—</b> Sovereign DAOs <strong>Awaiting first covenant</strong></div><div><b>—</b> GenLayer verdicts <strong>Consensus-bound</strong></div><div><b>—</b> Treasuries isolated <strong>One contract. One authority.</strong></div></div>
  </section>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="metric">{icon}<div><span>{label}</span><strong>{value}</strong></div></div>; }

function ConstitutionForm({ dao, onBusy, onNotice }: FormProps) {
  const [policy, setPolicy] = useState("Fund proposals that directly advance the DAO mission, provide verifiable public evidence, use reasonable budgets, disclose recipients, and define measurable outcomes.");
  const submit = async (event: FormEvent) => { event.preventDefault(); try { onBusy("Publishing constitution"); const now=Math.floor(Date.now()/1000); const constitution=[0n,BigInt(now+60),259200n,parseUnits("250",6),parseUnits("1000",6),2000,5000,10,10,zeroAddress,0n,0n,"grants,contributors,infra,marketing,emergency",policy,false]; const nextVersion=(await readDao<bigint>(dao,"activeConstitutionVersion"))+1n; await writeDao(dao,"scheduleConstitution",[constitution]); await setDearmersConstitution(dao,nextVersion.toString(),policy,{maxProposalAmountMicro:"250000000",weeklySpendLimitMicro:"1000000000",quorumBps:2000,approvalBps:5000,votingPeriodSeconds:259200,categories:["grants","contributors","infra","marketing","emergency"]}); onNotice({tone:"success",text:"Constitution scheduled on Base and registered with GenLayer. Activate it after the timelock."}); } catch(error){onNotice({tone:"error",text:explainContractError(error)});} finally{onBusy("");} };
  return <Panel title="Constitution" icon={<ShieldCheck/>}><form className="stack" onSubmit={submit}><textarea rows={5} value={policy} onChange={e=>setPolicy(e.target.value)}/><div className="hint">Defaults: 250 USDC/proposal, 1,000 USDC/week, 20% quorum, 3-day vote.</div><button className="primary-button">Schedule version</button><button type="button" className="ghost-button" onClick={async()=>{try{onBusy("Activating constitution");const version=await readDao<bigint>(dao,"activeConstitutionVersion");await writeDao(dao,"activateConstitution",[version+1n]);onNotice({tone:"success",text:"Constitution activated."});}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}}}>Activate next version</button></form></Panel>;
}

function MembershipForm({ dao, onBusy, onNotice }: FormProps) { const [member,setMember]=useState("");const [weight,setWeight]=useState("1");return <Panel title="Members & reviewers" icon={<Users/>}><div className="stack"><button className="ghost-button" onClick={async()=>{try{onBusy("Registering membership");await writeDao(dao,"registerMember");onNotice({tone:"success",text:"Membership registered."});}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}}}>Join DAO</button><input placeholder="Member wallet 0x…" value={member} onChange={e=>setMember(e.target.value)}/><input type="number" min="1" value={weight} onChange={e=>setWeight(e.target.value)}/><button className="primary-button" onClick={async()=>{try{onBusy("Configuring member");await writeDao(dao,"configureMember",[member, true, BigInt(weight), true]);onNotice({tone:"success",text:"Member and reviewer configured."});}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}}}>Whitelist reviewer</button></div></Panel>; }

function DelegationForm({ dao, onBusy, onNotice }: { dao: DaoRecord; onBusy:(v:string)=>void; onNotice:(n:Notice)=>void }) { const [limit,setLimit]=useState("1000"); return <Panel title="Treasury delegation" icon={<Wallet/>}><div className="stack"><p className="hint">The creator authorizes this DAO’s executor to spend a weekly USDC allowance. Funds remain in {dao.treasury}.</p><input type="number" min="1" value={limit} onChange={e=>setLimit(e.target.value)}/><button className="primary-button" onClick={async()=>{try{onBusy("Requesting MetaMask delegation");const permissions=await requestDelegationPermissions(dao.treasury,parseUnits(limit,6),executorAddress); const client=await walletClient(); const resource=`${dao.daoId}:${dao.treasury}:${executorAddress}`; const message=`Dearmers-Dao\nAction: store-delegation\nWallet: ${dao.treasury.toLowerCase()}\nResource: ${resource}`; const signature=await client.signMessage({account:client.account!,message}); const response=await fetch("/api/delegations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({daoId:dao.daoId,daoAddress:dao.dao,treasury:dao.treasury,executor:executorAddress,token:USDC_ADDRESS,permissions,wallet:dao.treasury,signature})}); const body=await response.json(); if(!response.ok) throw new Error(body.error||"Delegation storage failed"); onNotice({tone:"success",text:"Delegation created and encrypted for automation."});}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}}}>Grant weekly USDC delegation</button></div></Panel>; }

function ProposalForm({ dao, onBusy, onNotice, onDone }: { dao:DaoRecord;onBusy:(v:string)=>void;onNotice:(n:Notice)=>void;onDone:()=>Promise<void> }) { const [title,setTitle]=useState("");const [description,setDescription]=useState("");const [recipient,setRecipient]=useState("");const [amount,setAmount]=useState("10");const [evidence,setEvidence]=useState(""); const submit=async(event:FormEvent)=>{event.preventDefault();try{onBusy("Submitting proposal");await writeDao(dao.dao,"createProposal",[recipient,parseUnits(amount,6),dao.mode===1?1:0,title,description,dao.mode===1?"grants":"contributors",evidence,zeroHash]);onNotice({tone:"success",text:"Proposal submitted for GenLayer review."});setTitle("");await onDone();}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}};return <Panel title="New proposal" icon={<FileCheck2/>}><form className="stack" onSubmit={submit}><input placeholder="Proposal title" value={title} onChange={e=>setTitle(e.target.value)} required/><textarea placeholder="Purpose and measurable outcome" value={description} onChange={e=>setDescription(e.target.value)} required/><input placeholder="Recipient 0x…" value={recipient} onChange={e=>setRecipient(e.target.value)} required/><input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/><input placeholder="Public evidence URL" value={evidence} onChange={e=>setEvidence(e.target.value)} required/><button className="primary-button">Submit for review</button></form></Panel>; }

function ProfileForm({ account, onBusy, onNotice }: {account:Address|"";onBusy:(v:string)=>void;onNotice:(n:Notice)=>void}) { const [email,setEmail]=useState("");const [github,setGithub]=useState("");return <Panel title="Applicant identity" icon={<Users/>}><div className="stack"><input type="email" placeholder="Email for DAO notifications" value={email} onChange={e=>setEmail(e.target.value)}/><input placeholder="GitHub login" value={github} onChange={e=>setGithub(e.target.value)}/><button className="primary-button" onClick={async()=>{if(!account)return onNotice({tone:"error",text:"Connect a wallet first."});try{onBusy("Evaluating GitHub profile");const client=await walletClient();const message=`Dearmers-Dao\nAction: save-profile\nWallet: ${account.toLowerCase()}\nResource: ${github}`;const signature=await client.signMessage({account:client.account!,message});const response=await fetch("/api/profile",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:account,email,github,signature})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Profile evaluation failed");onNotice({tone:"success",text:`Profile saved. Current GitHub reputation: ${body.reputationScore}/100.`});}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}}}>Save and evaluate profile</button><span className="hint">A fresh review can be requested once every seven days.</span></div></Panel>; }

function GrantForm({ dao, onBusy, onNotice }: FormProps) { const [title,setTitle]=useState("Builder grants round");const [budget,setBudget]=useState("500");const [roundId,setRoundId]=useState("0");const [recipient,setRecipient]=useState("");const [amount,setAmount]=useState("100");const [project,setProject]=useState("");const [github,setGithub]=useState("");const run=async(label:string,action:()=>Promise<unknown>)=>{try{onBusy(label);await action();onNotice({tone:"success",text:`${label} completed.`});}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}};return <Panel title="Grant engine" icon={<CircleDollarSign/>}><div className="stack"><strong>Create round</strong><input value={title} onChange={e=>setTitle(e.target.value)}/><input type="number" value={budget} onChange={e=>setBudget(e.target.value)}/><button className="primary-button" onClick={()=>void run("Opening grant round",()=>writeDao(dao,"createGrantRound",[title,"",parseUnits(budget,6),3,BigInt(Math.floor(Date.now()/1000)+604800)]))}>Open seven-day round</button><strong>Apply to round</strong><input type="number" min="0" value={roundId} onChange={e=>setRoundId(e.target.value)}/><input placeholder="Project name" value={project} onChange={e=>setProject(e.target.value)}/><input placeholder="Recipient 0x…" value={recipient} onChange={e=>setRecipient(e.target.value)}/><input type="number" value={amount} onChange={e=>setAmount(e.target.value)}/><input placeholder="GitHub login" value={github} onChange={e=>setGithub(e.target.value)}/><button className="ghost-button" onClick={()=>void run("Submitting grant application",()=>writeDao(dao,"submitGrantApplication",[BigInt(roundId),recipient,parseUnits(amount,6),project,"",github,zeroHash]))}>Submit application</button><button className="ghost-button" onClick={()=>void run("Opening VC voting",()=>writeDao(dao,"openGrantVoting",[BigInt(roundId),BigInt(Math.floor(Date.now()/1000)+259200)]))}>Open three-day VC vote</button></div></Panel>; }

function ProposalBoard({ dao, proposals, account, onBusy, onNotice, onDone }: {dao:DaoRecord;proposals:ProposalView[];account:Address|"";onBusy:(v:string)=>void;onNotice:(n:Notice)=>void;onDone:()=>Promise<void>}) {
  const cards=useMemo(()=>proposals.map((proposal,index)=>({proposal,id:BigInt(index)})).reverse(),[proposals]);
  const run=async(label:string,action:()=>Promise<unknown>)=>{try{onBusy(label);await action();onNotice({tone:"success",text:`${label} completed.`});await onDone();}catch(error){onNotice({tone:"error",text:explainContractError(error)});}finally{onBusy("");}};
  return <section className="proposal-board"><div className="panel-title"><FileCheck2 size={17}/> Proposal pipeline</div>{cards.length===0?<p className="empty">No proposals yet.</p>:cards.map(({proposal,id})=><article className="proposal-card" key={id.toString()}><div><span className={`status status-${proposal.status}`}>{statusNames[proposal.status]||"Unknown"}</span><h3>{proposal.title}</h3><p>{proposal.description}</p><small>{Number(proposal.amount)/1e6} USDC · {proposal.category} · constitution v{proposal.constitutionVersion.toString()}</small></div><div className="proposal-actions">{proposal.status===0&&<button className="primary-button" onClick={()=>void run("GenLayer review",async()=>{setEvaluatorAddress(import.meta.env.VITE_GENLAYER_EVALUATOR||"");const tx=await evaluateWithDearmers(dao.daoId,id.toString(),{title:proposal.title,description:proposal.description,recipient:proposal.recipient,amount_micro:proposal.amount.toString(),evidence_uri:proposal.evidenceUri,constitution_version:proposal.constitutionVersion.toString()});const response=await fetch("/api/reviews",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({daoId:dao.daoId,daoAddress:dao.dao,proposalId:id.toString(),genlayerTxHash:String(tx),evaluatorAddress:import.meta.env.VITE_GENLAYER_EVALUATOR})}); const body=await response.json(); if(!response.ok) throw new Error(body.error||"Review relay failed"); onNotice({tone:"success",text:`GenLayer ${body.decision}; Base relay ${body.baseTransactionHash}`});})}>Run GenLayer review</button>}{proposal.status===2&&<><button onClick={()=>void run("YES vote",()=>writeDao(dao.dao,"castProposalVote",[id,true]))}>Vote yes</button><button onClick={()=>void run("NO vote",()=>writeDao(dao.dao,"castProposalVote",[id,false]))}>Vote no</button></>}{proposal.status===2&&<button onClick={()=>void run("Vote finalization",()=>writeDao(dao.dao,"finalizeProposalVote",[id]))}>Finalize after deadline</button>}<span className="vote-count">{proposal.yesWeight.toString()} yes / {proposal.noWeight.toString()} no</span>{account&&proposal.proposer.toLowerCase()===account.toLowerCase()&&<small>Your proposal</small>}</div></article>)}</section>;
}

function Panel({ title, icon, children }: {title:string;icon:React.ReactNode;children:React.ReactNode}) { return <section className="action-panel"><div className="panel-title">{icon}{title}</div>{children}</section>; }
type FormProps={dao:Address;onBusy:(v:string)=>void;onNotice:(n:Notice)=>void};
const zeroHash="0x0000000000000000000000000000000000000000000000000000000000000000";
void SelectGrantDao;
void GrantForm;
void applicationStatusNames;
export default App;
