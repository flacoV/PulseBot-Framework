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
  .setDescription("Desactiva el sistema de bienvenida y elimina la configuración actual.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existingConfig = await configurationService.getWelcomeConfig(interaction.guildId);

  if (!existingConfig) {
    await interaction.editReply({
      content: "No hay una configuración de bienvenida activa en este servidor.",
    });
    return;
  }

  await configurationService.clearWelcomeConfig(interaction.guildId);

  await interaction.editReply({
    content: "La configuración de bienvenida se ha eliminado. No se enviarán más mensajes automáticos."
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

