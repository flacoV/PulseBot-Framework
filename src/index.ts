import "dotenv/config";

import { Client, Collection, GatewayIntentBits, Partials } from "discord.js";

import { loadCommands, registerApplicationCommands } from "./handlers/commandHandler.js";
import { registerEvents } from "./handlers/eventHandler.js";
import type { BotClient } from "./types/BotClient.js";
import type { Command } from "./types/Command.js";
import { logger } from "./utils/logger.js";
import { connectToDatabase } from "./services/database.js";

const createClient = () => {
  const baseClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
    partials: [Partials.GuildMember, Partials.User]
  });

  const client = baseClient as BotClient;
  client.commands = new Collection<string, Command>();
  client.welcomeDedupCache = new Map();

  return client;
};

const bootstrap = async () => {
  const client = createClient();

  try {
    await connectToDatabase();
    await loadCommands(client);
    await registerEvents(client);
    await registerApplicationCommands(client);

    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error("DISCORD_TOKEN no definido. Revisa tu archivo .env.");
    }

    await client.login(token);
  } catch (error) {
    logger.error("Error crítico durante el arranque del bot.", error);
    process.exitCode = 1;
  }
};

void bootstrap();


