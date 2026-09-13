import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { HttpError, errorResponse, method, json, safeError } from "./_http.js";
import { requireAdminSession, digest } from "./_admin-session.js";
import { escapeHtml, sendEmail } from "./_email.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const session = await requireAdminSession(req);
    const db = await database();
    const body = req.body || {};
    const action = String(req.query.action || body.action || "overview");
    if (req.method === "GET") {
      if (action === "audit") return json(res, 200, { events: await db.collection("auditLogs").find({ scopeId: "protocol" }).sort({ createdAt: -1 }).limit(200).toArray() });
      if (action === "monitor" || action === "settings") {
        const configured = (name: string, values: unknown[], detail: string) => ({ name, ok: values.every(Boolean), state: values.every(Boolean) ? "configured" : "missing_configuration", detail });
        const checks = [
          { name: "Database", ok: true, state: "reachable", detail: "MongoDB request completed" },
          configured("Email", [process.env.RESEND_API_KEY, process.env.EMAIL_FROM], "Resend configuration; delivery is reported per message"),
          configured("GenLayer", [process.env.GENLAYER_RPC_URL, process.env.GENLAYER_V2_EVALUATOR_ADDRESS, process.env.GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY], `Network: ${process.env.GENLAYER_NETWORK || "studio-dev"}`),
          configured("Base", [process.env.BASE_RPC_URL, process.env.DEARMERS_REGISTRY_ADDRESS], "Base Sepolia registry configuration"),
          configured("Automation", [process.env.BASE_AUTOMATION_PRIVATE_KEY, process.env.DELEGATION_ENCRYPTION_KEY], "Payment readiness is checked per DAO and proposal"),
          configured("Password login", [process.env.ADMIN_PASSWORD_HASH], "Server-only password hash"),
        ];
        const [users, daos, proposals, memberships, failures] = await Promise.all([
          db.collection("profiles").countDocuments({}), db.collection("daoIndex").countDocuments({}),
          db.collection("proposals").countDocuments({}), db.collection("daoMembers").countDocuments({ status: "active" }),
          Promise.all(["emailJobs", "proposalJobs", "daoCreationJobs", "executionJobs"].map(async (name) => (await db.collection(name).find({ error: { $exists: true, $ne: "" } }).sort({ updatedAt: -1 }).limit(25).toArray()).map((item) => ({ kind: name, id: String(item._id), daoId: item.daoId, proposalId: item.proposalId, error: item.error, status: item.status, updatedAt: item.updatedAt })))),
        ]);
        return json(res, 200, { checks, analytics: { users, daos, proposals, memberships }, failedJobs: failures.flat(), daos: action === "settings" ? await db.collection("daoIndex").find({}).project({ daoId: 1, name: 1 }).limit(200).toArray() : undefined });
      }
      return json(res, 200, {
        users: await db.collection("profiles").find({}).project({ identity: 1, wallet: 1, username: 1, displayName: 1, banned: 1 }).limit(200).toArray(),
        daos: await db.collection("daoIndex").find({}).project({ daoId: 1, name: 1, banned: 1 }).limit(200).toArray(),
        proposals: await db.collection("proposals").find({}).project({ title: 1, daoId: 1, status: 1 }).sort({ createdAt: -1 }).limit(200).toArray(),
      });
    }
    if (["ban-user", "ban-dao"].includes(action)) {
      if (!String(body.target || "").trim() || typeof body.banned !== "boolean") throw new HttpError(400, "A target and moderation decision are required.");
      const collection = action === "ban-user" ? "profiles" : "daoIndex";
      const key = action === "ban-user" ? "identity" : "daoId";
      const changed = await db.collection(collection).updateOne({ [key]: String(body.target) }, { $set: { banned: body.banned, bannedAt: new Date(), bannedBy: session.actor } });
      if (!changed.matchedCount) throw new HttpError(404, "Moderation target not found.");
    } else if (action === "protocol-announcement") {
      const title = String(body.title || "").trim();
      const content = String(body.body || "").trim();
      if (!title || !content || title.length > 140 || content.length > 5000) throw new HttpError(400, "Supply a title (up to 140 characters) and bulletin (up to 5,000 characters).");
      const eventKey = `protocol:${digest(`${title}\n${content}`)}`;
      const saved = await db.collection("announcements").updateOne({ eventKey }, { $setOnInsert: { scope: "protocol", eventKey, title, body: content, createdAt: new Date(), createdBy: session.actor } }, { upsert: true });
      if (!saved.upsertedCount) return json(res, 200, { ok: true, duplicate: true });
      const recipients = await db.collection("profiles").find({ banned: { $ne: true } }).project({ identity: 1, email: 1, emailVerified: 1, emailNotifications: 1 }).toArray();
      const notifications = recipients.filter((recipient) => recipient.identity).map((recipient) => ({ identity: String(recipient.identity).replace(/^privy:/, ""), kind: "protocol_bulletin", title, body: content, readAt: null, createdAt: new Date(), targetUrl: "/notifications" }));
      if (notifications.length) await db.collection("notifications").insertMany(notifications);
      const emails = recipients.filter((recipient) => recipient.emailVerified && recipient.emailNotifications !== false && recipient.email).map((recipient) => String(recipient.email));
      let email = { status: "skipped", sent: 0, error: "No opted-in verified email recipients." };
      if (emails.length) {
        try {
          const result = await sendEmail({ to: emails, subject: title, html: `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(content)}</p>`, eventKey });
          email = { status: "sent", sent: result.sent, error: "" };
        } catch (error) { email = { status: "failed", sent: 0, error: safeError(error) }; }
        await db.collection("emailJobs").updateOne({ eventKey }, { $set: { eventKey, ...email, updatedAt: new Date() } }, { upsert: true });
      }
      await db.collection("auditLogs").insertOne({ scopeId: "protocol", type: action, actor: session.actor, authMethod: session.authMethod, target: eventKey, createdAt: new Date() });
      return json(res, 200, { ok: true, email, notifications: notifications.length });
    } else throw new HttpError(403, "This action belongs to the authorized DAO control room, not protocol administration.");
    await db.collection("auditLogs").insertOne({ scopeId: "protocol", type: action, actor: session.actor, authMethod: session.authMethod, target: body.target, createdAt: new Date() });
    return json(res, 200, { ok: true });
  } catch (error) { return errorResponse(res, error); }
}
