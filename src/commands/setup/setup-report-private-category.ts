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
  .setName("setup-report-private-category")
  .setDescription("Configura la categoría donde se crearán los canales privados de reportes.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("categoria")
      .setDescription("Categoría donde se crearán los canales privados de reportes.")
      .addChannelTypes(ChannelType.GuildCategory)
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

  const category = interaction.options.getChannel("categoria", true, [ChannelType.GuildCategory]);

  if (!category) {
    await interaction.reply({
      content: "Debes seleccionar una categoría válida.",
      ephemeral: true
    });
    return;
  }

  try {
    await configurationService.setModerationConfig(interaction.guildId, {
      reportPrivateChannelCategoryId: category.id
    });

    const embed = createBaseEmbed({
      title: "✅ Categoría de Canales Privados Configurada",
      description: `Los canales privados de reportes se crearán en la categoría **${category.name}**.`,
      footerText: `Categoría ID: ${category.id}`
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    const { logger } = await import("../../utils/logger.js");
    logger.error("Error al configurar la categoría de canales privados:", error);
    await interaction.reply({
      content: "Ocurrió un error al configurar la categoría. Por favor, intenta nuevamente.",
      ephemeral: true
    });
  }
};

export default {
  data: builder,
  execute,
  access: "staff"
} satisfies Command;

