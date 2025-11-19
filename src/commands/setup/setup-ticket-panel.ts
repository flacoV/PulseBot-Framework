import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel
} from "discord.js";

import { configurationService } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { logger } from "../../utils/logger.js";
import { ensureStaffAccess } from "../../utils/accessControl.js";

const builder = new SlashCommandBuilder()
  .setName("setup-ticket-panel")
  .setDescription("Configura el panel de tickets con 4 categorías.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("canal")
      .setDescription("Canal donde se publicará el panel de tickets.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("titulo")
      .setDescription("Título del embed del panel (opcional).")
      .setMaxLength(256)
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("descripcion")
      .setDescription("Descripción del embed del panel (opcional).")
      .setMaxLength(2000)
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  try {
    if (!(await ensureStaffAccess(interaction))) {
      return;
    }

    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo puede ejecutarse dentro de un servidor.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const selectedChannel = interaction.options.getChannel("canal", true, [ChannelType.GuildText]);
    const title = interaction.options.getString("titulo") ?? "🎫 Sistema de Tickets";
    const description =
      interaction.options.getString("descripcion") ??
      "¿Necesitas ayuda? Abre un ticket seleccionando la categoría que mejor se ajuste a tu consulta.\n\n**Categorías disponibles:**\n• **General** - Consultas generales y preguntas\n• **Soporte** - Problemas técnicos y asistencia\n• **Reportes** - Reportar problemas o violaciones\n• **Otros** - Otras consultas o solicitudes";

    const channel = (await interaction.guild.channels
      .fetch(selectedChannel.id)
      .catch(() => null)) as TextChannel | null;

    if (!channel) {
      await interaction.editReply({
        content: "No pude encontrar ese canal. Intenta nuevamente.",
        embeds: []
      });
      return;
    }

    // Verificar permisos del bot
    const me = await interaction.guild.members.fetchMe();
    const botPermissions = channel.permissionsFor(me);

    if (!botPermissions?.has(["ViewChannel", "SendMessages", "EmbedLinks", "UseExternalEmojis"])) {
      await interaction.editReply({
        content:
          "El bot no tiene permisos suficientes en ese canal. Necesita: Ver Canal, Enviar Mensajes, Enviar Embeds y Usar Emojis Externos.",
        embeds: []
      });
      return;
    }

    // Crear el embed con estilo similar a los demás
    const embed = createBaseEmbed({
      title,
      description,
      color: 0x5865f2 // Color similar a otros embeds
    }).addFields({
      name: "ℹ️ Información",
      value: "Haz clic en el botón correspondiente a tu categoría para abrir un ticket. Un miembro del staff te ayudará lo antes posible."
    });

    // Crear 4 botones para las categorías
    const generalButton = new ButtonBuilder()
      .setCustomId("ticket_open_general")
      .setLabel("General")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📋");

    const supportButton = new ButtonBuilder()
      .setCustomId("ticket_open_support")
      .setLabel("Soporte")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔧");

    const reportsButton = new ButtonBuilder()
      .setCustomId("ticket_open_reports")
      .setLabel("Reportes")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📢");

    const otherButton = new ButtonBuilder()
      .setCustomId("ticket_open_other")
      .setLabel("Otros")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("💬");

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      generalButton,
      supportButton,
      reportsButton,
      otherButton
    );

    // Intentar actualizar el mensaje existente si existe
    const ticketConfig = await configurationService.getTicketConfig(interaction.guildId);
    if (ticketConfig?.panelMessageId && ticketConfig?.panelChannelId === channel.id) {
      try {
        const existingMessage = await channel.messages.fetch(ticketConfig.panelMessageId);
        await existingMessage.edit({
          embeds: [embed],
          components: [actionRow]
        });

        await interaction.editReply({
          content: `El panel de tickets ha sido actualizado en ${channel}.`,
          embeds: []
        });
        return;
      } catch {
        // El mensaje no existe, continuar para crear uno nuevo
      }
    }

    // Enviar nuevo mensaje
    const message = await channel.send({
      embeds: [embed],
      components: [actionRow]
    });

    // Guardar configuración
    await configurationService.setTicketConfig(interaction.guildId, {
      panelChannelId: channel.id,
      panelMessageId: message.id
    });

    const successEmbed = createBaseEmbed({
      title: "Panel de Tickets Configurado",
      description: `El panel de tickets ha sido configurado en ${channel}.`,
      footerText: "Los usuarios podrán abrir tickets usando los botones del embed."
    }).addFields({
      name: "Canal",
      value: `${channel} (${channel.id})`
    });

    await interaction.editReply({
      content: "Configuración guardada correctamente.",
      embeds: [successEmbed]
    });
  } catch (error) {
    logger.error("Error en setup-ticket-panel:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "Ocurrió un error al configurar el panel de tickets. Por favor, intenta nuevamente.",
          embeds: []
        });
      } else {
        await interaction.reply({
          content: "Ocurrió un error al configurar el panel de tickets. Por favor, intenta nuevamente.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error("Error al enviar mensaje de error en setup-ticket-panel:", replyError);
    }
  }
};

const command: Command = {
  data: builder,
  execute,
  guildOnly: true,
  requiredPermissions: [PermissionFlagsBits.ManageGuild],
  access: "staff"
};

export default command;

