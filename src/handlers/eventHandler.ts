import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { BotClient } from "../types/BotClient.js";
import type { EventModule } from "../types/Event.js";
import { logger } from "../utils/logger.js";

type EventModuleDefinition = {
  default?: EventModule;
  event?: EventModule;
};

const isEventFile = (fileName: string) => {
  if (fileName.endsWith(".d.ts") || fileName.endsWith(".map")) {
    return false;
  }

  const isDev = process.env.NODE_ENV !== "production";

  // En desarrollo solo .ts – en producción solo .js
  return isDev ? fileName.endsWith(".ts") : fileName.endsWith(".js");
};

const walkDirectory = async (directory: string, accumulator: string[] = []) => {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(entryPath, accumulator);
      continue;
    }

    if (isEventFile(entry.name)) {
      accumulator.push(entryPath);
    }
  }

  return accumulator;
};

const loadEventModule = async (filePath: string): Promise<EventModule | null> => {
  try {
    const moduleUrl = pathToFileURL(filePath).href;
    const importedModule = (await import(moduleUrl)) as EventModuleDefinition;
    const event = importedModule.default ?? importedModule.event;

    if (!event?.name || typeof event.execute !== "function") {
      logger.warn(`El archivo ${filePath} no exporta un evento válido.`);
      return null;
    }

    return event;
  } catch (error) {
    logger.error(`Error al cargar el evento desde ${filePath}`, error);
    return null;
  }
};

export const registerEvents = async (client: BotClient) => {
  const isDev = process.env.NODE_ENV !== "production";

  const basePath = isDev
    ? path.join(process.cwd(), "src", "events")
    : path.join(process.cwd(), "dist", "events");

  const eventFiles = await walkDirectory(basePath, []);

  for (const filePath of eventFiles) {
    const event = await loadEventModule(filePath);
    if (!event) continue;

    if (event.once) {
      client.once(event.name, async (...args) => {
        try {
          await event.execute(...args);
        } catch (error) {
          logger.error(`Error en la ejecución del evento ${event.name}`, error);
        }
      });
    } else {
      client.on(event.name, async (...args) => {
        try {
          await event.execute(...args);
        } catch (error) {
          logger.error(`Error en la ejecución del evento ${event.name}`, error);
        }
      });
    }
  }

  logger.info("Eventos registrados correctamente.");
};
