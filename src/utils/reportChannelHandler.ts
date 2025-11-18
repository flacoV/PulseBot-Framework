import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type Message,
  type TextChannel
} from "discord.js";

import { configurationService } from "../services/configurationService.js";
import { createBaseEmbed } from "./embedBuilder.js";
import { logger } from "./logger.js";
import { getEnvVarList } from "./env.js";

/**
 * Obtiene los IDs de los roles de staff configurados.
 */
const getStaffRoleIds = (): Set<string> => {
  return new Set(getEnvVarList("STAFF_ROLE_IDS"));
};

/**
 * Crea un canal privado para un reporte específico.
 * El canal será visible solo para el reportante, reportado y staffs.
 */
export const createPrivateReportChannel = async (
  guild: Guild,
  caseId: number,
  reporterId: string,
  reportedUserId: string
): Promise<TextChannel | null> => {
  try {
    // Obtener la categoría configurada
    const moderationConfig = await configurationService.getModerationConfig(guild.id);
    const categoryId = moderationConfig?.reportPrivateChannelCategoryId;

    if (!categoryId) {
      logger.warn(
        `No hay categoría configurada para canales privados de reportes en el servidor ${guild.id}.`
      );
      return null;
    }

    // Obtener la categoría
    const category = (await guild.channels.fetch(categoryId).catch(() => null)) as
      | CategoryChannel
      | null;

    if (!category || category.type !== ChannelType.GuildCategory) {
      logger.warn(
        `La categoría de canales privados (${categoryId}) no existe o no es válida en el servidor ${guild.id}.`
      );
      return null;
    }

    // Verificar permisos del bot
    const me = await guild.members.fetchMe();
    const botPermissions = category.permissionsFor(me);

    if (
      !botPermissions?.has([
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
      ])
    ) {
      logger.warn(
        `El bot no tiene permisos suficientes para crear canales en la categoría ${categoryId} del servidor ${guild.id}.`
      );
      return null;
    }

    // Obtener roles de staff
    const staffRoleIds = getStaffRoleIds();

    // Configurar permisos del canal
    const permissionOverwrites = [
      // Denegar acceso a @everyone
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
        type: OverwriteType.Role
      },
      // Permitir acceso al reportante
      {
        id: reporterId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ],
        type: OverwriteType.Member
      },
      // Permitir acceso al reportado
      {
        id: reportedUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ],
        type: OverwriteType.Member
      }
    ];

    // Añadir permisos para roles de staff
    if (staffRoleIds.size > 0) {
      for (const roleId of staffRoleIds) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (role) {
          permissionOverwrites.push({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages
            ],
            type: OverwriteType.Role
          });
        }
      }
    } else {
      // Si no hay roles de staff configurados, permitir acceso a usuarios con ManageGuild
      // Esto se maneja a nivel de permisos del servidor, no necesitamos añadir un overwrite específico
      // Los usuarios con ManageGuild tendrán acceso automáticamente si el canal no lo deniega explícitamente
    }

    // Crear el canal
    const channel = await guild.channels.create({
      name: `reporte-${caseId}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites,
      topic: `Canal privado para el caso #${caseId} - Solo visible para reportante, reportado y staffs.`
    });

    logger.info(
      `Canal privado de reporte creado: ${channel.id} para el caso #${caseId} en el servidor ${guild.id}.`
    );

    return channel;
  } catch (error) {
    logger.error(`Error al crear canal privado de reporte para el caso #${caseId}:`, error);
    return null;
  }
};

/**
 * Envía un mensaje inicial en el canal privado con la información del reporte.
 */
export const sendInitialReportChannelMessage = async (
  channel: TextChannel,
  caseId: number,
  reporter: { id: string; tag: string },
  reportedUser: { id: string; tag: string },
  reason: string,
  evidenceUrls?: string[]
): Promise<Message | null> => {
  try {
    const embed = createBaseEmbed({
      title: `🔒 Canal Privado - Caso #${caseId}`,
      description:
        "Este canal es privado y solo visible para el reportante, reportado y el personal autorizado.",
      color: 0x5865f2,
      footerText: `Caso #${caseId}`
    })
      .addFields(
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
      )
      .setTimestamp();

    if (evidenceUrls && evidenceUrls.length > 0) {
      embed.addFields({
        name: "Evidencia",
        value: evidenceUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")
      });
    }

    // Crear botón para cerrar el canal
    const closeChannelButton = new ButtonBuilder()
      .setCustomId(`close_report_channel_${caseId}`)
      .setLabel("Cerrar Canal")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔒");

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(closeChannelButton);

    const message = await channel.send({
      content: `<@${reporter.id}> <@${reportedUser.id}>`,
      embeds: [embed],
      components: [actionRow]
    });

    return message;
  } catch (error) {
    logger.error(`Error al enviar mensaje inicial en el canal privado del caso #${caseId}:`, error);
    return null;
  }
};

/**
 * Actualiza el embed del reporte para mostrar que se creó un canal privado.
 */
export const updateReportEmbedWithChannel = async (
  message: Message,
  caseId: number,
  channel: TextChannel,
  creator: { id: string; tag: string }
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

    // Agregar campo del canal privado
    updatedEmbed.addFields({
      name: "Canal Privado",
      value: `<#${channel.id}> creado por <@${creator.id}>`,
      inline: true
    });

    // Actualizar el mensaje (mantener los botones)
    await message.edit({ embeds: [updatedEmbed] });
  } catch (error) {
    logger.error("Error al actualizar embed del reporte con canal privado:", error);
  }
};

/**
 * Cierra/archiva un canal privado de reporte.
 * Elimina el canal después de un breve delay para permitir que los usuarios vean el mensaje final.
 */
export const closeReportChannel = async (
  channel: TextChannel,
  caseId: number,
  closer: { id: string; tag: string }
): Promise<void> => {
  try {
    // Enviar mensaje de cierre
    const closeEmbed = createBaseEmbed({
      title: "🔒 Canal Cerrado",
      description: `Este canal ha sido cerrado por <@${closer.id}> (${closer.tag}).`,
      color: 0xff0000,
      footerText: `Caso #${caseId}`
    }).setTimestamp();

    await channel.send({ embeds: [closeEmbed] });

    // Esperar un momento antes de eliminar el canal
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Eliminar el canal
    await channel.delete(`Canal privado de reporte #${caseId} cerrado por ${closer.tag}`);

    logger.info(
      `Canal privado de reporte ${channel.id} (caso #${caseId}) cerrado por ${closer.tag} en el servidor ${channel.guild.id}.`
    );
  } catch (error) {
    logger.error(`Error al cerrar el canal privado del caso #${caseId}:`, error);
    throw error;
  }
};

