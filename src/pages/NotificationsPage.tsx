import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";
import { useSessionHeaders } from "../lib/session";

type Notification = { _id?: string; kind?: string; title: string; body: string; daoId?: string; targetUrl?: string; createdAt: string; readAt?: string | null };
export function NotificationsPage({ onNotice }: { account: Address | ""; onNotice: (notice: { tone: "info" | "success" | "error"; text: string }) => void }) {
  const sessionHeaders = useSessionHeaders();
  const { authenticated } = usePrivy();
  const [items, setItems] = useState<Notification[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { if (!authenticated) return; try { setLoading(true); const headers = await sessionHeaders(); const response = await fetch("/api/notifications", { headers }); const body = await response.json() as { notifications?: Notification[]; error?: string }; if (!response.ok) throw new Error(body.error || "Notifications unavailable."); setItems(body.notifications || []); } catch (error) { onNotice({ tone: "error", text: error instanceof Error ? error.message : "Notifications unavailable." }); } finally { setLoading(false); } }, [authenticated, onNotice, sessionHeaders]);
  useEffect(() => { if (!authenticated) return; const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [authenticated, load]);
  const markRead = async (id?: string) => { const headers = await sessionHeaders(); await fetch("/api/notifications", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ id }) }); setItems((current) => current.map((item) => id && item._id !== id ? item : ({ ...item, readAt: new Date().toISOString() }))); };
  if (!authenticated) return <div className="notification-page"><div className="select-state"><Bell size={32}/><h3>Sign in to see signals.</h3><p>Your notifications follow your Privy identity across wallet and email sessions.</p></div></div>;
  const unread = items.filter((item) => !item.readAt).length;
  return <div className="notification-page"><div className="notification-heading"><span className="eyebrow"><Bell size={13}/> SIGNALS · {unread} UNREAD</span><h2>What moved<br /><em>while you were away.</em></h2><div><button className="ghost-button" onClick={() => void load()} disabled={loading}>Refresh</button><button className="primary-button" onClick={() => void markRead()} disabled={!unread}><CheckCheck size={15}/> Mark all read</button></div></div><section className="notification-list">{items.length ? items.map((item, index) => <article className={item.readAt ? "read" : ""} key={item._id || `${item.title}-${index}`} onClick={() => void markRead(item._id)}><span className="notification-mark"><Bell size={15}/></span><div><small>{new Date(item.createdAt).toLocaleString()}</small><h3>{item.title}</h3><p>{item.body}</p>{(item.targetUrl || item.daoId) && <a href={item.targetUrl || `/dao/${item.daoId}`}>Open signal <ExternalLink size={13}/></a>}</div></article>) : <div className="notification-empty"><Bell size={22}/><strong>No new signals.</strong><span>Follow a covenant to receive its announcements and governance activity.</span></div>}</section></div>;
}
