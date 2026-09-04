export type DaoMode = "operating" | "grant";
export type MembershipMode = "public" | "whitelist" | "token-gated";
export type ProposalKind = "spend" | "grant" | "emergency";
export type ProposalStatus = "review" | "revision" | "voting" | "rejected" | "approved" | "executed" | "escalated" | "paused";

export interface ConstitutionDraft {
  maxProposalAmount: bigint;
  weeklySpendLimit: bigint;
  quorumBps: number;
  approvalBps: number;
  votingPeriodSeconds: number;
  gateToken: `0x${string}`;
  gateBalance: bigint;
  categories: string;
  policyText: string;
  activatesAt: number;
}

export interface DaoRecord {
  daoId: `0x${string}`;
  admin: `0x${string}`;
  dao: `0x${string}`;
  treasury: `0x${string}`;
  mode: DaoMode;
  name: string;
  metadataUri: string;
  description?: string;
  category?: string;
  logoUri?: string;
  bannerUri?: string;
  gateChain?: string;
  gateAsset?: string;
  gateStandard?: string;
  gateName?: string;
  gateSymbol?: string;
  active: boolean;
}

export interface ProposalDraft {
  recipient: `0x${string}`;
  amount: bigint;
  kind: ProposalKind;
  title: string;
  description: string;
  category: string;
  evidenceUri: string;
  evidenceHash: `0x${string}`;
}
