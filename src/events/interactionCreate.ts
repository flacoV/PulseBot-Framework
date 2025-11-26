import type { ChatInputCommandInteraction, Interaction, TextChannel } from "discord.js";

import type { BotClient } from "../types/BotClient.js";
import type { EventModule } from "../types/Event.js";
import { configurationService } from "../services/configurationService.js";
import { logger } from "../utils/logger.js";
import { ensureStaffAccess, hasStaffAccess } from "../utils/accessControl.js";

const ensureGuildContext = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used within a server.",
      ephemeral: true
    });
    return false;
  }

  return true;
};

const event: EventModule<"interactionCreate"> = {
  name: "interactionCreate",
  execute: async (interaction: Interaction) => {
    // Manejar botones (reporte de usuario y acciones de staff)
    if (interaction.isButton()) {
      if (interaction.customId === "report_user_button") {
        if (!interaction.inGuild() || !interaction.guild) {
          await interaction.reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        try {
          // Importación dinámica para evitar cargar modelos al inicio
          const { createReportModal } = await import("../utils/reportHandler.js");
          const modal = createReportModal();
          await interaction.showModal(modal);
        } catch (error) {
          logger.error("Error showing the report modal:", error);
          await interaction.reply({
            content: "An error occurred while opening the report form.",
            ephemeral: true
          }).catch(() => {
            // If already responded, ignore
          });
        }
        return;
      }

      // Botón "Tomar Reporte"
      if (interaction.customId.startsWith("take_report_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferUpdate();

        try {
          const caseId = parseInt(interaction.customId.replace("take_report_", ""));
          const { updateReportEmbedTaken } = await import("../utils/reportVerdictHandler.js");

          if (interaction.message) {
            await updateReportEmbedTaken(interaction.message, interaction.user, caseId);
          }
        } catch (error) {
          logger.error("Error taking the report:", error);
          await interaction.followUp({
            content: "An error occurred while taking the report.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Dar Veredicto"
      if (interaction.customId.startsWith("give_verdict_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        try {
          const caseId = parseInt(interaction.customId.replace("give_verdict_", ""));
          const { createVerdictModal } = await import("../utils/reportVerdictHandler.js");
          const modal = createVerdictModal(caseId);
          await interaction.showModal(modal);
        } catch (error) {
          logger.error("Error showing the verdict modal:", error);
          await interaction.reply({
            content: "An error occurred while opening the verdict form.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Abrir Canal Privado"
      if (interaction.customId.startsWith("open_private_channel_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferUpdate();

        try {
          const caseId = parseInt(interaction.customId.replace("open_private_channel_", ""));

          // Get the report information from the embed
          const embed = interaction.message.embeds[0];
          if (!embed || !embed.fields) {
            await interaction.followUp({
              content: "Could not get the report information.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Extract IDs of the reporter and reported from the embed fields
          let reporterId: string | null = null;
          let reportedUserId: string | null = null;
          let reason = "";
          const evidenceUrls: string[] = [];

          for (const field of embed.fields) {
            if (field.name === "Reporter") {
              const match = field.value?.match(/<@(\d+)>/);
              if (match && match[1]) reporterId = match[1];
            } else if (field.name === "Reported") {
              const match = field.value?.match(/<@(\d+)>/);
              if (match && match[1]) reportedUserId = match[1];
            } else if (field.name === "Report Reason") {
              reason = field.value || "";
            } else if (field.name === "Evidence") {
              const value = field.value || "";
              const urls = value.split("\n").map((line) => {
                const match = line.match(/^\d+\.\s*(.+)$/);
                return match && match[1] ? match[1].trim() : line.trim();
              });
              evidenceUrls.push(...urls.filter((url) => url));
            }
          }

          if (!reporterId || !reportedUserId) {
            await interaction.followUp({
              content: "Could not identify the reporter or reported from the embed.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Obtener información de los usuarios para el mensaje inicial
          const reporter = await interaction.guild.client.users.fetch(reporterId).catch(() => null);
          const reportedUser = await interaction.guild.client.users.fetch(reportedUserId).catch(() => null);

          if (!reporter || !reportedUser) {
            await interaction.followUp({
              content: "No se pudieron obtener los datos de los usuarios involucrados.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Crear el canal privado
          const {
            createPrivateReportChannel,
            sendInitialReportChannelMessage,
            updateReportEmbedWithChannel
          } = await import("../utils/reportChannelHandler.js");

          const channel = await createPrivateReportChannel(
            interaction.guild,
            caseId,
            reporterId,
            reportedUserId
          );

          if (!channel) {
            await interaction.followUp({
              content:
                "Could not create the private channel. Verify that the category is configured correctly with `/setup-report-private-category`.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Send initial message in the channel
          await sendInitialReportChannelMessage(
            channel,
            caseId,
            { id: reporterId, tag: reporter.tag },
            { id: reportedUserId, tag: reportedUser.tag },
            reason,
            evidenceUrls.length > 0 ? evidenceUrls : undefined
          );

          // Update the report embed
          if (interaction.message) {
            await updateReportEmbedWithChannel(
              interaction.message,
              caseId,
              channel,
              { id: interaction.user.id, tag: interaction.user.tag }
            );
          }

          await interaction.followUp({
            content: `✅ Private channel created: <#${channel.id}>`,
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error creating private report channel:", error);
          await interaction.followUp({
            content: "An error occurred while creating the private channel.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Button "Close Private Channel"
      if (interaction.customId.startsWith("close_report_channel_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const caseId = parseInt(interaction.customId.replace("close_report_channel_", ""));

          if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
            await interaction.followUp({
              content: "This command can only be used in a text channel of the server.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          const channel = interaction.channel as TextChannel;

          // Verify that the channel is a private report channel
          // Check for both "report-" and "reporte-" to handle both naming conventions
          const isReportChannelByName = channel.name.startsWith("report-") || channel.name.startsWith("reporte-");
          
          // Also verify the channel is in the configured private report category
          const moderationConfig = await configurationService.getModerationConfig(interaction.guildId);
          const configuredCategoryId = moderationConfig?.reportPrivateChannelCategoryId;
          const isInReportCategory = configuredCategoryId && channel.parentId === configuredCategoryId;
          
          // Allow if either condition is met (name pattern OR category match)
          // This provides flexibility while maintaining security
          if (!isReportChannelByName && !isInReportCategory) {
            await interaction.followUp({
              content: "This command can only be used in private report channels.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          const { closeReportChannel } = await import("../utils/reportChannelHandler.js");

          await closeReportChannel(channel, caseId, {
            id: interaction.user.id,
            tag: interaction.user.tag
          });

          await interaction.followUp({
            content: "✅ Private channel closed successfully.",
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error closing private report channel:", error);
          await interaction.followUp({
            content: "An error occurred while closing the channel.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Buttons to open tickets (4 categories)
      if (
        interaction.customId === "ticket_open_general" ||
        interaction.customId === "ticket_open_support" ||
        interaction.customId === "ticket_open_other"
      ) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const category = interaction.customId.replace("ticket_open_", "") as
            | "general"
            | "support"
            | "other";

          const { createTicket, sendTicketInitialMessage, hasOpenTicket } = await import("../utils/ticketHandler.js");

          // Check if user already has an open ticket before attempting to create
          const existingTicket = await hasOpenTicket(interaction.guild, interaction.user.id);
          if (existingTicket) {
            await interaction.followUp({
              content: `❌ You already have an open ticket: <#${existingTicket.id}>\n\nPlease close your current ticket before creating a new one.`,
              ephemeral: true
            }).catch(() => {});
            return;
          }

          const channel = await createTicket(interaction.guild, interaction.user.id, category);

          if (!channel) {
            await interaction.followUp({
              content:
                "Could not create ticket. Please ensure the category is configured correctly using `/setup-ticket-category`.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          await sendTicketInitialMessage(channel, interaction.user.id, category);

          await interaction.followUp({
            content: `✅ Ticket created: <#${channel.id}>`,
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error creating ticket:", error);
          await interaction.followUp({
            content: "An error occurred while creating the ticket.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Tomar Ticket"
      if (interaction.customId.startsWith("ticket_take_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferUpdate();

        try {
          const channelId = interaction.customId.replace("ticket_take_", "");
          const channel = (await interaction.guild.channels
            .fetch(channelId)
            .catch(() => null)) as TextChannel | null;

          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            await interaction.followUp({
              content: "Could not find the ticket channel.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Find the initial message of the ticket
          const messages = await channel.messages.fetch({ limit: 10 });
          const initialMessage = messages.find((m) => m.embeds.length > 0 && m.components.length > 0);

          if (initialMessage) {
            const { updateTicketEmbedTaken } = await import("../utils/ticketHandler.js");
            await updateTicketEmbedTaken(initialMessage, {
              id: interaction.user.id,
              tag: interaction.user.tag
            });
          }
        } catch (error) {
          logger.error("Error taking the ticket:", error);
          await interaction.followUp({
            content: "An error occurred while taking the ticket.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Button "Close Ticket"
      if (interaction.customId.startsWith("ticket_close_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        try {
          const channelId = interaction.customId.replace("ticket_close_", "");
          const { createCloseTicketModal } = await import("../utils/ticketHandler.js");
          const modal = createCloseTicketModal(channelId);
          await interaction.showModal(modal);
        } catch (error) {
          logger.error("Error showing the close ticket modal:", error);
          await interaction.reply({
            content: "An error occurred while opening the close ticket form.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Button "Save Transcript"
      if (interaction.customId.startsWith("ticket_transcript_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const channelId = interaction.customId.replace("ticket_transcript_", "");
          const channel = (await interaction.guild.channels
            .fetch(channelId)
            .catch(() => null)) as TextChannel | null;

          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            await interaction.followUp({
              content: "Could not find the ticket channel.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Verify that the channel is a ticket channel
          if (!channel.name.startsWith("ticket-")) {
            await interaction.followUp({
              content: "This command can only be used in ticket channels.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          const { generateTranscript } = await import("../utils/ticketHandler.js");

          await generateTranscript(channel, {
            id: interaction.user.id,
            tag: interaction.user.tag
          });

          await interaction.followUp({
            content: "✅ Transcript saved successfully.",
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error generating transcript:", error);
          await interaction.followUp({
            content: `An error occurred while generating the transcript: ${error instanceof Error ? error.message : "Unknown error"}`,
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Button "Take Ticket"
      if (interaction.customId.startsWith("ticket_take_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This button can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This button is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferUpdate();

        try {
          const channelId = interaction.customId.replace("ticket_take_", "");
          const channel = (await interaction.guild.channels
            .fetch(channelId)
            .catch(() => null)) as TextChannel | null;

          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            await interaction.followUp({
              content: "Could not find the ticket channel.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Find the initial message of the ticket
          const messages = await channel.messages.fetch({ limit: 10 });
          const initialMessage = messages.find((m) => m.embeds.length > 0 && m.components.length > 0);

          if (initialMessage) {
            const { updateTicketEmbedTaken } = await import("../utils/ticketHandler.js");
            await updateTicketEmbedTaken(initialMessage, {
              id: interaction.user.id,
              tag: interaction.user.tag
            });
          }
        } catch (error) {
          logger.error("Error taking the ticket:", error);
          await interaction.followUp({
            content: "An error occurred while taking the ticket.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      return;
    }

    // Handle modals (sending report, verdict and closing ticket)
    if (interaction.isModalSubmit()) {
      // Modal de cierre de ticket
      if (interaction.customId.startsWith("close_ticket_modal_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await interaction.reply({
            content: "This form can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await interaction.reply({
            content:
              "This form is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const channelId = interaction.customId.replace("close_ticket_modal_", "");
          const reason = interaction.fields.getTextInputValue("close_reason");

          const channel = (await interaction.guild.channels
            .fetch(channelId)
            .catch(() => null)) as TextChannel | null;

          if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            try {
              await interaction.editReply({
                content: "Could not find the ticket channel."
              });
            } catch {
              await interaction.followUp({
                content: "Could not find the ticket channel.",
                ephemeral: true
              }).catch(() => {});
            }
            return;
          }

          // Verify that the channel is a ticket channel
          if (!channel.name.startsWith("ticket-")) {
            try {
              await interaction.editReply({
                content: "This command can only be used in ticket channels."
              });
            } catch {
              await interaction.followUp({
                content: "This command can only be used in ticket channels.",
                ephemeral: true
              }).catch(() => {});
            }
            return;
          }

          const { closeTicket } = await import("../utils/ticketHandler.js");

          await closeTicket(channel, {
            id: interaction.user.id,
            tag: interaction.user.tag
          }, reason);

          try {
            await interaction.editReply({
              content: "✅ Ticket closed successfully."
            });
          } catch {
            await interaction.followUp({
              content: "✅ Ticket closed successfully.",
              ephemeral: true
            }).catch(() => {});
          }
        } catch (error) {
          logger.error("Error closing ticket:", error);
          try {
            await interaction.editReply({
              content: "An error occurred while closing the ticket."
            });
          } catch {
            await interaction.followUp({
              content: "An error occurred while closing the ticket.",
              ephemeral: true
            }).catch(() => {});
          }
        }
        return;
      }

      if (interaction.customId === "report_user_modal") {
        if (!interaction.inGuild() || !interaction.guild) {
          await interaction.reply({
            content: "This form can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          // Dynamic import to avoid loading models at startup
          const { processUserReport } = await import("../utils/reportHandler.js");
          const userInput = interaction.fields.getTextInputValue("report_user_id");
          const reason = interaction.fields.getTextInputValue("report_reason");
          const evidenceInput = interaction.fields.getTextInputValue("report_evidence") || null;

          const result = await processUserReport(
            interaction.guild,
            interaction.user,
            userInput,
            reason,
            evidenceInput
          );

          await interaction.editReply({
            content: result.message,
            embeds: []
          });
        } catch (error) {
          logger.error("Error processing the report modal:", error);
          await interaction.editReply({
            content: "An error occurred while processing your report. Please try again later.",
            embeds: []
          });
        }
        return;
      }

      // Modal of verdict
      if (interaction.customId.startsWith("verdict_modal_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await interaction.reply({
            content: "This form can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        // Verify that it is staff
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "This form can only be used within a server.",
            ephemeral: true
          });
          return;
        }

        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "This form is limited to authorized staff. Verify that you have the corresponding role or permission.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const caseId = parseInt(interaction.customId.replace("verdict_modal_", ""));
          const verdict = interaction.fields.getTextInputValue("verdict_text");

          // Get the report information from the embed of the message
          const message = interaction.message;
          if (!message || !message.embeds[0]) {
            await interaction.editReply({
              content: "Could not find the report information.",
              embeds: []
            });
            return;
          }

          const embed = message.embeds[0];
          const reporterField = embed.fields?.find((f) => f.name === "Reporter");
          const reportedField = embed.fields?.find((f) => f.name === "Reported");

          if (!reporterField || !reportedField) {
            await interaction.editReply({
              content: "Could not find the information of the reporter or reported.",
              embeds: []
            });
            return;
          }

          // Extract IDs of the fields (format: <@ID> (tag))
          const reporterMatch = reporterField.value.match(/<@(\d+)>/);
          const reportedMatch = reportedField.value.match(/<@(\d+)>/);

          if (!reporterMatch || !reportedMatch) {
            await interaction.editReply({
              content: "Could not extract the IDs of the users.",
              embeds: []
            });
            return;
          }

          const reporterId = reporterMatch[1]!;
          const reportedUserId = reportedMatch[1]!;

          // Import necessary functions
          const {
            sendVerdictDMs,
            updateReportEmbedVerdict
          } = await import("../utils/reportVerdictHandler.js");

          // Send DMs to both users
          await sendVerdictDMs(
            interaction.guild,
            reporterId,
            reportedUserId,
            caseId,
            verdict,
            interaction.user
          );

          // Update the report embed
          if (message) {
            await updateReportEmbedVerdict(message, interaction.user, caseId, verdict);
          }

          await interaction.editReply({
            content: `Verdict sent successfully. Both users were notified by DM.`,
            embeds: []
          });
        } catch (error) {
          logger.error("Error processing the verdict:", error);
          await interaction.editReply({
            content: "An error occurred while processing the verdict. Please try again later.",
            embeds: []
          });
        }
        return;
      }

      return;
    }

    // Handle chat commands (existing logic)
    if (!interaction.isChatInputCommand()) return;

    const botClient = interaction.client as BotClient;
    const command = botClient.commands.get(interaction.commandName);

    if (!command) {
      await interaction.reply({
        content: "This command is no longer available.",
        ephemeral: true
      });
      logger.warn(`Attempt to use unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      if (command.guildOnly) {
        const allowed = await ensureGuildContext(interaction);
        if (!allowed) return;
      }

      if (command.access === "staff") {
        const allowed = await ensureStaffAccess(interaction);
        if (!allowed) return;
      }

      if (command.requiredPermissions?.length && interaction.inGuild()) {
        const hasPermissions = interaction.memberPermissions?.has(command.requiredPermissions);
        if (!hasPermissions) {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
              content: "You do not have sufficient permissions to execute this command.",
              ephemeral: true
            });
          } else {
            await interaction.reply({
              content: "You do not have sufficient permissions to execute this command.",
              ephemeral: true
            });
          }
          return;
        }
      }

      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error executing the command ${interaction.commandName}`, error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "An unexpected error occurred while processing the command.",
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: "An unexpected error occurred while processing the command.",
            ephemeral: true
          });
        }
      } catch (replyError) {
        logger.error("Error sending error message to the user:", replyError);
      }
    }
  }
};

export default event;

