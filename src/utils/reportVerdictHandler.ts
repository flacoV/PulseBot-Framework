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
 * Crea el modal para dar un veredicto sobre un reporte.
 */
export const createVerdictModal = (caseId: number) => {
  const modal = new ModalBuilder()
    .setCustomId(`verdict_modal_${caseId}`)
    .setTitle(`Veredicto - Caso #${caseId}`);

  const verdictInput = new TextInputBuilder()
    .setCustomId("verdict_text")
    .setLabel("Veredicto")
    .setPlaceholder("Describe el veredicto y las acciones tomadas (si las hay)...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  const verdictRow = new ActionRowBuilder<TextInputBuilder>().addComponents(verdictInput);

  modal.addComponents(verdictRow);

  return modal;
};

/**
 * Envía DMs a ambos usuarios (reportante y reportado) con el veredicto.
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
    // Obtener usuarios
    const reporter = await guild.client.users.fetch(reporterId).catch(() => null);
    const reportedUser = await guild.client.users.fetch(reportedUserId).catch(() => null);

    const verdictEmbed = createBaseEmbed({
      title: "⚖️ Veredicto del Reporte",
      description: `Se ha emitido un veredicto para el caso #${caseId}`,
      color: 0x5865f2
    })
      .addFields({
        name: "Veredicto",
        value: verdict
      })
      .addFields({
        name: "Moderador",
        value: `${moderator.tag}`,
        inline: true
      })
      .addFields({
        name: "Servidor",
        value: guild.name,
        inline: true
      })
      .setFooter({ text: `Caso #${caseId}` })
      .setTimestamp();

    // Enviar DM al reportante
    if (reporter) {
      try {
        await reporter.send({ embeds: [verdictEmbed] });
      } catch (error) {
        logger.warn(`No se pudo enviar DM al reportante ${reporterId}:`, error);
      }
    }

    // Enviar DM al reportado
    if (reportedUser) {
      try {
        await reportedUser.send({ embeds: [verdictEmbed] });
      } catch (error) {
        logger.warn(`No se pudo enviar DM al reportado ${reportedUserId}:`, error);
      }
    }
  } catch (error) {
    logger.error("Error al enviar DMs del veredicto:", error);
  }
};

/**
 * Actualiza el embed del reporte para mostrar que fue tomado por un moderador.
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
      title: embed.title || "🚨 Reporte de Usuario",
      description: embed.description || "",
      color: embed.color || 0xff0000,
      footerText: embed.footer?.text || `Caso #${caseId}`
    });

    // Copiar todos los campos existentes
    if (embed.fields) {
      for (const field of embed.fields) {
        updatedEmbed.addFields(field);
      }
    }

    // Agregar campo de estado
    updatedEmbed.addFields({
      name: "Estado",
      value: `✅ Tomado por <@${moderator.id}> (${moderator.tag})`,
      inline: true
    });

    // Actualizar el mensaje
    await message.edit({ embeds: [updatedEmbed] });
  } catch (error) {
    logger.error("Error al actualizar embed del reporte:", error);
  }
};

/**
 * Actualiza el embed del reporte para mostrar el veredicto.
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
      title: embed.title || "🚨 Reporte de Usuario",
      description: embed.description || "",
      color: 0x00ff00, // Verde para veredicto dado
      footerText: embed.footer?.text || `Caso #${caseId}`
    });

    // Copiar todos los campos existentes
    if (embed.fields) {
      for (const field of embed.fields) {
        updatedEmbed.addFields(field);
      }
    }

    // Agregar campo de veredicto
    updatedEmbed.addFields({
      name: "Veredicto",
      value: verdict,
      inline: false
    });

    updatedEmbed.addFields({
      name: "Estado",
      value: `✅ Veredicto dado por <@${moderator.id}> (${moderator.tag})`,
      inline: true
    });

    // Remover botones (el reporte ya fue resuelto)
    await message.edit({ embeds: [updatedEmbed], components: [] });
  } catch (error) {
    logger.error("Error al actualizar embed del reporte con veredicto:", error);
  }
};

