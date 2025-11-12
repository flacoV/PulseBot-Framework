import type { ChatInputCommandInteraction, Interaction } from "discord.js";

import type { BotClient } from "../types/BotClient.js";
import type { EventModule } from "../types/Event.js";
import { logger } from "../utils/logger.js";

const ensureGuildContext = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Este comando solo puede usarse dentro de un servidor.",
      ephemeral: true
    });
    return false;
  }

  return true;
};

const event: EventModule<"interactionCreate"> = {
  name: "interactionCreate",
  execute: async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const botClient = interaction.client as BotClient;
    const command = botClient.commands.get(interaction.commandName);

    if (!command) {
      await interaction.reply({
        content: "Este comando ya no está disponible.",
        ephemeral: true
      });
      logger.warn(`Intento de usar comando desconocido: ${interaction.commandName}`);
      return;
    }

    if (command.guildOnly) {
      const allowed = await ensureGuildContext(interaction);
      if (!allowed) return;
    }

    if (command.requiredPermissions?.length && interaction.inGuild()) {
      const hasPermissions = interaction.memberPermissions?.has(command.requiredPermissions);
      if (!hasPermissions) {
        await interaction.reply({
          content: "No tienes permisos suficientes para ejecutar este comando.",
          ephemeral: true
        });
        return;
      }
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error al ejecutar el comando ${interaction.commandName}`, error);

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "Ha ocurrido un error inesperado al procesar el comando.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "Ha ocurrido un error inesperado al procesar el comando.",
          ephemeral: true
        });
      }
    }
  }
};

export default event;

