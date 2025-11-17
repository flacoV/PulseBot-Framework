import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";

import type { Command } from "../../types/Command.js";
import type { CreateModerationCaseInput } from "../../types/Moderation.js";
import { createModerationCase } from "../../services/moderationService.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { formatDuration, parseDurationInput } from "../../utils/duration.js";
import { logger } from "../../utils/logger.js";
import { sendModerationDm } from "../../utils/moderationDm.js";
import { logModerationAction } from "../../utils/moderationLogger.js";

const formatEvidence = (raw?: string | null) => {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
};

const ensureHierarchy = (moderator: GuildMember, target?: GuildMember | null) => {
  if (!target) return true;
  if (target.id === moderator.id) return false;
  if (target.id === moderator.guild.ownerId) return false;

  return moderator.roles.highest.comparePositionTo(target.roles.highest) > 0;
};

const builder = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Banea a un miembro del servidor y registra la acción.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Miembro a banear.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("razon")
      .setDescription("Motivo del ban.")
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("duracion")
      .setDescription("Opcional: duración del ban (ej: 7d, 30d). Solo informativa por ahora.")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("evidencia")
      .setDescription("URLs o referencias, separadas por espacios o comas (máximo 5).")
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const targetUser = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("razon", true).trim();
  const durationInput = interaction.options.getString("duracion");
  const evidence = formatEvidence(interaction.options.getString("evidencia"));

  if (targetUser.bot) {
    await interaction.editReply({
      content: "No puedes banear a un bot con este comando.",
      embeds: []
    });
    return;
  }

  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (targetMember && !ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.editReply({
      content: "No puedes banear a este miembro. Verifica la jerarquía de roles.",
      embeds: []
    });
    return;
  }

  let durationMs: number | undefined;
  let expiresAt: Date | undefined;

  if (durationInput) {
    const parsed = parseDurationInput(durationInput);
    if (!parsed) {
      await interaction.editReply({
        content: "Duración inválida. Usa formatos como 7d, 30d (o 1d, 12h, etc.).",
        embeds: []
      });
      return;
    }
    durationMs = parsed;
    expiresAt = new Date(Date.now() + parsed);
  }

  const payload: CreateModerationCaseInput = {
    guildId: guild.id,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    type: "ban",
    reason,
    evidenceUrls: evidence
  };

  if (durationMs) payload.durationMs = durationMs;
  if (expiresAt) payload.expiresAt = expiresAt;

  const moderationCase = await createModerationCase(payload);

  const embed = createBaseEmbed({
    title: `Ban aplicado: caso #${moderationCase.caseId}`,
    description: `${targetUser.tag} ha sido baneado del servidor.`,
    footerText: durationMs
      ? "El ban es temporal de acuerdo a la duración indicada (no se desbanea automáticamente todavía)."
      : "Ban permanente salvo que se desbanee manualmente."
  }).addFields(
    {
      name: "Moderador",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Miembro",
      value: `${targetUser.tag} (${targetUser.id})`,
      inline: true
    },
    {
      name: "Duración",
      value: durationMs ? formatDuration(durationMs) : "Indefinido / permanente",
      inline: true
    },
    {
      name: "Motivo",
      value: reason
    }
  );

  if (evidence.length) {
    embed.addFields({
      name: "Evidencia",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  // Enviamos el DM antes de confirmar la respuesta final, para minimizar
  // efectos secundarios si el usuario tiene MD cerrados.
  if (durationMs) {
    await sendModerationDm({
      user: targetUser,
      guildName: guild.name,
      type: "ban",
      reason,
      durationText: formatDuration(durationMs)
    });
  } else {
    await sendModerationDm({
      user: targetUser,
      guildName: guild.name,
      type: "ban",
      reason
    });
  }

  // Aplicamos el ban después de intentar notificar por DM.
  await guild.members.ban(targetUser.id, {
    reason: `Ban por ${interaction.user.tag}: ${reason}`
  });

  if (expiresAt && durationMs) {
    setTimeout(async () => {
      try {
        const freshGuild = await interaction.client.guilds.fetch(guild.id).catch(() => null);
        if (!freshGuild) return;

        const bans = await freshGuild.bans.fetch().catch(() => null);
        const isStillBanned = bans?.has(targetUser.id);
        if (!isStillBanned) return;

        await freshGuild.members.unban(targetUser.id, "Ban expirado automáticamente.");

        const unbanCase = await createModerationCase({
          guildId: freshGuild.id,
          userId: targetUser.id,
          moderatorId: interaction.client.user?.id ?? "system",
          type: "unban",
          reason: "Ban expirado automáticamente.",
          metadata: {
            automated: true
          }
        });

        await sendModerationDm({
          user: targetUser,
          guildName: freshGuild.name,
          type: "unban",
          caseId: unbanCase.caseId,
          reason: "Ban expirado automáticamente."
        });

        // Log del unban automático
        await logModerationAction({
          guild: freshGuild,
          actionType: "unban",
          caseId: unbanCase.caseId,
          targetUser: {
            id: targetUser.id,
            tag: targetUser.tag,
            username: targetUser.username
          },
          moderator: {
            id: interaction.client.user?.id ?? "system",
            tag: interaction.client.user?.tag ?? "Sistema"
          },
          reason: "Ban expirado automáticamente.",
          metadata: { automated: true }
        });
      } catch (error) {
        logger.error(
          `Error al intentar remover automáticamente el ban de ${targetUser.id} en ${guild.id}`,
          error
        );
      }
    }, durationMs).unref();
  }

  await interaction.editReply({
    content: "Ban ejecutado correctamente.",
    embeds: [embed]
  });

  // Enviar log al canal de moderación
  await logModerationAction({
    guild,
    actionType: "ban",
    caseId: moderationCase.caseId,
    targetUser: {
      id: targetUser.id,
      tag: targetUser.tag,
      username: targetUser.username
    },
    moderator: {
      id: interaction.user.id,
      tag: interaction.user.tag
    },
    reason,
    evidenceUrls: evidence,
    ...(durationMs !== undefined && { durationMs }),
    ...(expiresAt !== undefined && { expiresAt }),
    ...(moderationCase.metadata && { metadata: moderationCase.metadata })
  });
};

const command: Command = {
  data: builder,
  execute,
  guildOnly: true,
  requiredPermissions: [PermissionFlagsBits.BanMembers],
  access: "staff"
};

export default command;


