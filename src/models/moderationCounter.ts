import mongoose, { Schema, model, type InferSchemaType, type Model } from "mongoose";

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

// Evitar recompilar el modelo si ya existe (útil para hot-reload)
export const ModerationCounterModel: Model<ModerationCounterDocument> =
  (mongoose.models["ModerationCounter"] as Model<ModerationCounterDocument>) ??
  model<ModerationCounterDocument>("ModerationCounter", moderationCounterSchema);


