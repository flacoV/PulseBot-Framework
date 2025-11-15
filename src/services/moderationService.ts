import type { FilterQuery } from "mongoose";

import { ModerationCaseModel } from "../models/moderationCase.js";
import { ModerationCounterModel } from "../models/moderationCounter.js";
import type {
  CreateModerationCaseInput,
  ModerationActionType,
  ModerationStats
} from "../types/Moderation.js";

const getNextCaseId = async (guildId: string) => {
  const counter = await ModerationCounterModel.findOneAndUpdate(
    { guildId },
    { $inc: { lastCaseId: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return counter?.lastCaseId ?? 1;
};

export const createModerationCase = async (payload: CreateModerationCaseInput) => {
  const caseId = await getNextCaseId(payload.guildId);

  const moderationCase = await ModerationCaseModel.create({
    ...payload,
    caseId
  });

  return moderationCase.toObject();
};

export const getUserCases = async (
  guildId: string,
  userId: string,
  options?: { limit?: number; type?: ModerationActionType }
) => {
  const filter: FilterQuery<typeof ModerationCaseModel> = { guildId, userId };
  if (options?.type) {
    filter.type = options.type;
  }

  const query = ModerationCaseModel.find(filter).sort({ createdAt: -1 });

  if (options?.limit) {
    query.limit(options.limit);
  }

  return query.lean();
};

export const getUserStats = async (guildId: string, userId: string): Promise<ModerationStats> => {
  const [counts, lastCase] = await Promise.all([
    ModerationCaseModel.aggregate([
      { $match: { guildId, userId } },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 }
        }
      }
    ]),
    ModerationCaseModel.findOne({ guildId, userId }).sort({ createdAt: -1 }).lean()
  ]);

  const typeCounts = counts.reduce<Record<string, number>>((acc, entry) => {
    acc[entry._id as ModerationActionType] = entry.count;
    return acc;
  }, {});

  const totalCases = counts.reduce((acc, entry) => acc + entry.count, 0);

  const stats: ModerationStats = {
    totalCases,
    typeCounts
  };

  if (lastCase) {
    stats.lastAction = {
      caseId: lastCase.caseId,
      type: lastCase.type,
      reason: lastCase.reason,
      createdAt: lastCase.createdAt
    };
  }

  return stats;
};


