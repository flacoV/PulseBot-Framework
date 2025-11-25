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
  .setName("setup-ticket-transcripts")
  .setDescription("Configure the channel where the ticket transcripts will be saved.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel where the ticket transcripts will be saved.")
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
      transcriptChannelId: channel.id
    });

    const embed = createBaseEmbed({
      title: "✅ Ticket Transcripts Configured",
      description: `The ticket transcripts will be saved in ${channel}.`,
      footerText: `Channel ID: ${channel.id}`
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    const { logger } = await import("../../utils/logger.js");
    logger.error("Error configuring the channel for transcripts:", error);
    await interaction.reply({
      content: "An error occurred while configuring the channel for transcripts. Please try again.",
      ephemeral: true
    });
  }
};

export default {
  data: builder,
  execute,
  access: "staff"
} satisfies Command;

