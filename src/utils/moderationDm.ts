import { EmbedBuilder, type User } from "discord.js";

import type { ModerationActionType } from "../types/Moderation.js";
import { logger } from "./logger.js";

const ACTION_LABELS: Record<ModerationActionType, string> = {
  warn: "Warning",
  mute: "Mute",
  unmute: "Unmute",
  kick: "Kick",
  ban: "Ban",
  unban: "Unban",
  note: "Note"
};

const ACTION_COLORS: Partial<Record<ModerationActionType, number>> = {
  warn: 0xf1c40f,
  mute: 0xe67e22,
  unmute: 0x2ecc71,
  kick: 0xe74c3c,
  ban: 0xc0392b,
  unban: 0x27ae60
};

const buildEmbed = (options: {
  guildName: string;
  type: ModerationActionType;
  caseId?: number;
  reason: string;
  durationText?: string | null;
  inviteUrl?: string | null;
}) => {
  const action = ACTION_LABELS[options.type] ?? options.type;

  const embed = new EmbedBuilder()
    .setTitle(`${action} notification`)
    .setDescription(`Action taken in **${options.guildName}**.`)
    .setColor(ACTION_COLORS[options.type] ?? 0x5865f2)
    .addFields({ name: "Reason", value: options.reason || "No reason provided." });

  if (options.durationText) {
    embed.addFields({ name: "Duration", value: options.durationText });
  }

  if (options.inviteUrl) {
    embed.addFields({
      name: "Server",
      value: `[Join ${options.guildName}](${options.inviteUrl})`,
      inline: true
    });
  }

  embed.setFooter({
    text: "If you believe this is a mistake, contact the staff team. Please don't reply to this DM."
  });

  return embed;
};

export const sendModerationDm = async (params: {
  user: User;
  guildName: string;
  type: ModerationActionType;
  caseId?: number;
  reason: string;
  durationText?: string | null;
  inviteUrl?: string | null;
}) => {
  try {
    const basePayload: {
      guildName: string;
      type: ModerationActionType;
      caseId?: number;
      reason: string;
      durationText?: string | null;
      inviteUrl?: string | null;
    } = {
      guildName: params.guildName,
      type: params.type,
      reason: params.reason
    };

    if (typeof params.caseId === "number") {
      basePayload.caseId = params.caseId;
    }

    if (params.durationText != null) {
      basePayload.durationText = params.durationText;
    }

    if (params.inviteUrl != null) {
      basePayload.inviteUrl = params.inviteUrl;
    }

    const embed = buildEmbed(basePayload);

    await params.user.send({ embeds: [embed] });
  } catch (error) {
    logger.debug(
      `No se pudo enviar DM de moderación (${params.type}) al usuario ${params.user.id}. Probablemente tiene los MD cerrados.`,
      error
    );
  }
};



