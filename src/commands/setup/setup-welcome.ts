import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import { configurationService, type WelcomeConfig } from "../../services/configurationService.js";
import type { Command } from "../../types/Command.js";
import { createWelcomeEmbed } from "../../utils/embedBuilder.js";
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
  .setDescription("Configure the server welcome system.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel where the welcome messages will be sent.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addRoleOption((option) =>
    option
      .setName("role")
      .setDescription("Optional role to assign automatically to new members.")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("message")
      .setDescription(
        "Welcome message. Placeholders: {{user}}, {{userMention}}, {{guildName}}."
      )
      .setMaxLength(500)
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      ephemeral: true
    });
    return;
  }

  const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
  const role = interaction.options.getRole("role");
  const message = interaction.options.getString("message") ?? undefined;
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
    interaction.guild?.name ?? "your server",
    resolvePreviewDisplayName(interaction)
  );

  const previewEmbed = createWelcomeEmbed({
    userAvatarUrl: interaction.user.displayAvatarURL({ size: 512 }),
    description: renderWelcomeTemplate(template, previewContext),
    guildName: previewContext.guildName,
    ...(interaction.guild?.memberCount && { memberCount: interaction.guild.memberCount })
  });

  const channelMention = `<#${channel.id}>`;
  const roleMention = role ? `<@&${role.id}>` : null;

  await interaction.reply({
    content: `Configuration updated. Welcome messages will be sent in ${channelMention}${
      roleMention ? ` and the role ${roleMention}` : ""
    }.`,
    embeds: [previewEmbed],
    ephemeral: true
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

