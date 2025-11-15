import { Schema, model, type InferSchemaType } from "mongoose";

import type { ModerationActionType } from "../types/Moderation.js";

const moderationCaseSchema = new Schema(
  {
    caseId: { type: Number, required: true },
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    moderatorId: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: ["warn", "mute", "kick", "ban", "note"] satisfies ModerationActionType[]
    },
    reason: { type: String, required: true },
    evidenceUrls: { type: [String], default: [] },
    durationMs: { type: Number, default: null },
    expiresAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: null }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

moderationCaseSchema.index({ guildId: 1, userId: 1, createdAt: -1 });
moderationCaseSchema.index({ guildId: 1, caseId: -1 }, { unique: true });

export type ModerationCaseDocument = InferSchemaType<typeof moderationCaseSchema>;

export const ModerationCaseModel = model<ModerationCaseDocument>(
  "ModerationCase",
  moderationCaseSchema
);


