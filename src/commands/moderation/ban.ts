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
import { getOrCreatePermanentInvite } from "../../utils/inviteHelper.js";

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
  .setDescription("Ban a member of the server and record the action.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("User to ban.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the ban.")
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("duration")
      .setDescription("Optional: duration of the ban (e.g: 7d, 30d).")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("evidence")
      .setDescription("URLs or references, separated by spaces or commas (maximum 5).")
      .setRequired(false)
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true).trim();
  const durationInput = interaction.options.getString("duration");
  const evidence = formatEvidence(interaction.options.getString("evidence"));

  if (targetUser.bot) {
    await interaction.editReply({
      content: "You cannot ban a bot with this command.",
      embeds: []
    });
    return;
  }

  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (targetMember && !ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.editReply({
      content: "You cannot ban this member. Verify the role hierarchy.",
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
        content: "Invalid duration. Use formats like 7d, 30d (or 1d, 12h, etc.).",
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
    title: `Ban applied: case #${moderationCase.caseId}`,
    description: `${targetUser.tag} has been banned from the server.`,
    footerText: durationMs
      ? "The ban is temporary according to the duration indicated."
      : "Ban with no duration is permanent unless manually unbanned."
  }).addFields(
    {
      name: "Moderator",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Member",
      value: `${targetUser.tag} (${targetUser.id})`,
      inline: true
    },
    {
      name: "Duration",
      value: durationMs ? formatDuration(durationMs) : "Indefinite / permanent",
      inline: true
    },
    {
      name: "Reason",
      value: reason
    }
  );

  if (evidence.length) {
    embed.addFields({
      name: "Evidence",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  // Aplicamos el ban primero
  await guild.members.ban(targetUser.id, {
    reason: `Ban by ${interaction.user.tag}: ${reason}`
  });

  if (expiresAt && durationMs) {
    setTimeout(async () => {
      try {
        const freshGuild = await interaction.client.guilds.fetch(guild.id).catch(() => null);
        if (!freshGuild) return;

        const bans = await freshGuild.bans.fetch().catch(() => null);
        const isStillBanned = bans?.has(targetUser.id);
        if (!isStillBanned) return;

        await freshGuild.members.unban(targetUser.id, "Ban expired automatically.");

        const unbanCase = await createModerationCase({
          guildId: freshGuild.id,
          userId: targetUser.id,
          moderatorId: interaction.client.user?.id ?? "system",
          type: "unban",
          reason: "Ban expired automatically.",
          metadata: {
            automated: true
          }
        });

        const inviteUrl = await getOrCreatePermanentInvite(freshGuild);
        await sendModerationDm({
          user: targetUser,
          guildName: freshGuild.name,
          type: "unban",
          caseId: unbanCase.caseId,
          reason: "Ban expired automatically.",
          inviteUrl
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
            tag: interaction.client.user?.tag ?? "System"
          },
          reason: "Ban expired automatically.",
          metadata: { automated: true }
        });
      } catch (error) {
        logger.error(
          `Error trying to automatically remove the ban of ${targetUser.id} in ${guild.id}`,
          error
        );
      }
    }, durationMs).unref();
  }

  await interaction.editReply({
    content: "Ban executed successfully.",
    embeds: [embed]
  });

  // Enviar DM con invite (sin bloquear la respuesta)
  getOrCreatePermanentInvite(guild)
    .then((inviteUrl) => {
      if (durationMs) {
        return sendModerationDm({
          user: targetUser,
          guildName: guild.name,
          type: "ban",
          reason,
          durationText: formatDuration(durationMs),
          inviteUrl
        });
      } else {
        return sendModerationDm({
          user: targetUser,
          guildName: guild.name,
          type: "ban",
          reason,
          inviteUrl
        });
      }
    })
    .catch((error) => {
      logger.debug("Error getting invite or sending DM in ban:", error);
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


