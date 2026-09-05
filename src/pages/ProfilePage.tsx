import { useEffect, useState, type FormEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Activity, ArrowUpRight, GitBranch, Save, Search, UserRound } from "lucide-react";
import type { Address } from "viem";
import { useParams } from "react-router-dom";
import { walletClient } from "../lib/dao";

type Profile = { wallet?: string; identity?: string; username?: string; displayName?: string; bio?: string; website?: string; github?: string; avatarUrl?: string; reputationScore?: number };

export function ProfilePage({ account, onNotice }: { account: Address | ""; onNotice: (notice: { tone: "info" | "success" | "error"; text: string }) => void }) {
  const { user, getAccessToken } = usePrivy();
  const { wallet } = useParams();
  const profileWallet = (wallet || account) as Address | "";
  const profileIdentity = !profileWallet && user ? `privy:${user.id}` : "";
  const isOwner = Boolean((account && profileWallet && account.toLowerCase() === profileWallet.toLowerCase()) || profileIdentity);
  const [profile, setProfile] = useState<Profile>({ wallet: profileWallet, identity: profileIdentity });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profileWallet && !profileIdentity) return;
    const load = async () => {
      const token = profileIdentity ? await getAccessToken() : null;
      const endpoint = profileWallet ? `/api/profile?wallet=${profileWallet}` : `/api/profile?identity=${encodeURIComponent(profileIdentity)}`;
      const response = await fetch(endpoint, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
      const body = await response.json() as { profile?: Profile };
      setProfile(body.profile || { wallet: profileWallet, identity: profileIdentity });
    };
    void load().catch(() => undefined);
    const listener = () => void load().catch(() => undefined);
    window.addEventListener("dearmers:profile-updated", listener);
    return () => window.removeEventListener("dearmers:profile-updated", listener);
  }, [getAccessToken, profileIdentity, profileWallet]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!account && !user) return onNotice({ tone: "error", text: "Authenticate before editing your profile." });
    try {
      setBusy(true);
      const token = await getAccessToken();
      const client = account ? await walletClient() : null;
      const signature = client ? await client.signMessage({ account: client.account!, message: `Dearmers-Dao\nAction: save-profile\nWallet: ${account.toLowerCase()}\nResource: ${profile.github || profile.username || account}` }) : "";
      const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ ...profile, wallet: account || undefined, identity: profileIdentity || profile.identity, signature }) });
      const body = await response.json() as { profile?: Profile; error?: string };
      if (!response.ok) throw new Error(body.error || "Profile could not be saved.");
      setProfile(body.profile || profile);
      window.dispatchEvent(new Event("dearmers:profile-updated"));
      onNotice({ tone: "success", text: "Profile updated and ready for discovery." });
    } catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "Profile could not be saved." }); } finally { setBusy(false); }
  };

  const search = async () => { const response = await fetch(`/api/social?kind=profile&q=${encodeURIComponent(query)}`); const body = await response.json() as { profiles?: Profile[] }; setResults(body.profiles || []); };
  const displayWallet = profile.wallet || profile.identity || "privy identity";
  return <div className="profile-page"><div className="profile-heading"><span className="eyebrow"><UserRound size={13}/> NETWORK IDENTITY</span><h2>{isOwner ? <>Make your work<br /><em>legible to the network.</em></> : <>{profile.displayName || profile.username || "Builder dossier"}<br /><em>public conviction record.</em></>}</h2><p>Your profile is portable context for grant committees, DAO councils, and future collaborators.</p></div><div className="profile-layout">{isOwner ? <form className="profile-editor" onSubmit={(event) => void save(event)}><div className="profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <UserRound size={30} />}</div><Field label="Display name" value={profile.displayName || ""} onChange={(value) => setProfile({ ...profile, displayName: value })} placeholder="How should the assembly address you?" /><Field label="Username" value={profile.username || ""} onChange={(value) => setProfile({ ...profile, username: value })} placeholder="your-handle" /><Field label="Short bio" value={profile.bio || ""} onChange={(value) => setProfile({ ...profile, bio: value })} placeholder="What are you building?" textarea /><Field label="GitHub login" value={profile.github || ""} onChange={(value) => setProfile({ ...profile, github: value })} placeholder="Used for contributor evidence" /><Field label="Website" value={profile.website || ""} onChange={(value) => setProfile({ ...profile, website: value })} placeholder="https://…" /><button className="primary-button" disabled={busy}><Save size={15}/>{busy ? "Saving identity…" : "Save identity"}</button></form> : <section className="profile-public"><div className="profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <UserRound size={30} />}</div><h3>{profile.displayName || profile.username || `${displayWallet.slice(0, 8)}…${displayWallet.slice(-6)}`}</h3><p>{profile.bio || "This builder has not published a bio yet."}</p><code>{displayWallet}</code></section>}<aside className="profile-aside"><div className="detail-section-title"><Activity size={16}/> Network search</div><div className="profile-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a builder" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /><button onClick={() => void search()}>Search</button></div><div className="profile-results">{results.map((result) => <a key={result.wallet || result.identity} href={result.wallet ? `/profile/${result.wallet}` : `/profile`}><span>{result.avatarUrl ? <img src={result.avatarUrl} alt="" /> : <UserRound size={15}/>}</span><div><strong>{result.displayName || result.username || "Anonymous builder"}</strong><small>{result.reputationScore || 0}/100 conviction · {result.github ? `@${result.github}` : "wallet-first"}</small></div><ArrowUpRight size={15}/></a>)}</div><div className="profile-score"><span>CONVICTION INDEX</span><strong>{profile.reputationScore || 0}<small>/100</small></strong><p>Public GitHub evidence can be evaluated and carried into grant applications.</p>{profile.github && <a href={`https://github.com/${profile.github}`} target="_blank" rel="noreferrer"><GitBranch size={14}/> View GitHub <ArrowUpRight size={13}/></a>}</div></aside></div></div>;
}

function Field({ label, value, onChange, placeholder, textarea }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; textarea?: boolean }) { return <label className="profile-field">{label}{textarea ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4}/> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/>}</label>; }
