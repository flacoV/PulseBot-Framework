import { ChannelType } from "discord.js";

import { configurationService } from "../services/configurationService.js";
import type { EventModule } from "../types/Event.js";
import { createBaseEmbed } from "../utils/embedBuilder.js";
import { logger } from "../utils/logger.js";

const applyPlaceholders = (template: string, context: { userMention: string; guildName: string }) =>
  template
    .replaceAll("{{user}}", context.userMention)
    .replaceAll("{{guild}}", context.guildName);

const event: EventModule<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  execute: async (member) => {
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

      const userMention = `<@${member.id}>`;
      const descriptionTemplate =
        config.message ??
        "¡Bienvenid@ {{user}}! Échale un vistazo a las reglas y disfruta tu estancia en {{guild}}.";

      const description = applyPlaceholders(descriptionTemplate, {
        userMention,
        guildName: member.guild.name
      });

      const embed = createBaseEmbed({
        title: `¡Bienvenid@ a ${member.guild.name}!`,
        description,
        thumbnailUrl: member.user.displayAvatarURL()
      });

      await channel.send({
        content: userMention,
        embeds: [embed]
      });

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

