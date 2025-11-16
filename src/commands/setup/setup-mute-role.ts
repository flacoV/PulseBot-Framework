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
  .setDescription("Define el rol que se usará para silenciar miembros.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addRoleOption((option) =>
    option.setName("rol").setDescription("Rol que se asignará al silenciar.").setRequired(true)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ flags: "Ephemeral" });

  const selectedRole = interaction.options.getRole("rol", true);
  const role =
    interaction.guild.roles.cache.get(selectedRole.id) ??
    ((await interaction.guild.roles.fetch(selectedRole.id).catch(() => null)) as Role | null);

  if (!role) {
    await interaction.editReply({
      content: "No pude encontrar ese rol en la caché del servidor. Intenta nuevamente.",
      embeds: []
    });
    return;
  }

  const me = await interaction.guild.members.fetchMe();

  if (role.managed) {
    await interaction.reply({
      content: "No puedes seleccionar un rol gestionado por una integración.",
      ephemeral: true
    });
    return;
  }

  if (!role.editable || role.position >= me.roles.highest.position) {
    await interaction.editReply({
      content: "No puedo administrar ese rol. Asegúrate de que esté por debajo del rol del bot.",
      embeds: []
    });
    return;
  }

  await configurationService.setModerationConfig(interaction.guildId, { muteRoleId: role.id });

  await interaction.editReply({
    content: `El rol ${role} se usará para aplicar los mutes.`,
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



