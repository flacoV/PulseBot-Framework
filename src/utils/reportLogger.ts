import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  type TextChannel,
  type Guild
} from "discord.js";

import { configurationService } from "../services/configurationService.js";
import { createBaseEmbed } from "./embedBuilder.js";
import { logger } from "./logger.js";

interface LogReportOptions {
  guild: Guild;
  caseId: number;
  reporter: {
    id: string;
    tag: string;
    username: string;
  };
  reportedUser: {
    id: string;
    tag: string;
    username: string;
  };
  reason: string;
  evidenceUrls?: string[];
}

/**
 * Sends a report log to the configured channel specifically for reports.
 * If there is no configured channel, nothing is sent (no failure).
 */
export const logUserReport = async (options: LogReportOptions): Promise<void> => {
  const { guild, caseId, reporter, reportedUser, reason, evidenceUrls } = options;

  try {
    const moderationConfig = await configurationService.getModerationConfig(guild.id);
    const reportLogChannelId = moderationConfig?.reportLogChannelId;

    if (!reportLogChannelId) {
      // No configured channel for reports, not a critical error
      return;
    }

    const channel = (await guild.channels.fetch(reportLogChannelId).catch(() => null)) as TextChannel | null;

    if (!channel) {
      logger.warn(
        `The report log channel (${reportLogChannelId}) does not exist or is not accessible in the server ${guild.id}.`
      );
      return;
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      logger.warn(
        `The report log channel (${reportLogChannelId}) is not a valid text channel in the server ${guild.id}.`
      );
      return;
    }

    // Verify bot permissions
    const me = await guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      logger.warn(
        `The bot does not have sufficient permissions in the report log channel (${reportLogChannelId}) in the server ${guild.id}.`
      );
      return;
    }

    const embed = createBaseEmbed({
      title: "🚨 User Report",
      description: `A user report was received about ${reportedUser.tag}`,
      color: Colors.Red,
      footerText: `Case #${caseId} · ID: ${reportedUser.id}`
    }).addFields(
      {
        name: "Reporter",
        value: `<@${reporter.id}> (${reporter.tag})`,
        inline: true
      },
      {
        name: "Reported",
        value: `<@${reportedUser.id}> (${reportedUser.tag})`,
        inline: true
      },
      {
        name: "Report Reason",
        value: reason || "Not specified"
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

    // Add buttons for staff to take the report and give verdict
    const takeReportButton = new ButtonBuilder()
      .setCustomId(`take_report_${caseId}`)
      .setLabel("Take Report")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("✋");

    const giveVerdictButton = new ButtonBuilder()
      .setCustomId(`give_verdict_${caseId}`)
      .setLabel("Give Verdict")
      .setStyle(ButtonStyle.Success)
      .setEmoji("⚖️");

    const openPrivateChannelButton = new ButtonBuilder()
      .setCustomId(`open_private_channel_${caseId}`)
      .setLabel("Open Private Channel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔒");

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      takeReportButton,
      giveVerdictButton,
      openPrivateChannelButton
    );

    await channel.send({ embeds: [embed], components: [actionRow] });
  } catch (error) {
    // We don't want an error in the logging to break the report flow
    logger.error(`Error sending report log in the server ${guild.id}:`, error);
  }
};

