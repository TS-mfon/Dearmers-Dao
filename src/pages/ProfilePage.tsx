import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Activity, ArrowLeft, ArrowUpRight, Camera, Check, ExternalLink, GitBranch, Heart, Save, UserRound, Users } from "lucide-react";
import type { Address } from "viem";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { walletClient } from "../lib/dao";

export type PublicProfile = { wallet?: string; identity?: string; username?: string; displayName?: string; bio?: string; website?: string; github?: string; avatarUrl?: string; bannerUrl?: string; location?: string; timezone?: string; profileVisibility?: string; emailNotifications?: boolean };
type Notice = { tone: "info" | "success" | "error"; text: string };

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "The network did not return a usable response.");
  return body as T;
}

export function ProfilePage({ account, onNotice }: { account: Address | ""; onNotice: (notice: Notice) => void }) {
  const { user, getAccessToken, logout } = usePrivy();
  const { wallet, identity } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const profileWallet = (wallet || (!identity ? account : "")) as Address | "";
  const profileIdentity = identity || (!profileWallet && user ? `privy:${user.id}` : "");
  const isOwner = Boolean((account && profileWallet && account.toLowerCase() === profileWallet.toLowerCase()) || (!wallet && !identity && profileIdentity));
  const editing = location.pathname === "/profile/edit";
  const [profile, setProfile] = useState<PublicProfile>({ wallet: profileWallet, identity: profileIdentity });
  const [draft, setDraft] = useState<PublicProfile>(profile);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [socialBusy, setSocialBusy] = useState(false);
  const [listProfiles, setListProfiles] = useState<PublicProfile[]>([]);

  const load = useCallback(async () => {
    if (!profileWallet && !profileIdentity) { setLoading(false); return; }
    setLoading(true);
    try {
      const token = profileIdentity ? await getAccessToken() : null;
      const endpoint = profileWallet ? `/api/profile?wallet=${encodeURIComponent(profileWallet)}` : `/api/profile?identity=${encodeURIComponent(profileIdentity)}`;
      const body = await responseBody<{ profile?: PublicProfile }>(await fetch(endpoint, token ? { headers: { authorization: `Bearer ${token}` } } : undefined));
      const next = body.profile || { wallet: profileWallet, identity: profileIdentity };
      setProfile(next); setDraft(next);
    } catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "Profile could not be loaded." }); }
    finally { setLoading(false); }
  }, [getAccessToken, onNotice, profileIdentity, profileWallet]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); const listener = () => void load(); window.addEventListener("dearmers:profile-updated", listener); return () => { window.clearTimeout(timer); window.removeEventListener("dearmers:profile-updated", listener); }; }, [load]);

  const publicTarget = (profile.identity || profile.wallet || "").toLowerCase();
  useEffect(() => {
    if (!publicTarget || isOwner) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        const response = await fetch(`/api/social?kind=profile-follow&target=${encodeURIComponent(publicTarget)}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
        const body = await responseBody<{ following?: boolean; followers?: number; followingCount?: number }>(response);
        if (!cancelled) { setFollowing(Boolean(body.following)); setFollowerCount(Number(body.followers || 0)); setFollowingCount(Number(body.followingCount || 0)); }
      } catch { if (!cancelled) setFollowerCount(0); }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken, isOwner, publicTarget]);

  useEffect(() => {
    const list = searchParams.get("list");
    if (!list || !publicTarget || !["followers", "following"].includes(list)) return;
    let cancelled = false;
    void fetch(`/api/social?kind=profile-follow&target=${encodeURIComponent(publicTarget)}&list=${list}`).then((response) => responseBody<{ profiles?: PublicProfile[] }>(response)).then((body) => { if (!cancelled) setListProfiles(body.profiles || []); }).catch(() => { if (!cancelled) setListProfiles([]); });
    return () => { cancelled = true; };
  }, [publicTarget, searchParams]);

  const toggleFollow = async () => {
    if (isOwner || !publicTarget) return;
    try {
      setSocialBusy(true);
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in with Privy to follow people.");
      const action = following ? "unfollow" : "follow";
      const body = await responseBody<{ count?: number }>(await fetch("/api/social", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ action, target: publicTarget, targetType: "profile" }) }));
      setFollowing(action === "follow"); setFollowerCount(Number(body.count || 0));
      onNotice({ tone: "success", text: action === "follow" ? `You are now following ${displayName}.` : "You unfollowed this profile." });
    } catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not update follow preference." }); }
    finally { setSocialBusy(false); }
  };

  const uploadMedia = async (event: ChangeEvent<HTMLInputElement>, kind: "avatar" | "banner") => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return onNotice({ tone: "error", text: "Choose a PNG, JPEG, or WebP image." });
    if (file.size > (kind === "banner" ? 5_000_000 : 2_500_000)) return onNotice({ tone: "error", text: `${kind === "banner" ? "Banners" : "Profile photos"} must be smaller than ${kind === "banner" ? "5" : "2.5"} MB.` });
    try {
      setUploading(true);
      const token = await getAccessToken();
      const reader = new FileReader();
      const data = await new Promise<string>((resolve, reject) => { reader.onerror = () => reject(new Error("The photo could not be read.")); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.readAsDataURL(file); });
      const body = await responseBody<{ url: string }>(await fetch("/api/media", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ fileName: file.name, mimeType: file.type, data, kind }) }));
      setDraft((current) => ({ ...current, ...(kind === "banner" ? { bannerUrl: body.url } : { avatarUrl: body.url }) }));
      onNotice({ tone: "success", text: `${kind === "banner" ? "Banner" : "Photo"} uploaded. Save your profile to publish it.` });
    } catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "Photo upload failed." }); }
    finally { setUploading(false); event.target.value = ""; }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!isOwner) return onNotice({ tone: "error", text: "Only the profile owner can edit this identity." });
    try {
      setBusy(true); const token = await getAccessToken(); const client = account ? await walletClient() : null;
      const signature = client ? await client.signMessage({ account: client.account!, message: `Dearmers-Dao\nAction: save-profile\nWallet: ${account.toLowerCase()}\nResource: ${draft.github || draft.username || account}` }) : "";
      const body = await responseBody<{ profile?: PublicProfile }>(await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ ...draft, wallet: account || undefined, identity: profileIdentity || draft.identity, signature }) }));
      const next = body.profile || draft; setProfile(next); setDraft(next); window.dispatchEvent(new Event("dearmers:profile-updated")); onNotice({ tone: "success", text: "Profile updated and ready for discovery." }); navigate("/profile");
    } catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "Profile could not be saved." }); }
    finally { setBusy(false); }
  };

  const displayName = profile.displayName || profile.username || "Dreamer profile";
  const displayWallet = profile.wallet ? `${profile.wallet.slice(0, 8)}…${profile.wallet.slice(-6)}` : profile.identity ? "Privy member" : "Identity not connected";
  const profileUrl = profile.wallet ? `/profile/${profile.wallet}` : profile.identity ? `/profile/identity/${encodeURIComponent(profile.identity)}` : "/profile";
  const initials = useMemo(() => displayName.slice(0, 2).toUpperCase(), [displayName]);

  if (editing && !isOwner) return <div className="profile-page profile-state"><UserRound size={28}/><h2>Private edit chamber</h2><p>Only the owner can edit this profile.</p><Link className="primary-button" to={profileUrl}>Return to profile</Link></div>;
  if (loading) return <div className="profile-page profile-state"><div className="profile-skeleton"/><strong>Reading identity signal…</strong><span>Loading the public profile dashboard.</span></div>;
  if (!profileWallet && !profileIdentity) return <div className="profile-page profile-state"><UserRound size={28}/><h2>Enter before creating a profile</h2><p>Connect a wallet or authenticate with Privy to make your profile discoverable.</p></div>;

  return <div className="profile-page">
    <div className="profile-heading"><span className="eyebrow"><UserRound size={13}/> NETWORK IDENTITY</span><div className="profile-heading-row"><div><h2>{isOwner ? <>Your presence<br/><em>in the network.</em></> : <>{displayName}<br/><em>public conviction record.</em></>}</h2><p>Portable context for grant committees, DAO councils, and future collaborators.</p></div>{isOwner && !editing && <><Link className="primary-button" to="/profile/edit"><Save size={15}/> Edit profile</Link><button className="ghost-button" type="button" onClick={() => void logout()}>Sign out</button></>}</div></div>
    {editing ? <form className="profile-editor profile-edit-route" onSubmit={(event) => void save(event)}><div className="profile-edit-header"><Link className="back-link" to="/profile"><ArrowLeft size={15}/> Back to profile</Link><span className="eyebrow">PROFILE EDITOR</span><h3>Refine your public signal.</h3><p>Customize the identity people see across the network.</p></div><div className="profile-banner-editor" style={{ backgroundImage: draft.bannerUrl ? `url(${draft.bannerUrl})` : undefined }}><label className="upload-photo-button"><Camera size={16}/>{uploading ? "Uploading…" : "Change banner"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadMedia(event, "banner")} disabled={uploading}/></label>{draft.bannerUrl && <button type="button" className="text-button" onClick={() => setDraft({ ...draft, bannerUrl: "" })}>Remove banner</button>}</div><div className="profile-photo-editor"><div className="profile-avatar profile-avatar-large">{draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : <span>{initials}</span>}</div><label className="upload-photo-button"><Camera size={16}/>{uploading ? "Uploading…" : "Change photo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadMedia(event, "avatar")} disabled={uploading}/></label>{draft.avatarUrl && <button type="button" className="text-button" onClick={() => setDraft({ ...draft, avatarUrl: "" })}>Remove photo</button>}</div><Field label="Display name" value={draft.displayName || ""} onChange={(value) => setDraft({ ...draft, displayName: value })} placeholder="How should the assembly address you?"/><Field label="Username" value={draft.username || ""} onChange={(value) => setDraft({ ...draft, username: value })} placeholder="your-handle"/><Field label="Short bio" value={draft.bio || ""} onChange={(value) => setDraft({ ...draft, bio: value })} placeholder="What are you building?" textarea/><Field label="Location" value={draft.location || ""} onChange={(value) => setDraft({ ...draft, location: value })} placeholder="Lagos, Nigeria"/><Field label="GitHub login" value={draft.github || ""} onChange={(value) => setDraft({ ...draft, github: value })} placeholder="github-handle"/><Field label="Website" value={draft.website || ""} onChange={(value) => setDraft({ ...draft, website: value })} placeholder="https://…"/><div className="profile-form-actions"><Link className="ghost-button" to="/profile">Cancel</Link><button className="primary-button" disabled={busy || uploading}><Save size={15}/>{busy ? "Saving identity…" : "Save profile"}</button></div></form> : <div className="profile-layout"><section className="profile-public profile-dashboard"><div className="profile-cover" style={profile.bannerUrl ? { backgroundImage: `url(${profile.bannerUrl})` } : undefined}/><div className="profile-public-body"><div className="profile-avatar profile-avatar-large">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{initials}</span>}</div><div className="profile-identity-row"><div><span className="eyebrow">{profile.username ? `@${profile.username}` : "NETWORK MEMBER"}</span><h3>{displayName}</h3>{profile.location && <small>{profile.location}</small>}<div className="profile-stats"><Link to={`${profileUrl}?list=followers`}><strong>{followerCount}</strong> Followers</Link><Link to={`${profileUrl}?list=following`}><strong>{followingCount}</strong> Following</Link></div></div>{!isOwner && <button className="primary-button profile-inline-follow" onClick={() => void toggleFollow()} disabled={socialBusy}><Heart size={15} fill={following ? "currentColor" : "none"}/>{socialBusy ? "Updating…" : following ? "Following" : "Follow"}</button>}</div><p className="profile-bio">{profile.bio || "This dreamer has not published a bio yet."}</p><div className="profile-links">{profile.github && <a href={`https://github.com/${profile.github}`} target="_blank" rel="noreferrer"><GitBranch size={15}/> GitHub <ExternalLink size={12}/></a>}{profile.website && <a href={profile.website} target="_blank" rel="noreferrer"><ArrowUpRight size={15}/> Website <ExternalLink size={12}/></a>}</div><div className="profile-wallet-row"><span>Profile evidence</span><strong>Unverified until reviewed</strong></div><div className="profile-wallet-row"><span>Wallet / identity</span><code>{displayWallet}</code>{profile.wallet && <button type="button" className="icon-button" onClick={() => void navigator.clipboard?.writeText(profile.wallet || "")}><Check size={14}/></button>}</div></div></section><aside className="profile-aside"><div className="detail-section-title"><Activity size={16}/> Profile details</div><div className="profile-score neutral"><span>PUBLIC PROFILE</span><strong>{profile.github || profile.website ? "Linked" : "Open"}</strong><p>Links and claims remain unverified until a relevant DAO or grant review checks them.</p></div><div className="profile-next"><span>KEEP EXPLORING</span><Link to="/explorer">Discover DAOs <ArrowUpRight size={14}/></Link><Link to="/notifications">Read network signals <ArrowUpRight size={14}/></Link></div></aside></div>}
    {searchParams.get("list") && <section className="profile-list-panel"><div className="detail-section-title"><Users size={16}/> {searchParams.get("list") === "followers" ? "Followers" : "Following"}</div>{listProfiles.length ? listProfiles.map((item) => { const target = item.wallet ? `/profile/${item.wallet}` : item.identity ? `/profile/identity/${encodeURIComponent(item.identity)}` : "/profile"; return <Link className="profile-list-item" key={item.wallet || item.identity} to={target}><span className="profile-avatar">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <span>{(item.displayName || item.username || "D").slice(0, 2).toUpperCase()}</span>}</span><span><strong>{item.displayName || item.username || "Dreamer profile"}</strong><small>{item.username ? `@${item.username}` : "Network member"}</small></span></Link>; }) : <p className="empty">No profiles in this list yet.</p>}</section>}
  </div>;
}

function Field({ label, value, onChange, placeholder, textarea }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; textarea?: boolean }) { return <label className="profile-field">{label}{textarea ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4}/> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/>}</label>; }
