import type { Client } from "discord.js";

import type { EventModule } from "../types/Event.js";
import { logger } from "../utils/logger.js";

const event: EventModule<"ready"> = {
  name: "ready",
  once: true,
  execute: (client: Client<true>) => {
    logger.info(`Bot conectado como ${client.user.tag}.`);
  }
};

export default event;

