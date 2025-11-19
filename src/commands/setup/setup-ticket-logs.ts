import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import { configurationService } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { ensureStaffAccess } from "../../utils/accessControl.js";

const builder = new SlashCommandBuilder()
  .setName("setup-ticket-logs")
  .setDescription("Configura el canal donde se enviarán los logs de tickets cerrados.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("canal")
      .setDescription("Canal donde se enviarán los logs de tickets cerrados.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!(await ensureStaffAccess(interaction))) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  const channel = interaction.options.getChannel("canal", true, [ChannelType.GuildText]);

  if (!channel) {
    await interaction.reply({
      content: "Debes seleccionar un canal válido.",
      ephemeral: true
    });
    return;
  }

  try {
    await configurationService.setTicketConfig(interaction.guildId, {
      logChannelId: channel.id
    });

    const embed = createBaseEmbed({
      title: "✅ Canal de Logs de Tickets Configurado",
      description: `Los logs de tickets cerrados se enviarán a ${channel}.`,
      footerText: `Canal ID: ${channel.id}`
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    const { logger } = await import("../../utils/logger.js");
    logger.error("Error al configurar el canal de logs de tickets:", error);
    await interaction.reply({
      content: "Ocurrió un error al configurar el canal. Por favor, intenta nuevamente.",
      ephemeral: true
    });
  }
};

export default {
  data: builder,
  execute,
  access: "staff"
} satisfies Command;

