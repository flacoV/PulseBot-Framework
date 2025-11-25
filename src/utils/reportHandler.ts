import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type User
} from "discord.js";

import { createModerationCase } from "../services/moderationService.js";
import { logger } from "./logger.js";
import { logUserReport } from "./reportLogger.js";

/**
 * Crea el modal para reportar un usuario.
 */
export const createReportModal = () => {
  const modal = new ModalBuilder().setCustomId("report_user_modal").setTitle("Report User");

  const userInput = new TextInputBuilder()
    .setCustomId("report_user_id")
    .setLabel("User to Report")
    .setPlaceholder("Paste the ID of the user to report")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const reasonInput = new TextInputBuilder()
    .setCustomId("report_reason")
    .setLabel("Report Reason")
    .setPlaceholder("Describe in detail what the user did that violates the rules...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  const evidenceInput = new TextInputBuilder()
    .setCustomId("report_evidence")
    .setLabel("Evidence")
    .setPlaceholder("URLs of images, messages, or references (separated by commas)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  const userRow = new ActionRowBuilder<TextInputBuilder>().addComponents(userInput);
  const reasonRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  const evidenceRow = new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput);

  modal.addComponents(userRow, reasonRow, evidenceRow);

  return modal;
};

/**
 * Extracts the user ID from a mention or direct ID.
 */
const extractUserId = (input: string): string | null => {
  // Mention format: <@123456789> or <@!123456789>
  const mentionMatch = input.match(/<@!?(\d+)>/);
  if (mentionMatch && mentionMatch[1]) {
    return mentionMatch[1];
  }

  // Direct ID (only numbers)
  if (/^\d+$/.test(input.trim())) {
    return input.trim();
  }

  return null;
};

/**
 * Formats the evidence URLs.
 */
const formatEvidence = (raw?: string | null): string[] => {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
};

/**
 * Processes a user report and creates a moderation case of type "note".
 */
export const processUserReport = async (
  guild: Guild,
  reporter: User,
  userInput: string,
  reason: string,
  evidenceInput?: string | null
): Promise<{ success: boolean; message: string; caseId?: number }> => {
  try {
    // Extract the reported user ID
    const reportedUserId = extractUserId(userInput);
    if (!reportedUserId) {
      return {
        success: false,
        message: "I could not identify the user. Please mention the user (@user) or paste their ID."
      };
    }

    // Verify that the reported user exists in the server
    const reportedMember = await guild.members.fetch(reportedUserId).catch(() => null);
    if (!reportedMember) {
      return {
        success: false,
        message: "I could not find that user in the server. Verify that the mention or ID is correct."
      };
    }

    // Verify that the user is not reporting themselves
    if (reportedUserId === reporter.id) {
      return {
        success: false,
        message: "You cannot report yourself."
      };
    }

    // Verify that the user is not reporting a bot
    if (reportedMember.user.bot) {
      return {
        success: false,
        message: "You cannot report a bot."
      };
    }

    // Format evidence
    const evidence = formatEvidence(evidenceInput);

    // Create moderation case of type "note" (report)
    const moderationCase = await createModerationCase({
      guildId: guild.id,
      userId: reportedUserId,
      moderatorId: reporter.id,
      type: "note",
      reason: `[REPORT] ${reason}`,
      ...(evidence.length > 0 && { evidenceUrls: evidence }),
      metadata: {
        reportedBy: reporter.id,
        reportType: "user_report"
      }
    });

    // Send log to the report channel if configured
    await logUserReport({
      guild,
      caseId: moderationCase.caseId,
      reporter: {
        id: reporter.id,
        tag: reporter.tag,
        username: reporter.username
      },
      reportedUser: {
        id: reportedMember.user.id,
        tag: reportedMember.user.tag,
        username: reportedMember.user.username
      },
      reason,
      ...(evidence.length > 0 && { evidenceUrls: evidence })
    });

    return {
      success: true,
      message: `Report sent successfully. Case #${moderationCase.caseId}. The moderation team will review it soon.`,
      caseId: moderationCase.caseId
    };
  } catch (error) {
    logger.error("Error processing user report:", error);
    return {
      success: false,
      message: "An error occurred while processing your report. Please try again later."
    };
  }
};

