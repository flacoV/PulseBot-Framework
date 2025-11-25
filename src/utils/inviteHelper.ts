import type { Guild } from "discord.js";

import { logger } from "./logger.js";

/**
 * Gets or creates a permanent invite for the server.
 * Tries to find an existing invite without expiration, if not, creates a new one.
 */
export const getOrCreatePermanentInvite = async (guild: Guild): Promise<string | null> => {
  try {
    // Try to get existing invites
    const invites = await guild.invites.fetch().catch(() => null);

    if (invites) {
      // Find a permanent invite (without expiration and without limit of uses)
      const permanentInvite = invites.find(
        (invite) => invite.maxAge === 0 && invite.maxUses === 0 && !invite.temporary
      );

      if (permanentInvite) {
        return `https://discord.gg/${permanentInvite.code}`;
      }
    }

    // If there is no permanent invite, try to create one
    // Find a text channel where the bot can create invites
    const textChannels = guild.channels.cache.filter(
      (channel) => channel.isTextBased() && !channel.isDMBased() && !channel.isThread()
    );

    for (const channel of textChannels.values()) {
      try {
        const me = await guild.members.fetchMe();
        const permissions = channel.permissionsFor(me);

        if (permissions?.has(["CreateInstantInvite", "ViewChannel"])) {
          const invite = await channel.createInvite({
            maxAge: 0, // Without expiration
            maxUses: 0, // Without limit of uses
            temporary: false,
            unique: false
          });

          return `https://discord.gg/${invite.code}`;
        }
      } catch {
        // Continue with the next channel
        continue;
      }
    }

    logger.warn(`Could not create a permanent invite for the server ${guild.id}`);
    return null;
  } catch (error) {
    logger.error(`Error getting/creating invite for the server ${guild.id}:`, error);
    return null;
  }
};

