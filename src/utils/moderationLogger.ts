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
 * Envía un log de moderación al canal configurado.
 * Si no hay canal configurado o hay un error, registra en el logger pero no falla.
 */
export const logModerationAction = async (options: LogModerationActionOptions): Promise<void> => {
  const { guild, actionType, caseId, targetUser, moderator, reason, evidenceUrls, durationMs, expiresAt, metadata } =
    options;

  try {
    const moderationConfig = await configurationService.getModerationConfig(guild.id);
    const logChannelId = moderationConfig?.logChannelId;

    if (!logChannelId) {
      // No hay canal configurado, no es un error crítico
      return;
    }

    const channel = (await guild.channels.fetch(logChannelId).catch(() => null)) as TextChannel | null;

    if (!channel) {
      logger.warn(
        `El canal de logs de moderación (${logChannelId}) no existe o no es accesible en el servidor ${guild.id}.`
      );
      return;
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      logger.warn(
        `El canal de logs de moderación (${logChannelId}) no es un canal de texto válido en el servidor ${guild.id}.`
      );
      return;
    }

    // Verificar permisos del bot
    const me = await guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      logger.warn(
        `El bot no tiene permisos suficientes en el canal de logs (${logChannelId}) del servidor ${guild.id}.`
      );
      return;
    }

    // Mapeo de tipos de acción a colores y emojis
    const actionConfig: Record<
      ModerationActionType,
      { color: number; emoji: string; title: string; description: string }
    > = {
      warn: {
        color: Colors.Yellow,
        emoji: "🔔",
        title: "Advertencia Registrada",
        description: `Se registró una advertencia para ${targetUser.tag}`
      },
      mute: {
        color: Colors.Orange,
        emoji: "🔇",
        title: "Miembro Silenciado",
        description: `${targetUser.tag} fue silenciado`
      },
      unmute: {
        color: Colors.Green,
        emoji: "🔊",
        title: "Mute Removido",
        description: `Se removió el mute de ${targetUser.tag}`
      },
      kick: {
        color: Colors.Red,
        emoji: "👋",
        title: "Miembro Expulsado",
        description: `${targetUser.tag} fue expulsado del servidor`
      },
      ban: {
        color: Colors.DarkRed,
        emoji: "🔨",
        title: "Miembro Baneado",
        description: `${targetUser.tag} fue baneado del servidor`
      },
      unban: {
        color: Colors.Green,
        emoji: "✅",
        title: "Miembro Desbaneado",
        description: `${targetUser.tag} fue desbaneado del servidor`
      },
      note: {
        color: Colors.Blue,
        emoji: "📝",
        title: "Nota Registrada",
        description: `Se registró una nota para ${targetUser.tag}`
      }
    };

    // Detectar si es un reporte
    const isReport = metadata?.reportType === "user_report";

    // Si es un reporte, usar configuración especial
    if (isReport && actionType === "note") {
      const reportConfig = {
        color: Colors.Red,
        emoji: "🚨",
        title: "Reporte de Usuario",
        description: `Se recibió un reporte sobre ${targetUser.tag}`
      };

      const embed = createBaseEmbed({
        title: `${reportConfig.emoji} ${reportConfig.title}`,
        description: reportConfig.description,
        color: reportConfig.color,
        footerText: `Caso #${caseId} · ID: ${targetUser.id}`
      }).addFields(
        {
          name: "Reportante",
          value: `<@${moderator.id}> (${moderator.tag})`,
          inline: true
        },
        {
          name: "Reportado",
          value: `<@${targetUser.id}> (${targetUser.tag})`,
          inline: true
        },
        {
          name: "Motivo del Reporte",
          value: reason.replace(/^\[REPORTE\]\s*/, "") || "No especificado"
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

      await channel.send({ embeds: [embed] });
      return;
    }

    const config = actionConfig[actionType];
    const embed = createBaseEmbed({
      title: `${config.emoji} ${config.title}`,
      description: config.description,
      color: config.color,
      footerText: `Caso #${caseId} · ID: ${targetUser.id}`
    }).addFields(
      {
        name: "Moderador",
        value: `<@${moderator.id}> (${moderator.tag})`,
        inline: true
      },
      {
        name: "Miembro",
        value: `<@${targetUser.id}> (${targetUser.tag})`,
        inline: true
      },
      {
        name: "Motivo",
        value: reason || "No especificado"
      }
    );

    // Añadir información adicional según el tipo de acción
    if (durationMs && (actionType === "mute" || actionType === "ban")) {
      embed.addFields({
        name: "Duración",
        value: formatDuration(durationMs),
        inline: true
      });
    }

    if (expiresAt && (actionType === "mute" || actionType === "ban")) {
      embed.addFields({
        name: "Expira",
        value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
        inline: true
      });
    }

    if (evidenceUrls && evidenceUrls.length > 0) {
      embed.addFields({
        name: "Evidencia",
        value: evidenceUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")
      });
    }

    // Añadir metadata si existe información adicional relevante
    if (metadata?.automated) {
      embed.addFields({
        name: "Tipo",
        value: "Automático",
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
    // No queremos que un error en el logging rompa el flujo de moderación
    logger.error(`Error al enviar log de moderación en el servidor ${guild.id}:`, error);
  }
};

