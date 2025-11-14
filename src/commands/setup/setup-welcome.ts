import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import { configurationService, type WelcomeConfig } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import {
  DEFAULT_WELCOME_TEMPLATE,
  createPreviewContext,
  renderWelcomeTemplate
} from "../../utils/welcomePlaceholders.js";

const resolvePreviewDisplayName = (interaction: ChatInputCommandInteraction) => {
  const member = interaction.member;
  if (!member) return interaction.user.globalName ?? interaction.user.username;

  if ("displayName" in member && typeof member.displayName === "string") {
    return member.displayName;
  }

  if ("nickname" in member && typeof member.nickname === "string" && member.nickname) {
    return member.nickname;
  }

  return interaction.user.globalName ?? interaction.user.username;
};

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
        "Mensaje de bienvenida. Placeholders: {{user}}, {{userMention}}, {{guildName}}."
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
  const template = message ?? DEFAULT_WELCOME_TEMPLATE;

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

  const previewContext = createPreviewContext(
    interaction.user,
    interaction.guild?.name ?? "tu servidor",
    resolvePreviewDisplayName(interaction)
  );

  const previewEmbed = createBaseEmbed({
    title: "Vista previa de bienvenida",
    description: renderWelcomeTemplate(template, previewContext),
    footerText:
      "Placeholders disponibles: {{user}}, {{userMention}}, {{userName}}, {{userDisplayName}}, {{userTag}}, {{guild}}, {{guildName}}, {{serverName}}."
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

