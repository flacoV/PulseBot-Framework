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
  .setDescription("Configures the category where tickets will be created.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("category")
      .setDescription("Category where tickets will be created.")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!(await ensureStaffAccess(interaction))) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      ephemeral: true
    });
    return;
  }

  const category = interaction.options.getChannel("category", true, [ChannelType.GuildCategory]);

  if (!category) {
    await interaction.reply({
      content: "You must select a valid category.",
      ephemeral: true
    });
    return;
  }

  try {
    await configurationService.setTicketConfig(interaction.guildId, {
      categoryId: category.id
    });

    const embed = createBaseEmbed({
      title: "✅ Ticket Category Configured",
      description: `Tickets will be created in the category **${category.name}**.`,
      footerText: `Category ID: ${category.id}`
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    const { logger } = await import("../../utils/logger.js");
    logger.error("Error configuring the ticket category:", error);
    await interaction.reply({
      content: "An error occurred while configuring the category. Please try again.",
      ephemeral: true
    });
  }
};

export default {
  data: builder,
  execute,
  access: "staff"
} satisfies Command;

