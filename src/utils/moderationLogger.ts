import { Colors, type TextChannel, type Guild } from "discord.js";

import { configurationService } from "../services/configurationService.js";
import type { ModerationActionType } from "../types/Moderation.js";
import { createBaseEmbed } from "./embedBuilder.js";
import { logger } from "./logger.js";
import { formatDuration } from "./duration.js";

interface LogModerationActionOptions {
  guild: Guild;
  actionType: ModerationActionType;
  caseId: number;
  targetUser: {
    id: string;
    tag: string;
    username: string;
  };
  moderator: {
    id: string;
    tag: string;
  };
  reason: string;
  evidenceUrls?: string[];
  durationMs?: number | undefined;
  expiresAt?: Date | undefined;
  metadata?: Record<string, unknown>;
}

/**
 * Sends a moderation log to the configured channel.
 * If there is no configured channel or an error, logs to the logger but does not fail.
 */
export const logModerationAction = async (options: LogModerationActionOptions): Promise<void> => {
  const { guild, actionType, caseId, targetUser, moderator, reason, evidenceUrls, durationMs, expiresAt, metadata } =
    options;

  try {
    const moderationConfig = await configurationService.getModerationConfig(guild.id);
    const logChannelId = moderationConfig?.logChannelId;

    if (!logChannelId) {
      // No configured channel, not a critical error
      return;
    }

    const channel = (await guild.channels.fetch(logChannelId).catch(() => null)) as TextChannel | null;

    if (!channel) {
      logger.warn(
        `The moderation log channel (${logChannelId}) does not exist or is not accessible in the server ${guild.id}.`
      );
      return;
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      logger.warn(
        `The moderation log channel (${logChannelId}) is not a valid text channel in the server ${guild.id}.`
      );
      return;
    }

    // Verify bot permissions
    const me = await guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      logger.warn(
        `The bot does not have sufficient permissions in the moderation log channel (${logChannelId}) in the server ${guild.id}.`
      );
      return;
    }

    // Mapping of action types to colors and emojis
    const actionConfig: Record<
      ModerationActionType,
      { color: number; emoji: string; title: string; description: string }
    > = {
      warn: {
        color: Colors.Yellow,
        emoji: "🔔",
        title: "Warning Registered",
        description: `A warning was registered for ${targetUser.tag}`
      },
      mute: {
        color: Colors.Orange,
        emoji: "🔇",
        title: "Member Muted",
        description: `${targetUser.tag} was muted`
      },
      unmute: {
        color: Colors.Green,
        emoji: "🔊",
        title: "Mute Removed",
        description: `The mute was removed from ${targetUser.tag}`
      },
      kick: {
        color: Colors.Purple,
        emoji: "👋",
        title: "Member Kicked",
        description: `${targetUser.tag} was kicked from the server`
      },
      ban: {
        color: Colors.DarkRed,
        emoji: "🔨",
        title: "Member Banned",
        description: `${targetUser.tag} was banned from the server`
      },
      unban: {
        color: Colors.Green,
        emoji: "✅",
        title: "Member Unbanned",
        description: `${targetUser.tag} was unbanned from the server`
      },
      note: {
        color: Colors.Blue,
        emoji: "📝",
        title: "Note Registered",
        description: `A note was registered for ${targetUser.tag}`
      }
    };

    // Detect if it is a report
    const isReport = metadata?.reportType === "user_report";

    // If it is a report, use special configuration
    if (isReport && actionType === "note") {
      const reportConfig = {
        color: Colors.Red,
        emoji: "🚨",
        title: "User Report",
        description: `A user report was received about ${targetUser.tag}`
      };

      const embed = createBaseEmbed({
        title: `${reportConfig.emoji} ${reportConfig.title}`,
        description: reportConfig.description,
        color: reportConfig.color,
        footerText: `Case #${caseId} · ID: ${targetUser.id}`
      }).addFields(
        {
          name: "Reporter",
          value: `<@${moderator.id}> (${moderator.tag})`,
          inline: true
        },
        {
          name: "Reported",
          value: `<@${targetUser.id}> (${targetUser.tag})`,
          inline: true
        },
        {
          name: "Report Reason",
          value: reason.replace(/^\[REPORT\]\s*/, "") || "Not specified"
        }
      );

      if (evidenceUrls && evidenceUrls.length > 0) {
        embed.addFields({
          name: "Evidence",
          value: evidenceUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")
        });
      }

      embed.addFields({
        name: "Timestamp", // TODO: Add localization
        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
        inline: true
      });

      await channel.send({ embeds: [embed] });
      return;
    }

    const config = actionConfig[actionType];
    const embed = createBaseEmbed({
      title: `${config.emoji} ${config.title}`,
      description: config.description,
      color: config.color,
      footerText: `Case #${caseId} · ID: ${targetUser.id}`
    }).addFields(
      {
        name: "Moderator",
        value: `<@${moderator.id}> (${moderator.tag})`,
        inline: true
      },
      {
        name: "Member",
        value: `<@${targetUser.id}> (${targetUser.tag})`,
        inline: true
      },
      {
        name: "Reason",
        value: reason || "Not specified"
      }
    );

    // Add additional information according to the action type
    if (durationMs && (actionType === "mute" || actionType === "ban")) {
      embed.addFields({
        name: "Duration",
        value: formatDuration(durationMs),
        inline: true
      });
    }

    if (expiresAt && (actionType === "mute" || actionType === "ban")) {
      embed.addFields({
        name: "Expires",
        value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
        inline: true
      });
    }

    if (evidenceUrls && evidenceUrls.length > 0) {
      embed.addFields({
        name: "Evidence",
        value: evidenceUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")
      });
    }

    // Add metadata if there is additional relevant information
    if (metadata?.automated) {
      embed.addFields({
        name: "Type",
        value: "Automatic",
        inline: true
      });
    }

    embed.addFields({
      name: "Timestamp",
      value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
      inline: true
    });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    // We don't want an error in the logging to break the moderation flow
    logger.error(`Error sending moderation log in the server ${guild.id}:`, error);
  }
};

