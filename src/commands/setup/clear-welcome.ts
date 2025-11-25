import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import { configurationService } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";

const builder = new SlashCommandBuilder()
  .setName("clear-welcome")
  .setDescription("Disable the welcome system and remove the current configuration.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existingConfig = await configurationService.getWelcomeConfig(interaction.guildId);

  if (!existingConfig) {
    await interaction.editReply({
      content: "There is no active welcome configuration on this server.",
    });
    return;
  }

  await configurationService.clearWelcomeConfig(interaction.guildId);

  await interaction.editReply({
    content: "The welcome configuration has been removed. No more automatic messages will be sent."
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

