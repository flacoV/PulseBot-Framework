import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Colors,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type CategoryChannel,
  type Guild,
  type Message,
  type TextChannel
} from "discord.js";

import { configurationService } from "../services/configurationService.js";
import { createBaseEmbed } from "./embedBuilder.js";
import { logger } from "./logger.js";
import { getEnvVarList } from "./env.js";

export type TicketCategory = "general" | "support" | "reports" | "other";

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  general: "General",
  support: "Soporte",
  reports: "Reportes",
  other: "Otros"
};

const CATEGORY_EMOJIS: Record<TicketCategory, string> = {
  general: "📋",
  support: "🔧",
  reports: "📢",
  other: "💬"
};

const CATEGORY_COLORS: Record<TicketCategory, number> = {
  general: 0x5865f2,
  support: 0x00d9ff,
  reports: 0xff4444,
  other: 0x95a5a6
};

/**
 * Obtiene los IDs de los roles de staff configurados.
 */
const getStaffRoleIds = (): Set<string> => {
  return new Set(getEnvVarList("STAFF_ROLE_IDS"));
};

/**
 * Crea un ticket (canal privado) para un usuario.
 */
export const createTicket = async (
  guild: Guild,
  userId: string,
  category: TicketCategory
): Promise<TextChannel | null> => {
  try {
    // Obtener la categoría configurada
    const ticketConfig = await configurationService.getTicketConfig(guild.id);
    const categoryId = ticketConfig?.categoryId;

    if (!categoryId) {
      logger.warn(`No hay categoría configurada para tickets en el servidor ${guild.id}.`);
      return null;
    }

    // Obtener la categoría
    const categoryChannel = (await guild.channels.fetch(categoryId).catch(() => null)) as
      | CategoryChannel
      | null;

    if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
      logger.warn(
        `La categoría de tickets (${categoryId}) no existe o no es válida en el servidor ${guild.id}.`
      );
      return null;
    }

    // Verificar permisos del bot
    const me = await guild.members.fetchMe();
    const botPermissions = categoryChannel.permissionsFor(me);

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

    // Obtener usuario
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user) {
      logger.warn(`No se pudo obtener el usuario ${userId} para crear el ticket.`);
      return null;
    }

    // Verificar si el usuario ya tiene un ticket abierto
    const existingTickets = categoryChannel.children.cache.filter(
      (ch) => ch.type === ChannelType.GuildText && ch.name.startsWith(`ticket-${user.username.toLowerCase()}`)
    );

    if (existingTickets.size > 0) {
      // Ya tiene un ticket abierto
      return existingTickets.first() as TextChannel | null;
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
      // Permitir acceso al usuario que creó el ticket
      {
        id: userId,
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
    }

    // Crear el canal
    const channelName = `ticket-${user.username.toLowerCase()}`.slice(0, 100); // Discord limita a 100 caracteres
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites,
      topic: `Ticket de ${CATEGORY_LABELS[category]} - Creado por ${user.tag}`
    });

    logger.info(
      `Ticket creado: ${channel.id} para el usuario ${user.tag} (${userId}) en el servidor ${guild.id}.`
    );

    return channel;
  } catch (error) {
    logger.error(`Error al crear ticket para el usuario ${userId}:`, error);
    return null;
  }
};

/**
 * Envía el mensaje inicial del ticket con los botones de acción.
 */
export const sendTicketInitialMessage = async (
  channel: TextChannel,
  userId: string,
  category: TicketCategory
): Promise<Message | null> => {
  try {
    const user = await channel.client.users.fetch(userId).catch(() => null);
    if (!user) {
      logger.warn(`No se pudo obtener el usuario ${userId} para el mensaje inicial del ticket.`);
      return null;
    }

    const embed = createBaseEmbed({
      title: `${CATEGORY_EMOJIS[category]} Ticket - ${CATEGORY_LABELS[category]}`,
      description: `Bienvenido a tu ticket de ${CATEGORY_LABELS[category].toLowerCase()}. Un miembro del staff te ayudará pronto.\n\n**Información del ticket:**`,
      color: CATEGORY_COLORS[category],
      footerText: `Creado por ${user.tag}`
    })
      .addFields(
        {
          name: "Usuario",
          value: `<@${userId}> (${user.tag})`,
          inline: true
        },
        {
          name: "Categoría",
          value: `${CATEGORY_EMOJIS[category]} ${CATEGORY_LABELS[category]}`,
          inline: true
        },
        {
          name: "Estado",
          value: "⏳ Esperando staff",
          inline: true
        }
      )
      .setTimestamp();

    // Crear botones
    const takeTicketButton = new ButtonBuilder()
      .setCustomId(`ticket_take_${channel.id}`)
      .setLabel("Tomar Ticket")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("✋");

    const closeTicketButton = new ButtonBuilder()
      .setCustomId(`ticket_close_${channel.id}`)
      .setLabel("Cerrar Ticket")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔒");

    const transcriptButton = new ButtonBuilder()
      .setCustomId(`ticket_transcript_${channel.id}`)
      .setLabel("Guardar Transcript")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💾");

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      takeTicketButton,
      closeTicketButton,
      transcriptButton
    );

    const message = await channel.send({
      content: `<@${userId}>`,
      embeds: [embed],
      components: [actionRow]
    });

    return message;
  } catch (error) {
    logger.error(`Error al enviar mensaje inicial del ticket en ${channel.id}:`, error);
    return null;
  }
};

/**
 * Actualiza el embed del ticket para mostrar que fue tomado por un staff.
 */
export const updateTicketEmbedTaken = async (
  message: Message,
  staffUser: { id: string; tag: string }
): Promise<void> => {
  try {
    const embed = message.embeds[0];
    if (!embed) return;

    const updatedEmbed = createBaseEmbed({
      title: embed.title || "Ticket",
      description: embed.description || "",
      color: embed.color || 0x5865f2,
      ...(embed.footer?.text && { footerText: embed.footer.text })
    });

    // Copiar todos los campos existentes
    if (embed.fields) {
      for (const field of embed.fields) {
        if (field.name !== "Estado") {
          updatedEmbed.addFields(field);
        }
      }
    }

    // Actualizar campo de estado
    updatedEmbed.addFields({
      name: "Estado",
      value: `✅ Atendido por <@${staffUser.id}> (${staffUser.tag})`,
      inline: true
    });

    // Actualizar el mensaje (mantener los botones)
    await message.edit({ embeds: [updatedEmbed] });
  } catch (error) {
    logger.error("Error al actualizar embed del ticket:", error);
  }
};

/**
 * Crea el modal para cerrar un ticket con motivo.
 */
export const createCloseTicketModal = (channelId: string) => {
  const modal = new ModalBuilder()
    .setCustomId(`close_ticket_modal_${channelId}`)
    .setTitle("Cerrar Ticket");

  const reasonInput = new TextInputBuilder()
    .setCustomId("close_reason")
    .setLabel("Motivo del Cierre")
    .setPlaceholder("Describe el motivo por el cual se cierra este ticket...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(500);

  const reasonRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);

  modal.addComponents(reasonRow);

  return modal;
};

/**
 * Cierra un ticket y envía el log al canal configurado.
 */
export const closeTicket = async (
  channel: TextChannel,
  closer: { id: string; tag: string },
  reason?: string
): Promise<void> => {
  try {
    const guild = channel.guild;
    const ticketConfig = await configurationService.getTicketConfig(guild.id);

    // Obtener información del ticket desde el embed inicial
    // Buscar el mensaje inicial que tiene el embed con la información del ticket
    const messages = await channel.messages.fetch({ limit: 50 });
    let userId: string | null = null;
    let category: TicketCategory = "general";

    // Buscar el mensaje inicial del ticket (el que tiene el embed con los botones)
    const initialMessage = messages.find((m) => m.embeds.length > 0 && m.components.length > 0);

    if (initialMessage?.embeds[0]) {
      const embed = initialMessage.embeds[0];
      const userField = embed.fields?.find((f) => f.name === "Usuario");
      if (userField?.value) {
        const match = userField.value.match(/<@(\d+)>/);
        if (match && match[1]) {
          userId = match[1];
        }
      }

      const categoryField = embed.fields?.find((f) => f.name === "Categoría");
      if (categoryField?.value) {
        if (categoryField.value.includes("General")) category = "general";
        else if (categoryField.value.includes("Soporte")) category = "support";
        else if (categoryField.value.includes("Reportes")) category = "reports";
        else if (categoryField.value.includes("Otros")) category = "other";
      }
    }

    // Si no se encontró el userId en el embed, intentar obtenerlo del nombre del canal
    // El formato es ticket-{username}, pero mejor intentar obtenerlo del primer mensaje
    if (!userId) {
      // Buscar el primer mensaje del bot que menciona al usuario
      const botMessages = messages.filter((m) => m.author.id === channel.client.user?.id);
      for (const msg of botMessages.values()) {
        if (msg.content && msg.content.includes("<@")) {
          const match = msg.content.match(/<@(\d+)>/);
          if (match && match[1]) {
            userId = match[1];
            break;
          }
        }
      }
    }

    // Enviar mensaje de cierre
    const closeEmbed = createBaseEmbed({
      title: "🔒 Ticket Cerrado",
      description: `Este ticket ha sido cerrado por <@${closer.id}> (${closer.tag}).`,
      color: Colors.Red,
      footerText: `Cerrado por ${closer.tag}`
    });

    if (reason) {
      closeEmbed.addFields({
        name: "Motivo del Cierre",
        value: reason
      });
    }

    closeEmbed.setTimestamp();

    await channel.send({ embeds: [closeEmbed] });

    // Esperar un momento antes de eliminar el canal
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Enviar log si está configurado
    if (ticketConfig?.logChannelId) {
      const logChannel = (await guild.channels
        .fetch(ticketConfig.logChannelId)
        .catch(() => null)) as TextChannel | null;

      if (logChannel && logChannel.isTextBased() && !logChannel.isDMBased()) {
        const logEmbed = createBaseEmbed({
          title: "📋 Ticket Cerrado",
          description: `Se cerró un ticket en ${channel.name}`,
          color: Colors.Orange,
          footerText: `Canal ID: ${channel.id}`
        })
          .addFields(
            {
              name: "Usuario",
              value: userId ? `<@${userId}>` : "Desconocido",
              inline: true
            },
            {
              name: "Categoría",
              value: `${CATEGORY_EMOJIS[category]} ${CATEGORY_LABELS[category]}`,
              inline: true
            },
            {
              name: "Cerrado por",
              value: `<@${closer.id}> (${closer.tag})`,
              inline: true
            },
            {
              name: "Fecha de cierre",
              value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
              inline: false
            },
            ...(reason
              ? [
                  {
                    name: "Motivo del Cierre",
                    value: reason,
                    inline: false
                  }
                ]
              : [])
          )
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] }).catch((error) => {
          logger.warn(`No se pudo enviar log de ticket cerrado:`, error);
        });
      }
    }

    // Eliminar el canal
    await channel.delete(`Ticket cerrado por ${closer.tag}`);

    logger.info(
      `Ticket ${channel.id} cerrado por ${closer.tag} en el servidor ${guild.id}.`
    );
  } catch (error) {
    logger.error(`Error al cerrar el ticket ${channel.id}:`, error);
    throw error;
  }
};

/**
 * Genera y guarda el transcript de un ticket.
 */
export const generateTranscript = async (
  channel: TextChannel,
  requester: { id: string; tag: string }
): Promise<void> => {
  try {
    const guild = channel.guild;
    const ticketConfig = await configurationService.getTicketConfig(guild.id);

    if (!ticketConfig?.transcriptChannelId) {
      throw new Error("No hay canal de transcripts configurado.");
    }

    const transcriptChannel = (await guild.channels
      .fetch(ticketConfig.transcriptChannelId)
      .catch(() => null)) as TextChannel | null;

    if (!transcriptChannel || !transcriptChannel.isTextBased() || transcriptChannel.isDMBased()) {
      throw new Error("El canal de transcripts no es válido.");
    }

    // Obtener todos los mensajes del ticket
    const messages: Message[] = [];
    let lastMessageId: string | undefined;

    while (true) {
      const fetched = await channel.messages.fetch({
        limit: 100,
        ...(lastMessageId && { before: lastMessageId })
      });

      if (fetched.size === 0) break;

      messages.push(...Array.from(fetched.values()));
      lastMessageId = fetched.last()?.id;

      if (fetched.size < 100) break;
    }

    // Ordenar mensajes por fecha (más antiguo primero)
    messages.reverse();

    // Obtener información del ticket
    let userId: string | null = null;
    let category: TicketCategory = "general";
    const initialMessage = messages.find((m) => m.embeds.length > 0);
    if (initialMessage?.embeds[0]) {
      const embed = initialMessage.embeds[0];
      const userField = embed.fields?.find((f) => f.name === "Usuario");
      if (userField?.value) {
        const match = userField.value.match(/<@(\d+)>/);
        if (match && match[1]) userId = match[1];
      }

      const categoryField = embed.fields?.find((f) => f.name === "Categoría");
      if (categoryField?.value) {
        if (categoryField.value.includes("General")) category = "general";
        else if (categoryField.value.includes("Soporte")) category = "support";
        else if (categoryField.value.includes("Reportes")) category = "reports";
        else if (categoryField.value.includes("Otros")) category = "other";
      }
    }

    // Generar transcript en formato texto
    const transcriptLines: string[] = [];
    transcriptLines.push("=".repeat(50));
    transcriptLines.push(`TRANSCRIPT DEL TICKET`);
    transcriptLines.push("=".repeat(50));
    transcriptLines.push(`Canal: ${channel.name} (${channel.id})`);
    transcriptLines.push(`Categoría: ${CATEGORY_LABELS[category]}`);
    transcriptLines.push(`Usuario: ${userId ? `<@${userId}>` : "Desconocido"}`);
    transcriptLines.push(`Generado por: ${requester.tag} (${requester.id})`);
    transcriptLines.push(`Fecha: ${new Date().toISOString()}`);
    transcriptLines.push("=".repeat(50));
    transcriptLines.push("");

    for (const message of messages) {
      const timestamp = new Date(message.createdTimestamp).toISOString();
      const author = message.author.tag;
      const content = message.content || "*[Sin contenido]*";

      transcriptLines.push(`[${timestamp}] ${author}: ${content}`);

      // Añadir embeds si existen
      if (message.embeds.length > 0) {
        for (const embed of message.embeds) {
          transcriptLines.push(`  [EMBED] ${embed.title || "Sin título"}`);
          if (embed.description) {
            transcriptLines.push(`  ${embed.description}`);
          }
        }
      }

      // Añadir attachments si existen
      if (message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
          transcriptLines.push(`  [ATTACHMENT] ${attachment.url}`);
        }
      }

      transcriptLines.push("");
    }

    transcriptLines.push("=".repeat(50));
    transcriptLines.push("FIN DEL TRANSCRIPT");
    transcriptLines.push("=".repeat(50));

    const transcriptText = transcriptLines.join("\n");

    // Crear embed para el transcript
    const transcriptEmbed = createBaseEmbed({
      title: "💾 Transcript del Ticket",
      description: `Transcript generado para el ticket ${channel.name}`,
      color: 0x5865f2,
      footerText: `Generado por ${requester.tag}`
    })
      .addFields(
        {
          name: "Canal",
          value: `${channel.name} (${channel.id})`,
          inline: true
        },
        {
          name: "Categoría",
          value: `${CATEGORY_EMOJIS[category]} ${CATEGORY_LABELS[category]}`,
          inline: true
        },
        {
          name: "Usuario",
          value: userId ? `<@${userId}>` : "Desconocido",
          inline: true
        },
        {
          name: "Total de mensajes",
          value: `${messages.length}`,
          inline: true
        },
        {
          name: "Generado por",
          value: `<@${requester.id}> (${requester.tag})`,
          inline: true
        }
      )
      .setTimestamp();

    // Enviar embed primero (sin el transcript, ya que puede ser muy largo)
    await transcriptChannel.send({ embeds: [transcriptEmbed] });

    // Enviar transcript en partes (Discord tiene límite de 2000 caracteres por mensaje)
    const maxLength = 1900; // Dejar margen para los backticks y formato
    const transcriptWithCode = `\`\`\`\n${transcriptText}\n\`\`\``;

    if (transcriptWithCode.length <= maxLength) {
      // Si cabe en un solo mensaje, enviarlo directamente
      await transcriptChannel.send({
        content: transcriptWithCode
      });
    } else {
      // Dividir el transcript en partes
      const parts: string[] = [];
      let currentPart = "";
      const lines = transcriptText.split("\n");

      for (const line of lines) {
        const lineWithNewline = currentPart ? `\n${line}` : line;
        if (currentPart.length + lineWithNewline.length + 10 > maxLength) {
          // +10 para los backticks y formato
          if (currentPart) {
            parts.push(`\`\`\`\n${currentPart}\n\`\`\``);
          }
          currentPart = line;
        } else {
          currentPart += lineWithNewline;
        }
      }
      if (currentPart) {
        parts.push(`\`\`\`\n${currentPart}\n\`\`\``);
      }

      // Enviar cada parte
      for (const part of parts) {
        if (part) {
          await transcriptChannel.send({
            content: part
          });
        }
      }
    }

    logger.info(
      `Transcript generado para el ticket ${channel.id} por ${requester.tag} en el servidor ${guild.id}.`
    );
  } catch (error) {
    logger.error(`Error al generar transcript del ticket ${channel.id}:`, error);
    throw error;
  }
};


