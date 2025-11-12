import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import { configurationService, type WelcomeConfig } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";

const builder = new SlashCommandBuilder()
  .setName("setup-welcome")
  .setDescription("Configura el sistema de bienvenida del servidor.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("canal")
      .setDescription("Canal donde se publicarán las bienvenidas.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addRoleOption((option) =>
    option
      .setName("rol")
      .setDescription("Rol opcional para asignar automáticamente a nuevos miembros.")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("mensaje")
      .setDescription(
        "Mensaje de bienvenida (usa {{user}} y {{guild}} como placeholders). Máximo 500 caracteres."
      )
      .setMaxLength(500)
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  const channel = interaction.options.getChannel("canal", true, [ChannelType.GuildText]);
  const role = interaction.options.getRole("rol");
  const message = interaction.options.getString("mensaje") ?? undefined;

  const welcomeConfig: WelcomeConfig = {
    channelId: channel.id
  };

  if (role) {
    welcomeConfig.roleId = role.id;
  }

  if (message) {
    welcomeConfig.message = message;
  }

  await configurationService.setWelcomeConfig(interaction.guildId, welcomeConfig);

  const previewEmbed = createBaseEmbed({
    title: "Vista previa de bienvenida",
    description:
      message ??
      "¡Bienvenid@ {{user}}! Échale un vistazo a las reglas y disfruta tu estancia en {{guild}}.",
    footerText: "Los placeholders {{user}} y {{guild}} se reemplazarán automáticamente."
  });

  const channelMention = `<#${channel.id}>`;
  const roleMention = role ? `<@&${role.id}>` : null;

  await interaction.reply({
    content: `Configuración actualizada. Las bienvenidas se enviarán en ${channelMention}${
      roleMention ? ` y se asignará el rol ${roleMention}` : ""
    }.`,
    embeds: [previewEmbed],
    ephemeral: true
  });
};

const command: Command = {
  data: builder,
  execute,
  guildOnly: true,
  requiredPermissions: [PermissionFlagsBits.ManageGuild]
};

export default command;

