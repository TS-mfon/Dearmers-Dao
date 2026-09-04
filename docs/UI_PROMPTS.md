# Dearmers-Dao UI Build Prompts

These prompts replace the generic Vesper/Nexum language with Dearmers-Dao product language while preserving their visual discipline.

## Sanctuary Landing Prompt

Recreate a single-viewport landing page for **Dearmers-Dao**, an autonomous operating engine for sovereign DAOs and grant funds. The page should feel like an arcane digital society meeting high-tech coordination: obsidian black, raw slate borders, parchment text, acid-lime signals, cold blue evidence markers, restrained amber highlights, subtle grain, and thin ceremonial rules. Do not use purple Web3 gradients, generic SaaS cards, or crypto casino language.

Use a full-bleed dark motion background if available, but keep the UI legible without it. The first viewport contains only a header, one hero composition, and a live protocol ticker.

Header: Dearmers-Dao wordmark, links for Sanctuary, Covenants, Governance, Grants, and a wallet action labelled **Enter Sanctuary**. Use a compact brutalist navigation treatment with crisp borders and deliberate hover/focus states.

Hero badge: `AUTONOMOUS DAO OPERATING ENGINE`.

Headline:

```text
Forge communities
that govern themselves.
```

Supporting copy: `Publish a constitution. Let GenLayer deliberate over evidence. Let the assembly authorize bounded action. Every DAO keeps its own treasury, members, and operating memory.`

Primary CTA: **Forge a Covenant**. Secondary CTA: **Enter Sanctuary**.

Live ticker values should be product-shaped, not invented vanity metrics: `SOVEREIGN DAOS`, `CONSTITUTIONS ACTIVE`, `GENLAYER VERDICTS`, `TREASURIES ISOLATED`. If live data is unavailable, show `Awaiting first covenant` rather than fabricated adoption numbers.

The visual signature is an illuminated vertical rule that travels from the hero badge into the ticker, suggesting a covenant being ratified. Use a display serif or geometric title face paired with a clean monospace for addresses, amounts, quorum, and status. Responsive behavior must preserve hierarchy on mobile and include visible focus rings.

## Governance Chamber Prompt

Rebuild the authenticated Dearmers-Dao workspace as a modular React interface using the same obsidian ceremonial design language. It is not a generic dashboard: use the terms **Sanctuary**, **Sacred Decree**, **In Divination**, **In Assembly**, **Enacted**, **Forsaken**, **Constitution**, **Council**, and **Treasury Sanctum**.

The left rail lists independent sovereign DAOs and clearly labels each as `Operating DAO` or `Grant DAO`. No UI may imply a unified treasury. The main area contains:

1. A DAO masthead with mission, DAO address, treasury address, mode, and active constitution version.
2. Four protocol metrics: Sacred Decrees, Constitution, Treasury, and GenLayer Review.
3. Action panels for the four-step Forge ritual: Identity & Sigil, Autonomous Brain, Council & Membership, and Covenant Inception.
4. A governance board of proposal rows. Each row displays evidence URI, amount, category, constitution version, quorum progress, and a status badge.
5. A dedicated **AI Autonomous Verdict** pane showing decision, score, risk, fit, evidence summary, and the GenLayer transaction hash. Reasoning is evidence-led copy, never a decorative chatbot transcript.
6. Grant DAO controls for rounds, applications, VC reviewer allowlists, milestone releases, and portable applicant reputation.

Interactions must provide loading, disabled, empty, rejected, retry, and wallet-cancelled states. Use skeletal glows for chain reads, suspended obsidian modals for confirmation, and a red/crimson treatment for paused or escalated actions. Keep all calls isolated per DAO and make the three-day voting deadline explicit.

## Forge Ritual Prompt

Create a responsive four-stage DAO creation ritual for Dearmers-Dao:

- **01 / Identity & Sigil**: name, mission covenant, creed, sigil, DAO mode.
- **02 / Autonomous Brain**: constitution text, spending limits, grant criteria, evidence requirements, risk posture, and GenLayer evaluator binding.
- **03 / Council & Membership**: public, whitelist, or token-gated membership; voting weights; VC reviewer allowlist for Grant DAOs.
- **04 / Covenant Inception**: immutable review of all parameters, isolated treasury address, Base DAO deployment, GenLayer registry registration, and activation timelock.

Each step should feel like a ritual checkpoint, with a left-side numbered rail and a right-side form. Use plain-language helper text explaining that GenLayer evaluates subjective compatibility while deterministic Base contracts enforce bounded outcomes. Include explicit errors for invalid addresses, missing evidence rules, unsafe limits, and wallet rejection.
