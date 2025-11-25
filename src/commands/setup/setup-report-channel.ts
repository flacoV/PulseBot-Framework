import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  .setName("setup-report-channel")
  .setDescription("Configures the channel where users can report other members.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel where the report embed will be posted.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("Title of the report embed (optional).")
      .setMaxLength(256)
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("description")
      .setDescription("Description of the report embed (optional).")
      .setMaxLength(2000)
      .setRequired(false)
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
  const title = interaction.options.getString("title") ?? "📢 Report System";
  const description =
    interaction.options.getString("description") ??
    "If you find a member that is violating the server's rules, you can report them using the button below.\n\n**What to do?**\n1. Click the \"Report User\" button\n2. Complete the form with the requested information\n3. The moderation team will review your report";

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

  if (!botPermissions?.has(["ViewChannel", "SendMessages", "EmbedLinks", "UseExternalEmojis"])) {
    await interaction.editReply({
      content:
        "The bot does not have sufficient permissions in that channel. It needs: View Channel, Send Messages, Send Embeds and Use External Emojis.",
      embeds: []
    });
    return;
  }

  // Crear el embed con el botón
  const embed = createBaseEmbed({
    title,
    description,
    color: 0xff4444 // Rojo para reportes
  }).addFields({
    name: "⚠️ Important",
    value: "Only report behaviors that violate the server's rules. False reports can result in disciplinary actions."
  });

  const button = new ButtonBuilder()
    .setCustomId("report_user_button")
    .setLabel("Report User")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("🚨");

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  // Try to update the existing message if it exists
  const moderationConfig = await configurationService.getModerationConfig(interaction.guildId);
  if (moderationConfig?.reportMessageId && moderationConfig?.reportChannelId === channel.id) {
    try {
      const existingMessage = await channel.messages.fetch(moderationConfig.reportMessageId);
      await existingMessage.edit({
        embeds: [embed],
        components: [actionRow]
      });

      await interaction.editReply({
        content: `The report embed has been updated in ${channel}.`,
        embeds: []
      });
      return;
    } catch {
      // El mensaje no existe, continuar para crear uno nuevo
    }
  }

  // Enviar nuevo mensaje
  const message = await channel.send({
    embeds: [embed],
    components: [actionRow]
  });

  // Guardar configuración
  await configurationService.setModerationConfig(interaction.guildId, {
    reportChannelId: channel.id,
    reportMessageId: message.id
  });

  const successEmbed = createBaseEmbed({
    title: "Report Channel Configured",
    description: `The report system has been configured in ${channel}.`,
    footerText: "Users will be able to report members using the embed button."
  }).addFields({
    name: "Channel",
    value: `${channel} (${channel.id})`
  });

    await interaction.editReply({
      content: "Configuration saved successfully.",
      embeds: [successEmbed]
    });
  } catch (error) {
    logger.error("Error in setup-report-channel:", error);
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "An error occurred while configuring the report channel. Please try again.",
          embeds: []
        });
      } else {
        await interaction.reply({
          content: "An error occurred while configuring the report channel. Please try again.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error("Error sending error message in setup-report-channel:", replyError);
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

