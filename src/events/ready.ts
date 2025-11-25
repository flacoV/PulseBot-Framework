import { ActivityType, type Client } from "discord.js";

import type { EventModule } from "../types/Event.js";
import { logger } from "../utils/logger.js";
import { getEnvVarOptional } from "../utils/env.js";

const event: EventModule<"ready"> = {
  name: "ready",
  once: true,
  execute: (client: Client<true>) => {
    logger.info(`Bot connected as ${client.user.tag}.`);

    const activityType = getEnvVarOptional("BOT_ACTIVITY_TYPE", "Streaming") as keyof typeof ActivityType;
    const activityText = getEnvVarOptional("BOT_ACTIVITY_TEXT", "dev by @nopressure") ?? "dev by @nopressure";

    const type = ActivityType[activityType] ?? ActivityType.Playing;

    client.user.setActivity(activityText, { type });

    logger.info(`Activity configured: ${activityType} ${activityText}`);
  }
};

export default event;

