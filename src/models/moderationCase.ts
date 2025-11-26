import mongoose, { Schema, model, type InferSchemaType, type Model } from "mongoose";

import type { ModerationActionType } from "../types/Moderation.js";

const moderationCaseSchema = new Schema(
  {
    caseId: { type: Number, required: false },
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    moderatorId: { type: String, required: true },
    type: {
      type: String,
      required: true,
    enum: ["warn", "mute", "unmute", "kick", "ban", "unban", "note"] satisfies ModerationActionType[]
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
// Unique index only applies when caseId exists (for reports)
moderationCaseSchema.index({ guildId: 1, caseId: -1 }, { unique: true, sparse: true });

export type ModerationCaseDocument = InferSchemaType<typeof moderationCaseSchema>;

// Avoid recompiling the model if it already exists (useful for hot-reload)
export const ModerationCaseModel: Model<ModerationCaseDocument> =
  (mongoose.models["ModerationCase"] as Model<ModerationCaseDocument>) ??
  model<ModerationCaseDocument>("ModerationCase", moderationCaseSchema);


