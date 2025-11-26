import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Colors,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type CategoryChannel,
  type Guild,
  type Message,
  type TextChannel
} from "discord.js";

import { configurationService } from "../services/configurationService.js";
import { createBaseEmbed } from "./embedBuilder.js";
import { logger } from "./logger.js";
import { getEnvVarList } from "./env.js";

export type TicketCategory = "general" | "support" | "other";

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  general: "General",
  support: "Support",
  other: "Other"
};

const CATEGORY_EMOJIS: Record<TicketCategory, string> = {
  general: "📋",
  support: "🔧",
  other: "💬"
};

const CATEGORY_COLORS: Record<TicketCategory, number> = {
  general: 0x5865f2,
  support: 0x00d9ff,
  other: 0x95a5a6
};

/**
 * Gets the IDs of the configured staff roles.
 */
const getStaffRoleIds = (): Set<string> => {
  return new Set(getEnvVarList("STAFF_ROLE_IDS"));
};

/**
 * Checks if a user already has an open ticket in the server.
 * Searches across all channels to ensure no duplicate tickets.
 * Verifies both by channel name pattern and by permission overwrites to ensure accuracy.
 */
export const hasOpenTicket = async (guild: Guild, userId: string): Promise<TextChannel | null> => {
  try {
    // Get user to check username
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user) {
      return null;
    }

    // Search all text channels in the guild
    const channels = await guild.channels.fetch();
    const textChannels = channels.filter(
      (ch) => ch?.type === ChannelType.GuildText
    ) as Map<string, TextChannel>;

    const usernameLower = user.username.toLowerCase();

    // Check each channel that starts with "ticket-"
    for (const channel of textChannels.values()) {
      if (!channel.name.startsWith("ticket-")) {
        continue;
      }

      // Verify the channel still exists and is accessible
      try {
        await channel.fetch();
      } catch {
        // Channel might be deleted or inaccessible, continue searching
        continue;
      }

      // Check if user has ViewChannel permission (they should if it's their ticket)
      const permissions = channel.permissionsFor(userId);
      if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
        continue;
      }

      // Verify this is the user's ticket by checking:
      // 1. Channel name matches user's username pattern
      // 2. User has member-specific permission overwrite (not just role-based)
      const nameMatches = channel.name.includes(usernameLower) || channel.name === `ticket-${usernameLower}`;
      
      // Check permission overwrites to see if user is explicitly granted access as a member
      const userOverwrite = channel.permissionOverwrites.cache.get(userId);
      const hasMemberAccess = userOverwrite?.type === OverwriteType.Member && 
                              userOverwrite.allow.has(PermissionFlagsBits.ViewChannel);

      // If either condition is true, this is likely the user's ticket
      if (nameMatches || hasMemberAccess) {
        return channel;
      }
    }

    return null;
  } catch (error) {
    logger.error(`Error checking for open tickets for user ${userId}:`, error);
    return null;
  }
};

/**
 * Creates a ticket (private channel) for a user.
 * Returns the channel if successful, or null if there's an error or the user already has an open ticket.
 */
export const createTicket = async (
  guild: Guild,
  userId: string,
  category: TicketCategory
): Promise<TextChannel | null> => {
  try {
    // Check if user already has an open ticket
    const existingTicket = await hasOpenTicket(guild, userId);
    if (existingTicket) {
      logger.info(
        `User ${userId} already has an open ticket (${existingTicket.id}) in server ${guild.id}.`
      );
      return null; // Return null to indicate ticket creation was blocked
    }

    // Get the configured category
    const ticketConfig = await configurationService.getTicketConfig(guild.id);
    const categoryId = ticketConfig?.categoryId;

    if (!categoryId) {
      logger.warn(`No category configured for tickets in the server ${guild.id}.`);
      return null;
    }

    // Get the category
    const categoryChannel = (await guild.channels.fetch(categoryId).catch(() => null)) as
      | CategoryChannel
      | null;

    if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
      logger.warn(
        `The ticket category (${categoryId}) does not exist or is not valid in the server ${guild.id}.`
      );
      return null;
    }

    // Verify bot permissions
    const me = await guild.members.fetchMe();
    const botPermissions = categoryChannel.permissionsFor(me);

    if (
      !botPermissions?.has([
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
      ])
    ) {
      logger.warn(
        `The bot does not have sufficient permissions to create channels in the category ${categoryId} in the server ${guild.id}.`
      );
      return null;
    }

    // Get user
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user) {
      logger.warn(`Could not get the user ${userId} to create the ticket.`);
      return null;
    }

    // Get staff roles
    const staffRoleIds = getStaffRoleIds();

    // Configure channel permissions
    const permissionOverwrites = [
      // Deny access to @everyone
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
        type: OverwriteType.Role
      },
      // Allow access to the user who created the ticket
      {
        id: userId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ],
        type: OverwriteType.Member
      }
    ];

    // Add permissions for staff roles
    if (staffRoleIds.size > 0) {
      for (const roleId of staffRoleIds) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (role) {
          permissionOverwrites.push({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages
            ],
            type: OverwriteType.Role
          });
        }
      }
    }

    // Create the channel
    const channelName = `ticket-${user.username.toLowerCase()}`.slice(0, 100); // Discord limita a 100 caracteres
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites,
      topic: `Ticket for ${CATEGORY_LABELS[category]} - Created by ${user.tag}`
    });

    logger.info(
      `Ticket created: ${channel.id} for the user ${user.tag} (${userId}) in the server ${guild.id}.`
    );

    return channel;
  } catch (error) {
    logger.error(`Error creating ticket for the user ${userId}:`, error);
    return null;
  }
};

/**
 * Sends the initial message of the ticket with the action buttons.
 */
export const sendTicketInitialMessage = async (
  channel: TextChannel,
  userId: string,
  category: TicketCategory
): Promise<Message | null> => {
  try {
    const user = await channel.client.users.fetch(userId).catch(() => null);
    if (!user) {
      logger.warn(`Could not get the user ${userId} for the initial message of the ticket.`);
      return null;
    }

    const embed = createBaseEmbed({
      title: `${CATEGORY_EMOJIS[category]} Ticket - ${CATEGORY_LABELS[category]}`,
      description: `Welcome to your ticket for ${CATEGORY_LABELS[category].toLowerCase()}. A staff member will help you soon.\n\n**Ticket information:**`,
      color: CATEGORY_COLORS[category],
      footerText: `Created by ${user.tag}`
    })
      .addFields(
        {
          name: "User",
          value: `<@${userId}> (${user.tag})`,
          inline: true
        },
        {
          name: "Category",
          value: `${CATEGORY_EMOJIS[category]} ${CATEGORY_LABELS[category]}`,
          inline: true
        },
        {
          name: "Status",
          value: "⏳ Waiting for staff",
          inline: true
        }
      )
      .setTimestamp();

    // Create buttons
    const takeTicketButton = new ButtonBuilder()
      .setCustomId(`ticket_take_${channel.id}`)
      .setLabel("Take Ticket")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("✋");

    const closeTicketButton = new ButtonBuilder()
      .setCustomId(`ticket_close_${channel.id}`)
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔒");

    const transcriptButton = new ButtonBuilder()
      .setCustomId(`ticket_transcript_${channel.id}`)
      .setLabel("Save Transcript")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💾");

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      takeTicketButton,
      closeTicketButton,
      transcriptButton
    );

    const message = await channel.send({
      content: `<@${userId}>`,
      embeds: [embed],
      components: [actionRow]
    });

    return message;
  } catch (error) {
    logger.error(`Error sending initial message of the ticket in ${channel.id}:`, error);
    return null;
  }
};

/**
 * Updates the ticket embed to show that it has been taken by a staff member.
 */
export const updateTicketEmbedTaken = async (
  message: Message,
  staffUser: { id: string; tag: string }
): Promise<void> => {
  try {
    const embed = message.embeds[0];
    if (!embed) return;

    const updatedEmbed = createBaseEmbed({
      title: embed.title || "Ticket",
      description: embed.description || "",
      color: embed.color || 0x5865f2,
      ...(embed.footer?.text && { footerText: embed.footer.text })
    });

    // Copy all existing fields
    if (embed.fields) {
      for (const field of embed.fields) {
        if (field.name !== "Status") {
          updatedEmbed.addFields(field);
        }
      }
    }

    // Update status field
    updatedEmbed.addFields({
      name: "Status",
      value: `✅ Taken by <@${staffUser.id}> (${staffUser.tag})`,
      inline: true
    });

    // Update the message (keep the buttons)
    await message.edit({ embeds: [updatedEmbed] });
  } catch (error) {
    logger.error("Error updating ticket embed:", error);
  }
};

/**
 * Creates the modal to close a ticket with a reason.
 */
export const createCloseTicketModal = (channelId: string) => {
  const modal = new ModalBuilder()
    .setCustomId(`close_ticket_modal_${channelId}`)
    .setTitle("Close Ticket");

  const reasonInput = new TextInputBuilder()
    .setCustomId("close_reason")
    .setLabel("Close Reason")
    .setPlaceholder("Describe the reason for closing this ticket...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(500);

  const reasonRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);

  modal.addComponents(reasonRow);

  return modal;
};

/**
 * Closes a ticket and sends the log to the configured channel.
 */
export const closeTicket = async (
  channel: TextChannel,
  closer: { id: string; tag: string },
  reason?: string
): Promise<void> => {
  try {
    const guild = channel.guild;
    const ticketConfig = await configurationService.getTicketConfig(guild.id);

    // Get ticket information from the initial embed
    // Search for the initial message that has the embed with the ticket information
    const messages = await channel.messages.fetch({ limit: 50 });
    let userId: string | null = null;
    let category: TicketCategory = "general";

    // Search for the initial message of the ticket (the one that has the embed with the buttons)
    const initialMessage = messages.find((m) => m.embeds.length > 0 && m.components.length > 0);

    if (initialMessage?.embeds[0]) {
      const embed = initialMessage.embeds[0];
      const userField = embed.fields?.find((f) => f.name === "User");
      if (userField?.value) {
        const match = userField.value.match(/<@(\d+)>/);
        if (match && match[1]) {
          userId = match[1];
        }
      }

      const categoryField = embed.fields?.find((f) => f.name === "Category");
      if (categoryField?.value) {
        if (categoryField.value.includes("General")) category = "general";
        else if (categoryField.value.includes("Support")) category = "support";
        else if (categoryField.value.includes("Other")) category = "other";
      }
    }

    // If the userId was not found in the embed, try to get it from the channel name
    // The format is ticket-{username}, but better try to get it from the first message
    if (!userId) {
      // Search for the first message of the bot that mentions the user
      const botMessages = messages.filter((m) => m.author.id === channel.client.user?.id);
      for (const msg of botMessages.values()) {
        if (msg.content && msg.content.includes("<@")) {
          const match = msg.content.match(/<@(\d+)>/);
          if (match && match[1]) {
            userId = match[1];
            break;
          }
        }
      }
    }

    // Send close message
    const closeEmbed = createBaseEmbed({
      title: "🔒 Ticket Closed",
      description: `This ticket has been closed by <@${closer.id}> (${closer.tag}).`,
      color: Colors.Red,
      footerText: `Closed by ${closer.tag}`
    });

    if (reason) {
      closeEmbed.addFields({
        name: "Close Reason",
        value: reason
      });
    }

    closeEmbed.setTimestamp();

    await channel.send({ embeds: [closeEmbed] });

    // Wait a moment before deleting the channel
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send log if configured
    if (ticketConfig?.logChannelId) {
      const logChannel = (await guild.channels
        .fetch(ticketConfig.logChannelId)
        .catch(() => null)) as TextChannel | null;

      if (logChannel && logChannel.isTextBased() && !logChannel.isDMBased()) {
        const logEmbed = createBaseEmbed({
          title: "📋 Ticket Closed",
          description: `A ticket was closed in ${channel.name}`,
          color: Colors.Orange,
          footerText: `Channel ID: ${channel.id}`
        })
          .addFields(
            {
              name: "User",
              value: userId ? `<@${userId}>` : "Unknown",
              inline: true
            },
            {
              name: "Category",
              value: `${CATEGORY_EMOJIS[category]} ${CATEGORY_LABELS[category]}`,
              inline: true
            },
            {
              name: "Closed by",
              value: `<@${closer.id}> (${closer.tag})`,
              inline: true
            },
            {
              name: "Close Date",
              value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
              inline: false
            },
            ...(reason
              ? [
                  {
                    name: "Close Reason",
                    value: reason,
                    inline: false
                  }
                ]
              : [])
          )
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] }).catch((error) => {
          logger.warn(`Could not send close log of ticket:`, error);
        });
      }
    }

    // Delete the channel
    await channel.delete(`Ticket closed by ${closer.tag}`);

    logger.info(
      `Ticket ${channel.id} closed by ${closer.tag} in the server ${guild.id}.`
    );
  } catch (error) {
    logger.error(`Error closing the ticket ${channel.id}:`, error);
    throw error;
  }
};

/**
 * Generates and saves the transcript of a ticket.
 */
export const generateTranscript = async (
  channel: TextChannel,
  requester: { id: string; tag: string }
): Promise<void> => {
  try {
    const guild = channel.guild;
    const ticketConfig = await configurationService.getTicketConfig(guild.id);

    if (!ticketConfig?.transcriptChannelId) {
      throw new Error("No transcript channel configured.");
    }

    const transcriptChannel = (await guild.channels
      .fetch(ticketConfig.transcriptChannelId)
      .catch(() => null)) as TextChannel | null;

    if (!transcriptChannel || !transcriptChannel.isTextBased() || transcriptChannel.isDMBased()) {
      throw new Error("The transcript channel is not valid.");
    }

    // Get all messages of the ticket
    const messages: Message[] = [];
    let lastMessageId: string | undefined;

    while (true) {
      const fetched = await channel.messages.fetch({
        limit: 100,
        ...(lastMessageId && { before: lastMessageId })
      });

      if (fetched.size === 0) break;

      messages.push(...Array.from(fetched.values()));
      lastMessageId = fetched.last()?.id;

      if (fetched.size < 100) break;
    }

    // Sort messages by date (oldest first)
    messages.reverse();

    // Get ticket information
    let userId: string | null = null;
    let category: TicketCategory = "general";
    const initialMessage = messages.find((m) => m.embeds.length > 0);
    if (initialMessage?.embeds[0]) {
      const embed = initialMessage.embeds[0];
      const userField = embed.fields?.find((f) => f.name === "User");
      if (userField?.value) {
        const match = userField.value.match(/<@(\d+)>/);
        if (match && match[1]) userId = match[1];
      }

      const categoryField = embed.fields?.find((f) => f.name === "Category");
      if (categoryField?.value) {
        if (categoryField.value.includes("General")) category = "general";
        else if (categoryField.value.includes("Support")) category = "support";
        else if (categoryField.value.includes("Other")) category = "other";
      }
    }

    // Generate transcript in text format
    const transcriptLines: string[] = [];
    transcriptLines.push("=".repeat(50));
    transcriptLines.push(`TICKET TRANSCRIPT`);
    transcriptLines.push("=".repeat(50));
    transcriptLines.push(`Channel: ${channel.name} (${channel.id})`);
    transcriptLines.push(`Categoría: ${CATEGORY_LABELS[category]}`);
    transcriptLines.push(`User: ${userId ? `<@${userId}>` : "Unknown"}`);
    transcriptLines.push(`Generated by: ${requester.tag} (${requester.id})`);
    transcriptLines.push(`Date: ${new Date().toISOString()}`);
    transcriptLines.push("=".repeat(50));
    transcriptLines.push("");

    for (const message of messages) {
      const timestamp = new Date(message.createdTimestamp).toISOString();
      const author = message.author.tag;
      const content = message.content || "*[No content]*";

      transcriptLines.push(`[${timestamp}] ${author}: ${content}`);

      // Add embeds if they exist
      if (message.embeds.length > 0) {
        for (const embed of message.embeds) {
          transcriptLines.push(`  [EMBED] ${embed.title || "No title"}`);
          if (embed.description) {
            transcriptLines.push(`  ${embed.description}`);
          }
        }
      }

      // Add attachments if they exist
      if (message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
          transcriptLines.push(`  [ATTACHMENT] ${attachment.url}`);
        }
      }

      transcriptLines.push("");
    }

    transcriptLines.push("=".repeat(50));
    transcriptLines.push("END OF TRANSCRIPT");
    transcriptLines.push("=".repeat(50));

    const transcriptText = transcriptLines.join("\n");

    // Create embed for the transcript
    const transcriptEmbed = createBaseEmbed({
      title: "💾 Ticket Transcript",
      description: `Transcript generated for the ticket ${channel.name}`,
      color: 0x5865f2,
      footerText: `Generated by ${requester.tag}`
    })
      .addFields(
        {
          name: "Channel",
          value: `${channel.name} (${channel.id})`,
          inline: true
        },
        {
          name: "Category",
          value: `${CATEGORY_EMOJIS[category]} ${CATEGORY_LABELS[category]}`,
          inline: true
        },
        {
          name: "User",
          value: userId ? `<@${userId}>` : "Unknown",
          inline: true
        },
        {
          name: "Total messages",
          value: `${messages.length}`,
          inline: true
        },
        {
          name: "Generated by",
          value: `<@${requester.id}> (${requester.tag})`,
          inline: true
        }
      )
      .setTimestamp();

    // Send embed first (without the transcript, since it can be very long)
    await transcriptChannel.send({ embeds: [transcriptEmbed] });

    // Send transcript in parts (Discord has a limit of 2000 characters per message)
    const maxLength = 1900; // Leave margin for the backticks and format
    const transcriptWithCode = `\`\`\`\n${transcriptText}\n\`\`\``;

    if (transcriptWithCode.length <= maxLength) {
      // If it fits in a single message, send it directly
      await transcriptChannel.send({
        content: transcriptWithCode
      });
    } else {
      // Divide the transcript into parts
      const parts: string[] = [];
      let currentPart = "";
      const lines = transcriptText.split("\n");

      for (const line of lines) {
        const lineWithNewline = currentPart ? `\n${line}` : line;
        if (currentPart.length + lineWithNewline.length + 10 > maxLength) {
          // +10 for the backticks and format
          if (currentPart) {
            parts.push(`\`\`\`\n${currentPart}\n\`\`\``);
          }
          currentPart = line;
        } else {
          currentPart += lineWithNewline;
        }
      }
      if (currentPart) {
        parts.push(`\`\`\`\n${currentPart}\n\`\`\``);
      }

      // Enviar cada parte
      for (const part of parts) {
        if (part) {
          await transcriptChannel.send({
            content: part
          });
        }
      }
    }

    logger.info(
      `Transcript generated for the ticket ${channel.id} by ${requester.tag} in the server ${guild.id}.`
    );
  } catch (error) {
    logger.error(`Error generating transcript of the ticket ${channel.id}:`, error);
    throw error;
  }
};


