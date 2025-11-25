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
  .setDescription("Configures the channel where user report logs will be sent.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel where user report logs will be sent.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  try {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: "This command can only be executed within a server.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const selectedChannel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);

    const channel = (await interaction.guild.channels
      .fetch(selectedChannel.id)
      .catch(() => null)) as TextChannel | null;

    if (!channel) {
      await interaction.editReply({
        content: "I was unable to find that channel. Try again.",
        embeds: []
      });
      return;
    }

    // Verify bot permissions in the channel
    const me = await interaction.guild.members.fetchMe();
    const botPermissions = channel.permissionsFor(me);

    if (!botPermissions?.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
      await interaction.editReply({
        content:
          "The bot does not have sufficient permissions in that channel. It needs: View Channel, Send Messages and Send Embeds.",
        embeds: []
      });
      return;
    }

    await configurationService.setModerationConfig(interaction.guildId, {
      reportLogChannelId: channel.id
    });

    const embed = createBaseEmbed({
      title: "Report Logs Configured",
      description: `The channel ${channel} will now receive all user report logs.`,
      footerText: "Reports will be sent here with all the information about the reporter and reported."
    }).addFields({
      name: "Channel",
      value: `${channel} (${channel.id})`
    });

    await interaction.editReply({
      content: "Configuration saved successfully.",
      embeds: [embed]
    });
  } catch (error) {
    logger.error("Error in setup-report-logs:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "An error occurred while configuring the report logs channel. Please try again.",
          embeds: []
        });
      } else {
        await interaction.reply({
          content: "An error occurred while configuring the report logs channel. Please try again.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error("Error sending error message in setup-report-logs:", replyError);
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

