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

const builder = new SlashCommandBuilder()
  .setName("setup-moderation-logs")
  .setDescription("Configures the channel where all moderation actions will be registered.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel where moderation logs will be sent.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ flags: "Ephemeral" });

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

  await configurationService.setModerationConfig(interaction.guildId, { logChannelId: channel.id });

  const embed = createBaseEmbed({
    title: "Moderation Logs Configured",
    description: `The channel ${channel} will now receive all moderation logs.`,
    footerText: "The actions of warn, mute, kick and ban will be registered here."
  }).addFields({
    name: "Channel",
    value: `${channel} (${channel.id})`
  });

  await interaction.editReply({
    content: "Configuration saved successfully.",
    embeds: [embed]
  });
};

const command: Command = {
  data: builder,
  execute,
  guildOnly: true,
  requiredPermissions: [PermissionFlagsBits.ManageGuild],
  access: "staff"
};

export default command;

