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
  .setDescription("Configures the channel where closed ticket logs will be sent.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel where closed ticket logs will be sent.")
      .addChannelTypes(ChannelType.GuildText)
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

  const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);

  if (!channel) {
    await interaction.reply({
      content: "You must select a valid channel.",
      ephemeral: true
    });
    return;
  }

  try {
    await configurationService.setTicketConfig(interaction.guildId, {
      logChannelId: channel.id
    });

    const embed = createBaseEmbed({
      title: "✅ Ticket Logs Configured",
      description: `Closed ticket logs will be sent to ${channel}.`,
      footerText: `Channel ID: ${channel.id}`
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    const { logger } = await import("../../utils/logger.js");
    logger.error("Error configuring the ticket logs channel:", error);
    await interaction.reply({
      content: "An error occurred while configuring the ticket logs channel. Please try again.",
      ephemeral: true
    });
  }
};

export default {
  data: builder,
  execute,
  access: "staff"
} satisfies Command;

