import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type User,
  type Message
} from "discord.js";

import { createBaseEmbed } from "./embedBuilder.js";
import { logger } from "./logger.js";

/**
 * Creates the modal to give a verdict on a report.
 */
export const createVerdictModal = (caseId: number) => {
  const modal = new ModalBuilder()
    .setCustomId(`verdict_modal_${caseId}`)
    .setTitle(`Verdict - Case #${caseId}`);

  const verdictInput = new TextInputBuilder()
    .setCustomId("verdict_text")
    .setLabel("Verdict")
    .setPlaceholder("Describe the verdict and the actions taken (if any)...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  const verdictRow = new ActionRowBuilder<TextInputBuilder>().addComponents(verdictInput);

  modal.addComponents(verdictRow);

  return modal;
};

/**
 * Sends DMs to both users (reporter and reported) with the verdict.
 */
export const sendVerdictDMs = async (
  guild: Guild,
  reporterId: string,
  reportedUserId: string,
  caseId: number,
  verdict: string,
  moderator: User
): Promise<void> => {
  try {
    // Get users
    const reporter = await guild.client.users.fetch(reporterId).catch(() => null);
    const reportedUser = await guild.client.users.fetch(reportedUserId).catch(() => null);

    const verdictEmbed = createBaseEmbed({
      title: "⚖️ Verdict of the Report",
      description: `A verdict has been issued for case #${caseId}`,
      color: 0x5865f2
    })
      .addFields({
        name: "Verdict",
        value: verdict
      })
      .addFields({
        name: "Moderator",
        value: `${moderator.tag}`,
        inline: true
      })
      .addFields({
        name: "Server",
        value: guild.name,
        inline: true
      })
      .setFooter({ text: `Case #${caseId}` })
      .setTimestamp();

    // Send DM to the reporter
    if (reporter) {
      try {
        await reporter.send({ embeds: [verdictEmbed] });
      } catch (error) {
        logger.warn(`Could not send DM to the reporter ${reporterId}:`, error);
      }
    }

    // Send DM to the reported user
    if (reportedUser) {
      try {
        await reportedUser.send({ embeds: [verdictEmbed] });
      } catch (error) {
        logger.warn(`Could not send DM to the reported user ${reportedUserId}:`, error);
      }
    }
  } catch (error) {
    logger.error("Error sending verdict DMs:", error);
  }
};

/**
 * Updates the report embed to show that it has been taken by a moderator.
 */
export const updateReportEmbedTaken = async (
  message: Message,
  moderator: User,
  caseId: number
): Promise<void> => {
  try {
    const embed = message.embeds[0];
    if (!embed) return;

    const updatedEmbed = createBaseEmbed({
      title: embed.title || "🚨 User Report",
      description: embed.description || "",
      color: embed.color || 0xff0000,
      footerText: embed.footer?.text || `Case #${caseId}`
    });

    // Copy all existing fields
    if (embed.fields) {
      for (const field of embed.fields) {
        updatedEmbed.addFields(field);
      }
    }

    // Add status field
    updatedEmbed.addFields({
      name: "Status",
      value: `✅ Taken by <@${moderator.id}> (${moderator.tag})`,
      inline: true
    });

    // Update the message
    await message.edit({ embeds: [updatedEmbed] });
  } catch (error) {
    logger.error("Error updating report embed:", error);
  }
};

/**
 * Updates the report embed to show the verdict.
 */
export const updateReportEmbedVerdict = async (
  message: Message,
  moderator: User,
  caseId: number,
  verdict: string
): Promise<void> => {
  try {
    const embed = message.embeds[0];
    if (!embed) return;

    const updatedEmbed = createBaseEmbed({
      title: embed.title || "🚨 User Report",
      description: embed.description || "",
      color: 0x00ff00, // Green for verdict
      footerText: embed.footer?.text || `Case #${caseId}`
    });

    // Copy all existing fields
    if (embed.fields) {
      for (const field of embed.fields) {
        updatedEmbed.addFields(field);
      }
    }

    // Add verdict field
    updatedEmbed.addFields({
      name: "Verdict",
      value: verdict,
      inline: false
    });

    updatedEmbed.addFields({
      name: "Status",
      value: `✅ Verdict given by <@${moderator.id}> (${moderator.tag})`,
      inline: true
    });

    // Remove buttons (the report has already been resolved)
    await message.edit({ embeds: [updatedEmbed], components: [] });
  } catch (error) {
    logger.error("Error updating report embed with verdict:", error);
  }
};

