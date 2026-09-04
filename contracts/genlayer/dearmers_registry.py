# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

from genlayer import *
from dataclasses import dataclass


@allow_storage
@dataclass
class DAORecord:
    dao_id: str
    admin: str
    treasury: str
    base_dao: str
    mode: str
    membership_mode: str
    name: str
    mission: str
    description: str
    category: str
    gate_chain: str
    gate_asset: str
    gate_standard: str
    gate_name: str
    gate_symbol: str
    logo_uri: str
    banner_uri: str
    treasury_policy: str
    constitution_version: str
    evaluator: str
    metadata_uri: str
    active: bool


class DearmersRegistry(gl.Contract):
    owner: Address
    dao_count: u256
    daos: TreeMap[str, DAORecord]
    dao_ids: DynArray[str]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.dao_count = u256(0)

    @gl.public.write
    def register_dao(
        self,
        dao_id: str,
        admin: str,
        treasury: str,
        base_dao: str,
        mode: str,
        membership_mode: str,
        name: str,
        mission: str,
        description: str,
        category: str,
        gate_chain: str,
        gate_asset: str,
        gate_standard: str,
        gate_name: str,
        gate_symbol: str,
        logo_uri: str,
        banner_uri: str,
        treasury_policy: str,
        constitution_version: str,
        evaluator: str,
        metadata_uri: str,
    ) -> None:
        if not dao_id or not admin or not treasury or not name or not mission or not description or not category:
            raise gl.vm.UserError("[EXPECTED] DAO identity fields are required")
        if self.daos[dao_id].dao_id != "":
            raise gl.vm.UserError("[EXPECTED] DAO is already registered")
        sender = str(gl.message.sender_address)
        if sender != admin and sender != str(self.owner):
            raise gl.vm.UserError("[EXPECTED] Only the DAO admin or registry owner can register this DAO")
        if mode not in ("operating", "grant"):
            raise gl.vm.UserError("[EXPECTED] Unsupported DAO mode")
        if membership_mode not in ("public", "whitelist", "private", "token", "nft"):
            raise gl.vm.UserError("[EXPECTED] Unsupported membership mode")
        self.daos[dao_id] = DAORecord(
            dao_id, admin, treasury, base_dao, mode, membership_mode, name, mission, description, category,
            gate_chain, gate_asset, gate_standard, gate_name, gate_symbol, logo_uri, banner_uri, treasury_policy,
            constitution_version, evaluator, metadata_uri, True,
        )
        self.dao_ids.append(dao_id)
        self.dao_count = u256(int(self.dao_count) + 1)

    @gl.public.write
    def update_dao(
        self,
        dao_id: str,
        base_dao: str,
        constitution_version: str,
        evaluator: str,
        metadata_uri: str,
        description: str,
        category: str,
        logo_uri: str,
        banner_uri: str,
        treasury_policy: str,
    ) -> None:
        record = self.daos[dao_id]
        if record.dao_id == "":
            raise gl.vm.UserError("[EXPECTED] DAO is not registered")
        sender = str(gl.message.sender_address)
        if sender != record.admin and sender != str(self.owner):
            raise gl.vm.UserError("[EXPECTED] Only the DAO admin or registry owner can update this DAO")
        record.base_dao = base_dao
        record.constitution_version = constitution_version
        record.evaluator = evaluator
        record.metadata_uri = metadata_uri
        record.description = description
        record.category = category
        record.logo_uri = logo_uri
        record.banner_uri = banner_uri
        record.treasury_policy = treasury_policy
        self.daos[dao_id] = record

    @gl.public.write
    def set_active(self, dao_id: str, active: bool) -> None:
        record = self.daos[dao_id]
        if record.dao_id == "":
            raise gl.vm.UserError("[EXPECTED] DAO is not registered")
        sender = str(gl.message.sender_address)
        if sender != record.admin and sender != str(self.owner):
            raise gl.vm.UserError("[EXPECTED] Only the DAO admin or registry owner can change DAO status")
        record.active = active
        self.daos[dao_id] = record

    @gl.public.view
    def get_dao(self, dao_id: str) -> dict:
        record = self.daos[dao_id]
        return {
            "dao_id": record.dao_id,
            "admin": record.admin,
            "treasury": record.treasury,
            "base_dao": record.base_dao,
            "mode": record.mode,
            "membership_mode": record.membership_mode,
            "name": record.name,
            "mission": record.mission,
            "description": record.description,
            "category": record.category,
            "gate_chain": record.gate_chain,
            "gate_asset": record.gate_asset,
            "gate_standard": record.gate_standard,
            "gate_name": record.gate_name,
            "gate_symbol": record.gate_symbol,
            "logo_uri": record.logo_uri,
            "banner_uri": record.banner_uri,
            "treasury_policy": record.treasury_policy,
            "constitution_version": record.constitution_version,
            "evaluator": record.evaluator,
            "metadata_uri": record.metadata_uri,
            "active": record.active,
        }

    @gl.public.view
    def get_dao_ids(self, offset: u256, limit: u256) -> list[str]:
        start = int(offset)
        end = min(start + int(limit), len(self.dao_ids))
        return [self.dao_ids[index] for index in range(start, end)]
