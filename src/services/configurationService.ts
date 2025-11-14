import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "../utils/logger.js";

interface WelcomeConfig {
  channelId: string;
  roleId?: string;
  message?: string;
}

interface BotConfiguration {
  welcome: Record<string, WelcomeConfig>;
}

const DEFAULT_CONFIGURATION: BotConfiguration = {
  welcome: {}
};

export class ConfigurationService {
  private static instance: ConfigurationService;

  private readonly configPath = path.join(process.cwd(), "config", "config.json");

  private configuration: BotConfiguration | null = null;

  private constructor() {
    // Singleton
  }

  static getInstance() {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }

  async getWelcomeConfig(guildId: string) {
    const config = await this.ensureConfiguration();
    return config.welcome[guildId] ?? null;
  }

  async setWelcomeConfig(guildId: string, welcomeConfig: WelcomeConfig) {
    const config = await this.ensureConfiguration();
    config.welcome[guildId] = welcomeConfig;
    await this.persistConfiguration(config);
  }

  async clearWelcomeConfig(guildId: string) {
    const config = await this.ensureConfiguration();
    if (config.welcome[guildId]) {
      delete config.welcome[guildId];
      await this.persistConfiguration(config);
    }
  }

  private async ensureConfiguration() {
    if (this.configuration) return this.configuration;

    try {
      const raw = await readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BotConfiguration>;
      this.configuration = {
        ...DEFAULT_CONFIGURATION,
        ...parsed,
        welcome: parsed?.welcome ?? {}
      };
    } catch (error) {
      logger.warn(
        `No se pudo leer la configuración en ${this.configPath}. Se usará la configuración por defecto.`,
        error
      );
      this.configuration = structuredClone(DEFAULT_CONFIGURATION);
      await this.persistConfiguration(this.configuration);
    }

    return this.configuration;
  }

  private async persistConfiguration(config: BotConfiguration) {
    try {
      const serialized = JSON.stringify(config, null, 2);
      await writeFile(this.configPath, `${serialized}\n`, { encoding: "utf-8" });
      this.configuration = config;
      logger.info("Configuración guardada correctamente.");
    } catch (error) {
      logger.error("Error al persistir la configuración del bot.", error);
      throw error;
    }
  }
}

export const configurationService = ConfigurationService.getInstance();

export type { WelcomeConfig };

