export type ModerationActionType = "warn" | "mute" | "unmute" | "kick" | "ban" | "unban" | "note";

export interface CreateModerationCaseInput {
  guildId: string;
  userId: string;
  moderatorId: string;
  type: ModerationActionType;
  reason: string;
  durationMs?: number;
  expiresAt?: Date | null;
  evidenceUrls?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModerationStats {
  totalCases: number;
  typeCounts: Partial<Record<ModerationActionType, number>>;
  lastAction?: {
    caseId?: number;
    type: ModerationActionType;
    reason: string;
    createdAt: Date;
  };
}


