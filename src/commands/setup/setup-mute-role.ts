import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Role
} from "discord.js";

import { configurationService } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";

const builder = new SlashCommandBuilder()
  .setName("setup-mute-role")
  .setDescription("Defines the role that will be used to mute members.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addRoleOption((option) =>
    option.setName("role").setDescription("Role that will be used to mute members.").setRequired(true)
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

  const selectedRole = interaction.options.getRole("role", true);
  const role =
    interaction.guild.roles.cache.get(selectedRole.id) ??
    ((await interaction.guild.roles.fetch(selectedRole.id).catch(() => null)) as Role | null);

  if (!role) {
    await interaction.editReply({
      content: "I was unable to find that role in the server's cache. Try again.",
      embeds: []
    });
    return;
  }

  const me = await interaction.guild.members.fetchMe();

  if (role.managed) {
    await interaction.reply({
      content: "You cannot select a role managed by an integration.",
      ephemeral: true
    });
    return;
  }

  if (!role.editable || role.position >= me.roles.highest.position) {
    await interaction.editReply({
      content: "You cannot manage that role. Make sure it is below the bot's role.",
      embeds: []
    });
    return;
  }

  await configurationService.setModerationConfig(interaction.guildId, { muteRoleId: role.id });

  await interaction.editReply({
    content: `The role ${role} will be used to apply mutes.`,
    embeds: []
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



