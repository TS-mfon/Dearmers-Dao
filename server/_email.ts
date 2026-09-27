import { Resend } from "resend";
import { HttpError } from "./_http.js";

/** Resend only delivers from a domain verified in the account, so a free-mail sender always fails. */
const freeMailDomains = ["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com"];

export function senderDomainError() {
  const from = String(process.env.EMAIL_FROM || "").trim();
  if (!process.env.RESEND_API_KEY || !from) return "Email is not configured: set RESEND_API_KEY and EMAIL_FROM.";
  const domain = (from.match(/@([^\s>]+)>?$/)?.[1] || "").toLowerCase();
  if (!domain) return "Email is not configured: EMAIL_FROM must be a valid address.";
  if (freeMailDomains.includes(domain)) return `Email is not configured: EMAIL_FROM must use a domain verified with Resend, not ${domain}.`;
  return "";
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

export async function sendEmail(input: { to: string[]; subject: string; html: string; eventKey: string }) {
  const recipients = [...new Set(input.to.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return { sent: 0, skipped: true };
  const misconfigured = senderDomainError();
  if (misconfigured) throw new HttpError(503, misconfigured);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({ from: process.env.EMAIL_FROM!, to: recipients, subject: input.subject, html: input.html, headers: { "X-Dearmers-Event": input.eventKey } });
  if (result.error) throw new Error(result.error.message || "Email provider rejected the message.");
  return { sent: recipients.length, id: result.data?.id || null };
}
