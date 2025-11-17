import {
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
  .setName("setup-report-logs")
  .setDescription("Configura el canal donde se enviarán los logs de reportes de usuarios.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("canal")
      .setDescription("Canal donde se enviarán los logs de reportes.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
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

    if (!botPermissions?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      await interaction.editReply({
        content:
          "El bot no tiene permisos suficientes en ese canal. Necesita: Ver Canal, Enviar Mensajes y Enviar Embeds.",
        embeds: []
      });
      return;
    }

    await configurationService.setModerationConfig(interaction.guildId, {
      reportLogChannelId: channel.id
    });

    const embed = createBaseEmbed({
      title: "Canal de Logs de Reportes Configurado",
      description: `El canal ${channel} ahora recibirá todos los reportes de usuarios.`,
      footerText: "Los reportes se enviarán aquí con toda la información del reportante y reportado."
    }).addFields({
      name: "Canal",
      value: `${channel} (${channel.id})`
    });

    await interaction.editReply({
      content: "Configuración guardada correctamente.",
      embeds: [embed]
    });
  } catch (error) {
    logger.error("Error en setup-report-logs:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "Ocurrió un error al configurar el canal de logs de reportes. Por favor, intenta nuevamente.",
          embeds: []
        });
      } else {
        await interaction.reply({
          content: "Ocurrió un error al configurar el canal de logs de reportes. Por favor, intenta nuevamente.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error("Error al enviar mensaje de error en setup-report-logs:", replyError);
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

