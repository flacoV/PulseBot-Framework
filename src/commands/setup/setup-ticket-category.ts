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
  .setName("setup-ticket-category")
  .setDescription("Configura la categoría donde se crearán los tickets.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("categoria")
      .setDescription("Categoría donde se crearán los tickets.")
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
    await configurationService.setTicketConfig(interaction.guildId, {
      categoryId: category.id
    });

    const embed = createBaseEmbed({
      title: "✅ Categoría de Tickets Configurada",
      description: `Los tickets se crearán en la categoría **${category.name}**.`,
      footerText: `Categoría ID: ${category.id}`
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    const { logger } = await import("../../utils/logger.js");
    logger.error("Error al configurar la categoría de tickets:", error);
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

