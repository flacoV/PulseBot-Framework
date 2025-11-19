import type { ChatInputCommandInteraction, Interaction, TextChannel } from "discord.js";

import type { BotClient } from "../types/BotClient.js";
import type { EventModule } from "../types/Event.js";
import { logger } from "../utils/logger.js";
import { ensureStaffAccess, hasStaffAccess } from "../utils/accessControl.js";

const ensureGuildContext = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Este comando solo puede usarse dentro de un servidor.",
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
            content: "Este botón solo puede usarse dentro de un servidor.",
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
          logger.error("Error al mostrar el modal de reporte:", error);
          await interaction.reply({
            content: "Ocurrió un error al abrir el formulario de reporte.",
            ephemeral: true
          }).catch(() => {
            // Si ya respondió, ignorar
          });
        }
        return;
      }

      // Botón "Tomar Reporte"
      if (interaction.customId.startsWith("take_report_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
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
          logger.error("Error al tomar el reporte:", error);
          await interaction.followUp({
            content: "Ocurrió un error al tomar el reporte.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Dar Veredicto"
      if (interaction.customId.startsWith("give_verdict_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
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
          logger.error("Error al mostrar el modal de veredicto:", error);
          await interaction.reply({
            content: "Ocurrió un error al abrir el formulario de veredicto.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Abrir Canal Privado"
      if (interaction.customId.startsWith("open_private_channel_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferUpdate();

        try {
          const caseId = parseInt(interaction.customId.replace("open_private_channel_", ""));

          // Obtener información del reporte desde el embed
          const embed = interaction.message.embeds[0];
          if (!embed || !embed.fields) {
            await interaction.followUp({
              content: "No se pudo obtener la información del reporte.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Extraer IDs del reportante y reportado desde los campos del embed
          let reporterId: string | null = null;
          let reportedUserId: string | null = null;
          let reason = "";
          const evidenceUrls: string[] = [];

          for (const field of embed.fields) {
            if (field.name === "Reportante") {
              const match = field.value?.match(/<@(\d+)>/);
              if (match && match[1]) reporterId = match[1];
            } else if (field.name === "Reportado") {
              const match = field.value?.match(/<@(\d+)>/);
              if (match && match[1]) reportedUserId = match[1];
            } else if (field.name === "Motivo del Reporte") {
              reason = field.value || "";
            } else if (field.name === "Evidencia") {
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
              content: "No se pudo identificar al reportante o reportado desde el embed.",
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
                "No se pudo crear el canal privado. Verifica que la categoría esté configurada correctamente con `/setup-report-private-category`.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Enviar mensaje inicial en el canal
          await sendInitialReportChannelMessage(
            channel,
            caseId,
            { id: reporterId, tag: reporter.tag },
            { id: reportedUserId, tag: reportedUser.tag },
            reason,
            evidenceUrls.length > 0 ? evidenceUrls : undefined
          );

          // Actualizar el embed del reporte
          if (interaction.message) {
            await updateReportEmbedWithChannel(
              interaction.message,
              caseId,
              channel,
              { id: interaction.user.id, tag: interaction.user.tag }
            );
          }

          await interaction.followUp({
            content: `✅ Canal privado creado: <#${channel.id}>`,
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error al crear canal privado de reporte:", error);
          await interaction.followUp({
            content: "Ocurrió un error al crear el canal privado.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Cerrar Canal Privado"
      if (interaction.customId.startsWith("close_report_channel_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const caseId = parseInt(interaction.customId.replace("close_report_channel_", ""));

          if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
            await interaction.followUp({
              content: "Este comando solo puede usarse en un canal de texto del servidor.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          const channel = interaction.channel as TextChannel;

          // Verificar que el canal sea un canal privado de reporte
          if (!channel.name.startsWith("reporte-")) {
            await interaction.followUp({
              content: "Este comando solo puede usarse en canales privados de reportes.",
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
            content: "✅ Canal cerrado correctamente.",
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error al cerrar canal privado de reporte:", error);
          await interaction.followUp({
            content: "Ocurrió un error al cerrar el canal.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botones para abrir tickets (4 categorías)
      if (
        interaction.customId === "ticket_open_general" ||
        interaction.customId === "ticket_open_support" ||
        interaction.customId === "ticket_open_reports" ||
        interaction.customId === "ticket_open_other"
      ) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const category = interaction.customId.replace("ticket_open_", "") as
            | "general"
            | "support"
            | "reports"
            | "other";

          const { createTicket, sendTicketInitialMessage } = await import("../utils/ticketHandler.js");

          const channel = await createTicket(interaction.guild, interaction.user.id, category);

          if (!channel) {
            await interaction.followUp({
              content:
                "No se pudo crear el ticket. Verifica que la categoría esté configurada correctamente con `/setup-ticket-category`.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          await sendTicketInitialMessage(channel, interaction.user.id, category);

          await interaction.followUp({
            content: `✅ Ticket creado: <#${channel.id}>`,
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error al crear ticket:", error);
          await interaction.followUp({
            content: "Ocurrió un error al crear el ticket.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Tomar Ticket"
      if (interaction.customId.startsWith("ticket_take_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
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
              content: "No se pudo encontrar el canal del ticket.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Buscar el mensaje inicial del ticket
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
          logger.error("Error al tomar el ticket:", error);
          await interaction.followUp({
            content: "Ocurrió un error al tomar el ticket.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Cerrar Ticket"
      if (interaction.customId.startsWith("ticket_close_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
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
          logger.error("Error al mostrar el modal de cierre de ticket:", error);
          await interaction.reply({
            content: "Ocurrió un error al abrir el formulario de cierre.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Guardar Transcript"
      if (interaction.customId.startsWith("ticket_transcript_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
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
              content: "No se pudo encontrar el canal del ticket.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Verificar que el canal sea un ticket
          if (!channel.name.startsWith("ticket-")) {
            await interaction.followUp({
              content: "Este comando solo puede usarse en canales de tickets.",
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
            content: "✅ Transcript guardado correctamente.",
            ephemeral: true
          }).catch(() => {});
        } catch (error) {
          logger.error("Error al generar transcript:", error);
          await interaction.followUp({
            content: `Ocurrió un error al generar el transcript: ${error instanceof Error ? error.message : "Error desconocido"}`,
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      // Botón "Tomar Ticket"
      if (interaction.customId.startsWith("ticket_take_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este botón solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este botón está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
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
              content: "No se pudo encontrar el canal del ticket.",
              ephemeral: true
            }).catch(() => {});
            return;
          }

          // Buscar el mensaje inicial del ticket
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
          logger.error("Error al tomar el ticket:", error);
          await interaction.followUp({
            content: "Ocurrió un error al tomar el ticket.",
            ephemeral: true
          }).catch(() => {});
        }
        return;
      }

      return;
    }

    // Manejar modales (envío de reporte, veredicto y cierre de ticket)
    if (interaction.isModalSubmit()) {
      // Modal de cierre de ticket
      if (interaction.customId.startsWith("close_ticket_modal_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await interaction.reply({
            content: "Este formulario solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await interaction.reply({
            content:
              "Este formulario está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
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
                content: "No se pudo encontrar el canal del ticket."
              });
            } catch {
              await interaction.followUp({
                content: "No se pudo encontrar el canal del ticket.",
                ephemeral: true
              }).catch(() => {});
            }
            return;
          }

          // Verificar que el canal sea un ticket
          if (!channel.name.startsWith("ticket-")) {
            try {
              await interaction.editReply({
                content: "Este comando solo puede usarse en canales de tickets."
              });
            } catch {
              await interaction.followUp({
                content: "Este comando solo puede usarse en canales de tickets.",
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
              content: "✅ Ticket cerrado correctamente."
            });
          } catch {
            await interaction.followUp({
              content: "✅ Ticket cerrado correctamente.",
              ephemeral: true
            }).catch(() => {});
          }
        } catch (error) {
          logger.error("Error al cerrar ticket:", error);
          try {
            await interaction.editReply({
              content: "Ocurrió un error al cerrar el ticket."
            });
          } catch {
            await interaction.followUp({
              content: "Ocurrió un error al cerrar el ticket.",
              ephemeral: true
            }).catch(() => {});
          }
        }
        return;
      }

      if (interaction.customId === "report_user_modal") {
        if (!interaction.inGuild() || !interaction.guild) {
          await interaction.reply({
            content: "Este formulario solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          // Importación dinámica para evitar cargar modelos al inicio
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
          logger.error("Error al procesar el modal de reporte:", error);
          await interaction.editReply({
            content: "Ocurrió un error al procesar tu reporte. Por favor, intenta nuevamente más tarde.",
            embeds: []
          });
        }
        return;
      }

      // Modal de veredicto
      if (interaction.customId.startsWith("verdict_modal_")) {
        if (!interaction.inGuild() || !interaction.guild) {
          await interaction.reply({
            content: "Este formulario solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        // Verificar que sea staff
        if (!interaction.inGuild() || !interaction.guild) {
          await (interaction as any).reply({
            content: "Este formulario solo puede usarse dentro de un servidor.",
            ephemeral: true
          });
          return;
        }

        const hasAccess = hasStaffAccess(interaction as any);
        if (!hasAccess) {
          await (interaction as any).reply({
            content:
              "Este formulario está limitado al personal autorizado. Verifica que tengas el rol o permiso correspondiente.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const caseId = parseInt(interaction.customId.replace("verdict_modal_", ""));
          const verdict = interaction.fields.getTextInputValue("verdict_text");

          // Obtener información del reporte desde el embed del mensaje
          const message = interaction.message;
          if (!message || !message.embeds[0]) {
            await interaction.editReply({
              content: "No se pudo encontrar la información del reporte.",
              embeds: []
            });
            return;
          }

          const embed = message.embeds[0];
          const reporterField = embed.fields?.find((f) => f.name === "Reportante");
          const reportedField = embed.fields?.find((f) => f.name === "Reportado");

          if (!reporterField || !reportedField) {
            await interaction.editReply({
              content: "No se pudo encontrar la información del reportante o reportado.",
              embeds: []
            });
            return;
          }

          // Extraer IDs de los campos (formato: <@ID> (tag))
          const reporterMatch = reporterField.value.match(/<@(\d+)>/);
          const reportedMatch = reportedField.value.match(/<@(\d+)>/);

          if (!reporterMatch || !reportedMatch) {
            await interaction.editReply({
              content: "No se pudieron extraer los IDs de los usuarios.",
              embeds: []
            });
            return;
          }

          const reporterId = reporterMatch[1]!;
          const reportedUserId = reportedMatch[1]!;

          // Importar funciones necesarias
          const {
            sendVerdictDMs,
            updateReportEmbedVerdict
          } = await import("../utils/reportVerdictHandler.js");

          // Enviar DMs a ambos usuarios
          await sendVerdictDMs(
            interaction.guild,
            reporterId,
            reportedUserId,
            caseId,
            verdict,
            interaction.user
          );

          // Actualizar el embed del reporte
          if (message) {
            await updateReportEmbedVerdict(message, interaction.user, caseId, verdict);
          }

          await interaction.editReply({
            content: `Veredicto enviado correctamente. Se notificó a ambos usuarios por MD.`,
            embeds: []
          });
        } catch (error) {
          logger.error("Error al procesar el veredicto:", error);
          await interaction.editReply({
            content: "Ocurrió un error al procesar el veredicto. Por favor, intenta nuevamente más tarde.",
            embeds: []
          });
        }
        return;
      }

      return;
    }

    // Manejar comandos de chat (lógica existente)
    if (!interaction.isChatInputCommand()) return;

    const botClient = interaction.client as BotClient;
    const command = botClient.commands.get(interaction.commandName);

    if (!command) {
      await interaction.reply({
        content: "Este comando ya no está disponible.",
        ephemeral: true
      });
      logger.warn(`Intento de usar comando desconocido: ${interaction.commandName}`);
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
              content: "No tienes permisos suficientes para ejecutar este comando.",
              ephemeral: true
            });
          } else {
            await interaction.reply({
              content: "No tienes permisos suficientes para ejecutar este comando.",
              ephemeral: true
            });
          }
          return;
        }
      }

      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error al ejecutar el comando ${interaction.commandName}`, error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "Ha ocurrido un error inesperado al procesar el comando.",
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: "Ha ocurrido un error inesperado al procesar el comando.",
            ephemeral: true
          });
        }
      } catch (replyError) {
        logger.error("Error al enviar mensaje de error al usuario:", replyError);
      }
    }
  }
};

export default event;

