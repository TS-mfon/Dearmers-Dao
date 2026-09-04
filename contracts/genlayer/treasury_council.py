# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json

ERROR_EXPECTED  = "[EXPECTED]"
ERROR_LLM       = "[LLM_ERROR]"

def _get_field(obj, field_name):
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(field_name)
    try:
        return getattr(obj, field_name)
    except AttributeError:
        try:
            return obj[field_name]
        except Exception:
            return None

def _clean_json_string(s: str) -> str:
    s = s.strip()
    if s.startswith("```json"):
        s = s[7:]
    elif s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[:-3]
    return s.strip()

@allow_storage
@dataclass
class AgentVerdict:
    persona: str            # "skeptic" | "strategist" | "ethicist"
    vote: str               # "approve" | "reject"
    confidence: u256        # 0-100
    max_amount_micro: u256  # USDC, 6-decimal atomic units
    reasoning: str

@allow_storage
@dataclass
class Proposal:
    id: u256
    proposer: str                # address string
    title: str
    description: str
    category: str                # "grant" | "contributor" | "infra" | "marketing" | "other"
    recipient: str                # address string
    requested_amount_micro: u256
    status: str                   # "pending" | "approved" | "rejected" | "executed"
    approved_amount_micro: u256
    final_reasoning: str
    created_at: str
    tx_hash: str
    skeptic_verdict: AgentVerdict
    strategist_verdict: AgentVerdict
    ethicist_verdict: AgentVerdict

class TreasuryCouncil(gl.Contract):
    owner: Address
    mission_statement: str
    weekly_cap_micro: u256
    spent_this_period_micro: u256
    period_start: str            # ISO date string
    proposals: TreeMap[u256, Proposal]
    proposal_count: u256
    owner_initialized: bool

    # delegation registry — written once during setup
    delegation_payload: str      # serialized ERC-7710 permission/delegation JSON
    treasury_address: str
    token_address: str           # USDC on Base Sepolia
    executor_address: str        # council session account address

    def __init__(self, mission_statement: str, weekly_cap_micro: u256):
        self.owner = gl.message.sender_address
        self.owner_initialized = False
        self.mission_statement = mission_statement
        self.weekly_cap_micro = weekly_cap_micro
        self.spent_this_period_micro = u256(0)
        self.period_start = "2026-06-14"
        self.proposal_count = u256(0)
        self.delegation_payload = ""
        self.treasury_address = ""
        self.token_address = ""
        self.executor_address = ""

    @gl.public.write
    def register_delegation(
        self, delegation_payload: str, treasury_address: str,
        token_address: str, executor_address: str
    ) -> None:
        if not self.owner_initialized:
            self.owner = gl.message.sender_address
            self.owner_initialized = True
        elif gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner")
        self.delegation_payload = delegation_payload
        self.treasury_address = treasury_address
        self.token_address = token_address
        self.executor_address = executor_address

    @gl.public.view
    def get_execution_context(self) -> dict:
        return {
            "delegation_payload": self.delegation_payload,
            "treasury_address": self.treasury_address,
            "token_address": self.token_address,
            "executor_address": self.executor_address,
            "weekly_cap_micro": self.weekly_cap_micro,
            "spent_this_period_micro": self.spent_this_period_micro,
        }

    @gl.public.view
    def get_contract_state(self) -> dict:
        return {
            "owner": str(self.owner),
            "mission_statement": self.mission_statement,
            "weekly_cap_micro": self.weekly_cap_micro,
            "spent_this_period_micro": self.spent_this_period_micro,
            "proposal_count": self.proposal_count,
            "treasury_address": self.treasury_address,
            "executor_address": self.executor_address,
        }

    @gl.public.write
    def submit_proposal(
        self, title: str, description: str, category: str,
        recipient: str, requested_amount_micro: u256
    ) -> u256:
        pid = self.proposal_count
        empty_verdict = AgentVerdict(persona="", vote="", confidence=u256(0),
                                       max_amount_micro=u256(0), reasoning="")
        self.proposals[pid] = Proposal(
            id=pid,
            proposer=str(gl.message.sender_address),
            title=title, description=description, category=category,
            recipient=recipient, requested_amount_micro=requested_amount_micro,
            status="pending", approved_amount_micro=u256(0),
            final_reasoning="", created_at="2026-06-14", tx_hash="",
            skeptic_verdict=empty_verdict, strategist_verdict=empty_verdict,
            ethicist_verdict=empty_verdict,
        )
        self.proposal_count += u256(1)
        return pid

    @gl.public.view
    def get_proposal(self, pid: u256) -> dict:
        p = self.proposals[pid]
        return {
            "id": p.id,
            "proposer": p.proposer,
            "title": p.title,
            "description": p.description,
            "category": p.category,
            "recipient": p.recipient,
            "requested_amount_micro": p.requested_amount_micro,
            "status": p.status,
            "approved_amount_micro": p.approved_amount_micro,
            "final_reasoning": p.final_reasoning,
            "tx_hash": p.tx_hash,
            "created_at": p.created_at,
            "verdicts": [
                {"persona": v.persona, "vote": v.vote, "confidence": v.confidence,
                 "max_amount_micro": v.max_amount_micro, "reasoning": v.reasoning}
                for v in (p.skeptic_verdict, p.strategist_verdict, p.ethicist_verdict)
            ],
        }

    @gl.public.view
    def get_all_proposals(self) -> list:
        out = []
        for pid in range(int(self.proposal_count)):
            out.append(self.get_proposal(u256(pid)))
        return out

    def _persona_prompt(self, persona: str, p: Proposal) -> str:
        base = f"""You are evaluating a DAO treasury spending proposal.
DAO mission: {self.mission_statement}
Weekly cap remaining: {self.weekly_cap_micro - self.spent_this_period_micro} (USDC micro-units)

Proposal:
- Title: {p.title}
- Category: {p.category}
- Description: {p.description}
- Recipient: {p.recipient}
- Requested amount (USDC micro-units): {p.requested_amount_micro}

Respond ONLY as JSON: {{"vote": "approve"|"reject", "confidence": 0-100, "max_amount_micro": <int>, "reasoning": "<2-3 sentences>"}}
max_amount_micro is the MOST you'd approve, which may be less than requested. Do not return any other text outside the JSON block."""

        personas = {
            "skeptic": "Persona: THE SKEPTIC. Focus strictly on downside risk, budget health, runway risk, and skepticism. Is this amount too high? Is the recipient reputable? Be extremely cautious and conserve treasury funds.",
            "strategist": "Persona: THE STRATEGIST. Focus strictly on growth, alignment with the DAO roadmap, and ROI. Does this project bring significant strategic value or growth? Assess impact vs spend.",
            "ethicist": "Persona: THE ETHICIST. Focus strictly on fairness, community benefit, ethical distribution, and adherence to the Constitution. Ensure equity and prevent exploitation.",
        }
        return personas[persona] + "\n\n" + base

    def _parse_verdict(self, raw, persona: str, requested: u256) -> AgentVerdict:
        if not isinstance(raw, dict):
            if isinstance(raw, str):
                try:
                    cleaned = _clean_json_string(raw)
                    raw = json.loads(cleaned)
                except Exception:
                    raise gl.vm.UserError(f"{ERROR_LLM} Non-dict response string: {raw}")
            else:
                raise gl.vm.UserError(f"{ERROR_LLM} Non-dict response: {type(raw)}")
        
        vote = str(raw.get("vote", "")).strip().lower()
        if vote not in ("approve", "reject"):
            raise gl.vm.UserError(f"{ERROR_LLM} Invalid vote: {vote}")
        try:
            confidence = max(0, min(100, int(round(float(raw.get("confidence", 0))))))
            max_amt = max(0, int(round(float(raw.get("max_amount_micro", 0)))))
        except (ValueError, TypeError):
            raise gl.vm.UserError(f"{ERROR_LLM} Non-numeric fields")
        if vote == "approve":
            max_amt = min(max_amt, int(requested))
        else:
            max_amt = 0
        return AgentVerdict(
            persona=persona, vote=vote, confidence=u256(confidence),
            max_amount_micro=u256(max_amt), reasoning=str(raw.get("reasoning", ""))[:400],
        )

    def _evaluate_persona(self, persona: str, p: Proposal) -> AgentVerdict:
        prompt = self._persona_prompt(persona, p)
        requested_amt = int(p.requested_amount_micro)

        def leader_fn():
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return self._parse_verdict(raw, persona, requested_amt)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            v = leaders_res.calldata
            
            # Safe schema and bounds validation
            vote = _get_field(v, "vote")
            confidence = _get_field(v, "confidence")
            max_amt = _get_field(v, "max_amount_micro")
            
            if vote not in ("approve", "reject"):
                return False
            try:
                conf_val = int(confidence)
                if conf_val < 0 or conf_val > 100:
                    return False
            except Exception:
                return False
            try:
                amt_val = int(max_amt)
                if amt_val < 0:
                    return False
                # If approved, must not exceed requested amount
                if vote == "approve" and amt_val > requested_amt:
                    return False
            except Exception:
                return False
            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        return result

    @gl.public.write
    def evaluate_proposal(self, pid: u256) -> dict:
        p = self.proposals[pid]
        if p.status != "pending":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Proposal not pending")

        skeptic_raw = self._evaluate_persona("skeptic", p)
        strategist_raw = self._evaluate_persona("strategist", p)
        ethicist_raw = self._evaluate_persona("ethicist", p)
        verdicts = [skeptic_raw, strategist_raw, ethicist_raw]

        approve_votes = sum(1 for v in verdicts if _get_field(v, "vote") == "approve")
        approving_caps = [int(_get_field(v, "max_amount_micro") or 0) for v in verdicts if _get_field(v, "vote") == "approve"]

        if approve_votes >= 2:
            approved_amount = min(int(p.requested_amount_micro), min(approving_caps))
            remaining = int(self.weekly_cap_micro) - int(self.spent_this_period_micro)
            if approved_amount > remaining:
                p.status = "rejected"
                p.final_reasoning = (
                    f"Council approved {approve_votes}/3, but the approved amount of {approved_amount} micro-USDC "
                    f"exceeds the remaining weekly cap of {remaining} micro-USDC."
                )
            else:
                p.status = "approved"
                p.approved_amount_micro = u256(approved_amount)
                p.final_reasoning = (
                    f"Council approved {approve_votes}/3 votes. "
                    f"Approved amount: {approved_amount} micro-USDC."
                )
        else:
            p.status = "rejected"
            p.final_reasoning = f"Council rejected: only {approve_votes}/3 votes to approve."

        p.skeptic_verdict = AgentVerdict(
            persona=str(_get_field(skeptic_raw, "persona") or "skeptic"),
            vote=str(_get_field(skeptic_raw, "vote") or "reject"),
            confidence=u256(int(_get_field(skeptic_raw, "confidence") or 0)),
            max_amount_micro=u256(int(_get_field(skeptic_raw, "max_amount_micro") or 0)),
            reasoning=str(_get_field(skeptic_raw, "reasoning") or "")
        )
        p.strategist_verdict = AgentVerdict(
            persona=str(_get_field(strategist_raw, "persona") or "strategist"),
            vote=str(_get_field(strategist_raw, "vote") or "reject"),
            confidence=u256(int(_get_field(strategist_raw, "confidence") or 0)),
            max_amount_micro=u256(int(_get_field(strategist_raw, "max_amount_micro") or 0)),
            reasoning=str(_get_field(strategist_raw, "reasoning") or "")
        )
        p.ethicist_verdict = AgentVerdict(
            persona=str(_get_field(ethicist_raw, "persona") or "ethicist"),
            vote=str(_get_field(ethicist_raw, "vote") or "reject"),
            confidence=u256(int(_get_field(ethicist_raw, "confidence") or 0)),
            max_amount_micro=u256(int(_get_field(ethicist_raw, "max_amount_micro") or 0)),
            reasoning=str(_get_field(ethicist_raw, "reasoning") or "")
        )
        self.proposals[pid] = p

        return {
            "status": p.status,
            "approved_amount_micro": p.approved_amount_micro,
            "final_reasoning": p.final_reasoning
        }

    @gl.public.write
    def mark_executed(self, pid: u256, tx_hash: str) -> None:
        p = self.proposals[pid]
        if p.status != "approved":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Proposal not approved")
        p.status = "executed"
        p.tx_hash = tx_hash
        self.proposals[pid] = p
        self.spent_this_period_micro += p.approved_amount_micro

    @gl.public.view
    def get_pending_executions(self) -> list:
        out = []
        for pid in range(int(self.proposal_count)):
            p = self.proposals[u256(pid)]
            if p.status == "approved":
                out.append({
                    "id": int(p.id),
                    "recipient": p.recipient,
                    "amount_micro": int(p.approved_amount_micro)
                })
        return out
