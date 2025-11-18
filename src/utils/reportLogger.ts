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
 * Envía un log de reporte al canal configurado específicamente para reportes.
 * Si no hay canal configurado, no envía nada (no falla).
 */
export const logUserReport = async (options: LogReportOptions): Promise<void> => {
  const { guild, caseId, reporter, reportedUser, reason, evidenceUrls } = options;

  try {
    const moderationConfig = await configurationService.getModerationConfig(guild.id);
    const reportLogChannelId = moderationConfig?.reportLogChannelId;

    if (!reportLogChannelId) {
      // No hay canal configurado para reportes, no es un error crítico
      return;
    }

    const channel = (await guild.channels.fetch(reportLogChannelId).catch(() => null)) as TextChannel | null;

    if (!channel) {
      logger.warn(
        `El canal de logs de reportes (${reportLogChannelId}) no existe o no es accesible en el servidor ${guild.id}.`
      );
      return;
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      logger.warn(
        `El canal de logs de reportes (${reportLogChannelId}) no es un canal de texto válido en el servidor ${guild.id}.`
      );
      return;
    }

    // Verificar permisos del bot
    const me = await guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      logger.warn(
        `El bot no tiene permisos suficientes en el canal de logs de reportes (${reportLogChannelId}) del servidor ${guild.id}.`
      );
      return;
    }

    const embed = createBaseEmbed({
      title: "🚨 Reporte de Usuario",
      description: `Se recibió un reporte sobre ${reportedUser.tag}`,
      color: Colors.Red,
      footerText: `Caso #${caseId} · ID: ${reportedUser.id}`
    }).addFields(
      {
        name: "Reportante",
        value: `<@${reporter.id}> (${reporter.tag})`,
        inline: true
      },
      {
        name: "Reportado",
        value: `<@${reportedUser.id}> (${reportedUser.tag})`,
        inline: true
      },
      {
        name: "Motivo del Reporte",
        value: reason || "No especificado"
      }
    );

    if (evidenceUrls && evidenceUrls.length > 0) {
      embed.addFields({
        name: "Evidencia",
        value: evidenceUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")
      });
    }

    embed.addFields({
      name: "Timestamp",
      value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
      inline: true
    });

    // Agregar botones para que el staff pueda tomar el reporte y dar veredicto
    const takeReportButton = new ButtonBuilder()
      .setCustomId(`take_report_${caseId}`)
      .setLabel("Tomar Reporte")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("✋");

    const giveVerdictButton = new ButtonBuilder()
      .setCustomId(`give_verdict_${caseId}`)
      .setLabel("Dar Veredicto")
      .setStyle(ButtonStyle.Success)
      .setEmoji("⚖️");

    const openPrivateChannelButton = new ButtonBuilder()
      .setCustomId(`open_private_channel_${caseId}`)
      .setLabel("Abrir Canal Privado")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔒");

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      takeReportButton,
      giveVerdictButton,
      openPrivateChannelButton
    );

    await channel.send({ embeds: [embed], components: [actionRow] });
  } catch (error) {
    // No queremos que un error en el logging rompa el flujo de reportes
    logger.error(`Error al enviar log de reporte en el servidor ${guild.id}:`, error);
  }
};

