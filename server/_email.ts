import { Resend } from "resend";

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

export async function sendEmail(input: { to: string[]; subject: string; html: string; eventKey: string }) {
  const recipients = [...new Set(input.to.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return { sent: 0, skipped: true };
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error("Email delivery is not configured.");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({ from: process.env.EMAIL_FROM, to: recipients, subject: input.subject, html: input.html, headers: { "X-Dearmers-Event": input.eventKey } });
  if (result.error) throw new Error(result.error.message || "Email provider rejected the message.");
  return { sent: recipients.length, id: result.data?.id || null };
}
