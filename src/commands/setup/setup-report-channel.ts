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

const builder = new SlashCommandBuilder()
  .setName("setup-report-channel")
  .setDescription("Configura el canal donde los usuarios pueden reportar a otros miembros.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("canal")
      .setDescription("Canal donde se publicará el embed de reportes.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("titulo")
      .setDescription("Título del embed de reportes (opcional).")
      .setMaxLength(256)
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("descripcion")
      .setDescription("Descripción del embed de reportes (opcional).")
      .setMaxLength(2000)
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  try {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: "Este comando solo puede ejecutarse dentro de un servidor.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

  const selectedChannel = interaction.options.getChannel("canal", true, [ChannelType.GuildText]);
  const title = interaction.options.getString("titulo") ?? "📢 Sistema de Reportes";
  const description =
    interaction.options.getString("descripcion") ??
    "Si encuentras a un miembro que está violando las reglas del servidor, puedes reportarlo usando el botón de abajo.\n\n**¿Qué hacer?**\n1. Haz clic en el botón \"Reportar Usuario\"\n2. Completa el formulario con la información solicitada\n3. El equipo de moderación revisará tu reporte";

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

  // Verificar permisos del bot en el canal
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

  // Crear el embed con el botón
  const embed = createBaseEmbed({
    title,
    description,
    color: 0xff4444 // Rojo para reportes
  }).addFields({
    name: "⚠️ Importante",
    value: "Solo reporta comportamientos que violen las reglas del servidor. Los reportes falsos pueden resultar en acciones disciplinarias."
  });

  const button = new ButtonBuilder()
    .setCustomId("report_user_button")
    .setLabel("Reportar Usuario")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("🚨");

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  // Intentar actualizar el mensaje existente si existe
  const moderationConfig = await configurationService.getModerationConfig(interaction.guildId);
  if (moderationConfig?.reportMessageId && moderationConfig?.reportChannelId === channel.id) {
    try {
      const existingMessage = await channel.messages.fetch(moderationConfig.reportMessageId);
      await existingMessage.edit({
        embeds: [embed],
        components: [actionRow]
      });

      await interaction.editReply({
        content: `El embed de reportes ha sido actualizado en ${channel}.`,
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
  await configurationService.setModerationConfig(interaction.guildId, {
    reportChannelId: channel.id,
    reportMessageId: message.id
  });

  const successEmbed = createBaseEmbed({
    title: "Canal de Reportes Configurado",
    description: `El sistema de reportes ha sido configurado en ${channel}.`,
    footerText: "Los usuarios podrán reportar miembros usando el botón del embed."
  }).addFields({
    name: "Canal",
    value: `${channel} (${channel.id})`
  });

    await interaction.editReply({
      content: "Configuración guardada correctamente.",
      embeds: [successEmbed]
    });
  } catch (error) {
    logger.error("Error en setup-report-channel:", error);
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "Ocurrió un error al configurar el canal de reportes. Por favor, intenta nuevamente.",
          embeds: []
        });
      } else {
        await interaction.reply({
          content: "Ocurrió un error al configurar el canal de reportes. Por favor, intenta nuevamente.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error("Error al enviar mensaje de error en setup-report-channel:", replyError);
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

