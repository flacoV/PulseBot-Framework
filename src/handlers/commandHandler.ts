import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Collection, REST, Routes } from "discord.js";

import type { BotClient } from "../types/BotClient.js";
import type { Command } from "../types/Command.js";
import { getEnvVar, getEnvVarList } from "../utils/env.js";
import { logger } from "../utils/logger.js";

type CommandModule = {
  default?: Command;
  command?: Command;
};

const isCommandFile = (fileName: string) => {
  if (fileName.endsWith(".d.ts") || fileName.endsWith(".map")) {
    return false;
  }

  return fileName.endsWith(".ts") || fileName.endsWith(".js");
};

const walkDirectory = async (directory: string, accumulator: string[] = []) => {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(entryPath, accumulator);
      continue;
    }

    if (isCommandFile(entry.name)) {
      accumulator.push(entryPath);
    }
  }

  return accumulator;
};

const loadCommandModule = async (filePath: string): Promise<Command | null> => {
  try {
    const moduleUrl = pathToFileURL(filePath).href;
    const importedModule = (await import(moduleUrl)) as CommandModule;
    const command = importedModule.default ?? importedModule.command;

    if (!command) {
      logger.warn(`El archivo ${filePath} no exporta un comando válido.`);
      return null;
    }

    if (!command.data || typeof command.execute !== "function") {
      logger.warn(`La exportación en ${filePath} no tiene la forma esperada para un comando.`);
      return null;
    }

    return command;
  } catch (error) {
    logger.error(`Error al cargar el comando desde ${filePath}`, error);
    return null;
  }
};

export const loadCommands = async (client: BotClient) => {
  const commandsPath = path.join(process.cwd(), "dist", "commands");
  const srcCommandsPath = path.join(process.cwd(), "src", "commands");

  const commandFiles: string[] = [];

  // Durante desarrollo con ts-node-dev usamos los .ts, en producción los .js compilados.
  try {
    const compiledCommands = await walkDirectory(commandsPath, []);
    if (compiledCommands.length > 0) {
      commandFiles.push(...compiledCommands);
    }
  } catch {
    logger.debug("No se encontraron comandos compilados, se usarán los archivos fuente.");
  }

  if (commandFiles.length === 0) {
    const sourceCommands = await walkDirectory(srcCommandsPath, []);
    commandFiles.push(...sourceCommands);
  }

  const commands = new Collection<string, Command>();

  for (const filePath of commandFiles) {
    const command = await loadCommandModule(filePath);
    if (!command) continue;

    commands.set(command.data.name, command);
  }

  client.commands = commands;
  logger.info(`Se cargaron ${commands.size} comandos.`);
};

export const registerApplicationCommands = async (client: BotClient) => {
  if (client.commands.size === 0) {
    logger.warn("No hay comandos para registrar en la API de Discord.");
    return;
  }

  const token = getEnvVar("DISCORD_TOKEN");
  const clientId = getEnvVar("DISCORD_CLIENT_ID");
  const guildIds = getEnvVarList("DISCORD_GUILD_IDS");

  const rest = new REST({ version: "10" }).setToken(token);
  const payload = client.commands.map((command: Command) => command.data.toJSON());

  try {
    if (guildIds.length > 0) {
      await Promise.all(
        guildIds.map(async (guildId) => {
          await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: payload });
          logger.info(`Comandos registrados en la guild ${guildId}.`);
        })
      );
      return;
    }

    await rest.put(Routes.applicationCommands(clientId), { body: payload });
    logger.info("Comandos registrados globalmente.");
  } catch (error) {
    logger.error("Error al registrar comandos en la API de Discord.", error);
    throw error;
  }
};

