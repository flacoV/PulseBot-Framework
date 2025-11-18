import type { Guild } from "discord.js";

import { logger } from "./logger.js";

/**
 * Obtiene o crea una invitación permanente para el servidor.
 * Intenta encontrar una invitación existente sin expiración, si no existe, crea una nueva.
 */
export const getOrCreatePermanentInvite = async (guild: Guild): Promise<string | null> => {
  try {
    // Intentar obtener invitaciones existentes
    const invites = await guild.invites.fetch().catch(() => null);

    if (invites) {
      // Buscar una invitación permanente (sin expiración y sin límite de usos)
      const permanentInvite = invites.find(
        (invite) => invite.maxAge === 0 && invite.maxUses === 0 && !invite.temporary
      );

      if (permanentInvite) {
        return `https://discord.gg/${permanentInvite.code}`;
      }
    }

    // Si no hay invitación permanente, intentar crear una
    // Buscar un canal de texto donde el bot pueda crear invitaciones
    const textChannels = guild.channels.cache.filter(
      (channel) => channel.isTextBased() && !channel.isDMBased() && !channel.isThread()
    );

    for (const channel of textChannels.values()) {
      try {
        const me = await guild.members.fetchMe();
        const permissions = channel.permissionsFor(me);

        if (permissions?.has(["CreateInstantInvite", "ViewChannel"])) {
          const invite = await channel.createInvite({
            maxAge: 0, // Sin expiración
            maxUses: 0, // Sin límite de usos
            temporary: false,
            unique: false
          });

          return `https://discord.gg/${invite.code}`;
        }
      } catch {
        // Continuar con el siguiente canal
        continue;
      }
    }

    logger.warn(`No se pudo crear una invitación permanente para el servidor ${guild.id}`);
    return null;
  } catch (error) {
    logger.error(`Error al obtener/crear invitación para el servidor ${guild.id}:`, error);
    return null;
  }
};

