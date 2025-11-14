import {
  ChannelType,
  type MessageCreateOptions,
  type TextChannel,
  type Message
} from "discord.js";

import { configurationService } from "../services/configurationService.js";
import type { EventModule } from "../types/Event.js";
import { createBaseEmbed } from "../utils/embedBuilder.js";
import { logger } from "../utils/logger.js";
import {
  DEFAULT_WELCOME_TEMPLATE,
  createWelcomeContext,
  renderWelcomeTemplate
} from "../utils/welcomePlaceholders.js";

import type { BotClient } from "../types/BotClient.js";

const WELCOME_DEDUP_TTL_MS = 60_000;
const WELCOME_MESSAGE_DEDUP_WINDOW_MS = 60_000;
const WELCOME_MESSAGE_LOOKBACK_LIMIT = 10;

const hasRecentWelcome = (client: BotClient, guildId: string, userId: string) =>
  client.welcomeDedupCache.get(guildId)?.has(userId) ?? false;

const markRecentWelcome = (client: BotClient, guildId: string, userId: string) => {
  let guildWelcomes = client.welcomeDedupCache.get(guildId);
  if (!guildWelcomes) {
    guildWelcomes = new Map();
    client.welcomeDedupCache.set(guildId, guildWelcomes);
  }

  const existingTimeout = guildWelcomes.get(userId);
  if (existingTimeout) clearTimeout(existingTimeout);

  const timeout = setTimeout(() => {
    const timeoutMap = client.welcomeDedupCache.get(guildId);
    timeoutMap?.delete(userId);

    if (timeoutMap && timeoutMap.size === 0) {
      client.welcomeDedupCache.delete(guildId);
    }
  }, WELCOME_DEDUP_TTL_MS);

  guildWelcomes.set(userId, timeout);
};

const matchesMember = (message: Message, memberId: string) => {
  const mentionVariants = [`<@${memberId}>`, `<@!${memberId}>`];

  const contentMatches = message.content ? mentionVariants.some((m) => message.content.includes(m)) : false;
  const embedMatches = message.embeds.some((embed) => {
    const description = embed.data.description ?? embed.description ?? "";
    if (!description) return false;
    return mentionVariants.some((m) => description.includes(m));
  });

  return contentMatches || embedMatches;
};

const hasRecentWelcomeMessage = async (channel: TextChannel, memberId: string) => {
  try {
    const messages = await channel.messages.fetch({ limit: WELCOME_MESSAGE_LOOKBACK_LIMIT });
    const now = Date.now();

    for (const message of messages.values()) {
      if (message.author.id !== channel.client.user?.id) continue;
      if (now - message.createdTimestamp > WELCOME_MESSAGE_DEDUP_WINDOW_MS) continue;
      if (matchesMember(message, memberId)) {
        return true;
      }
    }
  } catch (error) {
    logger.warn(
      `No se pudieron obtener mensajes recientes del canal ${channel.id} para aplicar la deduplicación.`,
      error
    );
  }

  return false;
};

const event: EventModule<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  execute: async (member) => {
    const botClient = member.client as BotClient;

    if (hasRecentWelcome(botClient, member.guild.id, member.id)) {
      logger.debug(
        `Se detectó una bienvenida duplicada para ${member.id} en ${member.guild.id}, se omitirá.`
      );
      return;
    }

    // ✅ Se marca antes del envío para evitar duplicados simultáneos
    markRecentWelcome(botClient, member.guild.id, member.id);

    const config = await configurationService.getWelcomeConfig(member.guild.id);
    if (!config) return;

    try {
      const channel = await member.guild.channels.fetch(config.channelId);

      if (!channel || channel.type !== ChannelType.GuildText) {
        logger.warn(
          `El canal configurado (${config.channelId}) no es válido para el servidor ${member.guild.id}.`
        );
        return;
      }

      const textChannel = channel as TextChannel;

      if (await hasRecentWelcomeMessage(textChannel, member.id)) {
        logger.debug(
          `Se detectó un mensaje de bienvenida reciente existente para ${member.id} en ${member.guild.id}, se omite el nuevo envío.`
        );
        return;
      }

      const context = createWelcomeContext(member);
      const descriptionTemplate = config.message ?? DEFAULT_WELCOME_TEMPLATE;
      const description = renderWelcomeTemplate(descriptionTemplate, context);

      const embed = createBaseEmbed({
        title: `¡Bienvenid@ a ${member.guild.name}!`,
        description,
        thumbnailUrl: member.user.displayAvatarURL()
      });

      const mentionVariants = [`<@${member.id}>`, `<@!${member.id}>`];
      const descriptionContainsMention = mentionVariants.some((mention) =>
        description.includes(mention)
      );

      const payload: MessageCreateOptions = descriptionContainsMention
        ? { embeds: [embed] }
        : { content: context.userMention, embeds: [embed] };

      await textChannel.send(payload);

      if (config.roleId) {
        const role = await member.guild.roles.fetch(config.roleId);
        if (role) {
          await member.roles.add(role);
        } else {
          logger.warn(
            `El rol configurado (${config.roleId}) no existe en el servidor ${member.guild.id}.`
          );
        }
      }
    } catch (error) {
      logger.error(
        `Error al procesar la bienvenida para el usuario ${member.id} en ${member.guild.id}`,
        error
      );
    }
  }
};

export default event;


