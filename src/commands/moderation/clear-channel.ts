import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel
} from "discord.js";

import type { Command } from "../../types/Command.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { logger } from "../../utils/logger.js";

const builder = new SlashCommandBuilder()
  .setName("clear-channel")
  .setDescription("Delete all messages from a channel. Only the server owner can use this command.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel to delete all messages from.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  );

/**
 * Borra todos los mensajes de un canal en lotes.
 * Discord solo permite borrar hasta 100 mensajes a la vez y solo mensajes de menos de 14 días.
 */
const deleteAllMessages = async (channel: TextChannel): Promise<{ deleted: number; failed: number }> => {
  let deleted = 0;
  let failed = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // Obtener hasta 100 mensajes
      const messages = await channel.messages.fetch({ limit: 100 });

      if (messages.size === 0) {
        hasMore = false;
        break;
      }

      // Filtrar mensajes que tienen más de 14 días (no se pueden borrar con bulkDelete)
      const messagesToDelete = messages.filter(
        (msg) => Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
      );

      if (messagesToDelete.size > 0) {
        try {
          // Borrar en lote (máximo 100)
          const deletedMessages = await channel.bulkDelete(messagesToDelete, true);
          deleted += deletedMessages.size;
        } catch (error) {
          logger.warn(`Error deleting batch of messages in ${channel.id}:`, error);
          failed += messagesToDelete.size;
        }
      }

      // Si hay mensajes más antiguos de 14 días, intentar borrarlos individualmente
      const oldMessages = messages.filter(
        (msg) => Date.now() - msg.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
      );

      for (const oldMsg of oldMessages.values()) {
        try {
          await oldMsg.delete();
          deleted++;
        } catch (error) {
          logger.debug(`Could not delete old message ${oldMsg.id}:`, error);
          failed++;
        }
      }

      // Si obtuvimos menos de 100 mensajes, ya no hay más
      if (messages.size < 100) {
        hasMore = false;
      }

      // Pequeña pausa para evitar rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error(`Error getting messages from channel ${channel.id}:`, error);
      hasMore = false;
    }
  }

  return { deleted, failed };
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      ephemeral: true
    });
    return;
  }

  // Verificar que solo el dueño del servidor pueda usar este comando
  if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "❌ Only the server owner can use this command.",
      ephemeral: true
    });
    return;
  }

  const targetChannel = interaction.options.getChannel("channel", false, [ChannelType.GuildText]) as
    | TextChannel
    | null;

  // Si no se especifica un canal, usar el canal actual
  const channel = targetChannel ?? (interaction.channel as TextChannel);

  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await interaction.reply({
      content: "❌ The specified channel is not valid.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const embed = createBaseEmbed({
      title: "🗑️ Deleting messages...",
      description: `Deleting all messages from ${channel.toString()}. This may take a moment.`,
      color: 0xffa500 // Naranja para indicar proceso
    });

    await interaction.editReply({ embeds: [embed] });

    const { deleted, failed } = await deleteAllMessages(channel);

    const resultEmbed = createBaseEmbed({
      title: "✅ Channel cleared",
      description: `Deleted **${deleted.toLocaleString()}** messages from ${channel.toString()}.${
        failed > 0 ? `\n\n⚠️ Could not delete ${failed.toLocaleString()} messages (possibly very old or without permissions).` : ""
      }`,
      color: 0x00ff00 // Verde para éxito
    });

    await interaction.editReply({ embeds: [resultEmbed] });
  } catch (error) {
    logger.error(`Error deleting messages from channel ${channel.id}:`, error);

    const errorEmbed = createBaseEmbed({
      title: "❌ Error",
      description: "An error occurred while trying to delete the messages from the channel.",
      color: 0xff0000 // Rojo para error
    });

    await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {
      // Si falla, intentar con un mensaje simple
      interaction.followUp({
        content: "❌ An error occurred while trying to delete the messages from the channel.",
        ephemeral: true
      }).catch(() => {});
    });
  }
};

const command: Command = {
  data: builder,
  execute
};

export default command;

