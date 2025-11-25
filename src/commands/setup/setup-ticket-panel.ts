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
import { ensureStaffAccess } from "../../utils/accessControl.js";

const builder = new SlashCommandBuilder()
  .setName("setup-ticket-panel")
  .setDescription("Set up the ticket panel.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel where the ticket panel will be posted.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("Title of the embed of the panel (optional).")
      .setMaxLength(256)
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("description")
      .setDescription("Description of the embed of the panel (optional).")
      .setMaxLength(2000)
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  try {
    if (!(await ensureStaffAccess(interaction))) {
      return;
    }

    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: "This command can only be executed within a server.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const selectedChannel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
    const title = interaction.options.getString("title") ?? "🎫 Ticket System";
    const description =
      interaction.options.getString("description") ??
      "Need help? Open a ticket by selecting the category that best suits your query.\n\n**Available categories:**\n• **General** - General inquiries and questions\n• **Support** - Technical issues and assistance\n• **Other** - Other inquiries or requests";

    const channel = (await interaction.guild.channels
      .fetch(selectedChannel.id)
      .catch(() => null)) as TextChannel | null;

    if (!channel) {
      await interaction.editReply({
        content: "I couldn't find that channel. Try again.",
        embeds: []
      });
      return;
    }

    // Verificar permisos del bot
    const me = await interaction.guild.members.fetchMe();
    const botPermissions = channel.permissionsFor(me);

    if (!botPermissions?.has(["ViewChannel", "SendMessages", "EmbedLinks", "UseExternalEmojis"])) {
      await interaction.editReply({
        content:
          "The bot does not have enough permissions in that channel. It needs: View Channel, Send Messages, Send Embeds and Use External Emojis.",
        embeds: []
      });
      return;
    }

    // Create the embed with a similar style to the others
    const embed = createBaseEmbed({
      title,
      description,
        color: 0x5865f2 // Similar color to other embeds
    }).addFields({
      name: "ℹ️ Information",
      value: "Click the corresponding button to your category to open a ticket. A staff member will help you as soon as possible."
    });

    // Create 4 buttons for the categories
    const generalButton = new ButtonBuilder()
      .setCustomId("ticket_open_general")
      .setLabel("General")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📋");

    const supportButton = new ButtonBuilder()
      .setCustomId("ticket_open_support")
      .setLabel("Support")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔧")

    const otherButton = new ButtonBuilder()
      .setCustomId("ticket_open_other")
      .setLabel("Other")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("💬");

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      generalButton,
      supportButton,
      otherButton
    );

    // Try to update the existing message if it exists
    const ticketConfig = await configurationService.getTicketConfig(interaction.guildId);
    if (ticketConfig?.panelMessageId && ticketConfig?.panelChannelId === channel.id) {
      try {
        const existingMessage = await channel.messages.fetch(ticketConfig.panelMessageId);
        await existingMessage.edit({
          embeds: [embed],
          components: [actionRow]
        });

        await interaction.editReply({
          content: `The ticket panel has been updated in ${channel}.`,
          embeds: []
        });
        return;
      } catch {
        // The message does not exist, continue to create a new one
      }
    }

    // Send new message
    const message = await channel.send({
      embeds: [embed],
      components: [actionRow]
    });

    // Save configuration
    await configurationService.setTicketConfig(interaction.guildId, {
      panelChannelId: channel.id,
      panelMessageId: message.id
    });

    const successEmbed = createBaseEmbed({
      title: "Ticket Panel Configured",
      description: `The ticket panel has been configured in ${channel}.`,
      footerText: "Users will be able to open tickets using the buttons in the embed."
    }).addFields({
      name: "Channel",
      value: `${channel} (${channel.id})`
    });

    await interaction.editReply({
      content: "Configuration saved successfully.",
      embeds: [successEmbed]
    });
  } catch (error) {
    logger.error("Error in setup-ticket-panel:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "An error occurred while configuring the ticket panel. Please try again.",
          embeds: []
        });
      } else {
        await interaction.reply({
          content: "An error occurred while configuring the ticket panel. Please try again.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error("Error sending error message in setup-ticket-panel:", replyError);
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

