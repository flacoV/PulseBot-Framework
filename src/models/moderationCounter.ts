import { Schema, model, type InferSchemaType } from "mongoose";

const moderationCounterSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },
    lastCaseId: { type: Number, default: 0 }
  },
  {
    versionKey: false
  }
);

export type ModerationCounterDocument = InferSchemaType<typeof moderationCounterSchema>;

export const ModerationCounterModel = model<ModerationCounterDocument>(
  "ModerationCounter",
  moderationCounterSchema
);


