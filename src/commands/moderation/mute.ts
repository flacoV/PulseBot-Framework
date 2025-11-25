import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";

import type { Command } from "../../types/Command.js";
import type { CreateModerationCaseInput } from "../../types/Moderation.js";
import { configurationService } from "../../services/configurationService.js";
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
  .setName("mute")
  .setDescription("Mute a member applying the configured role.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("User to mute.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the mute.")
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("duration")
      .setDescription("Duration (e.g: 30m, 2h, 1d). Maximum 30 days.")
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

  const moderationConfig = await configurationService.getModerationConfig(interaction.guildId);
  if (!moderationConfig?.muteRoleId) {
    await interaction.reply({
      content: "The mute role has not been configured yet. Use /setup-mute-role before continuing.",
      ephemeral: true
    });
    return;
  }

  const muteRole = interaction.guild.roles.cache.get(moderationConfig.muteRoleId);
  if (!muteRole) {
    await interaction.reply({
      content:
        "The role configured for mutes no longer exists. Configure it again with /setup-mute-role.",
      ephemeral: true
    });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true).trim();
  const durationInput = interaction.options.getString("duration");
  const evidence = formatEvidence(interaction.options.getString("evidence"));

  if (targetUser.bot) {
    await interaction.reply({
      content: "You cannot mute a bot.",
      ephemeral: true
    });
    return;
  }

  const guild = interaction.guild;
  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (!ensureHierarchy(moderatorMember, targetMember ?? null)) {
    await interaction.reply({
      content: "You cannot mute this member. Verify the role hierarchy.",
      ephemeral: true
    });
    return;
  }

  if (!targetMember) {
    await interaction.reply({
      content: "I was unable to get the specified member. Try again.",
      ephemeral: true
    });
    return;
  }

  if (targetMember.roles.cache.has(muteRole.id)) {
    await interaction.reply({
      content: "The member is already muted.",
      ephemeral: true
    });
    return;
  }

  let durationMs: number | undefined;
  let expiresAt: Date | undefined;

  if (durationInput) {
    const parsed = parseDurationInput(durationInput);
    if (!parsed) {
      await interaction.reply({
        content:
          "Invalid duration. Use formats like 30m, 2h, 1d and a maximum of 30 days.",
        ephemeral: true
      });
      return;
    }
    durationMs = parsed;
    expiresAt = new Date(Date.now() + parsed);
  }

  await targetMember.roles.add(muteRole.id, `Mute applied by ${interaction.user.tag}: ${reason}`);

  const moderationPayload: CreateModerationCaseInput = {
    guildId: guild.id,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    type: "mute",
    reason,
    evidenceUrls: evidence,
    metadata: {
      muteRoleId: muteRole.id
    }
  };

  if (typeof durationMs === "number") {
    moderationPayload.durationMs = durationMs;
  }

  if (expiresAt) {
    moderationPayload.expiresAt = expiresAt;
  }

  const moderationCase = await createModerationCase(moderationPayload);

  if (expiresAt && durationMs) {
    setTimeout(async () => {
      try {
        const freshGuild = await interaction.client.guilds.fetch(guild.id).catch(() => null);
        if (!freshGuild) return;

        const freshRole =
          freshGuild.roles.cache.get(muteRole.id) ??
          (await freshGuild.roles.fetch(muteRole.id).catch(() => null));
        if (!freshRole) return;

        const member = await freshGuild.members.fetch(targetUser.id).catch(() => null);
        if (!member || !member.roles.cache.has(freshRole.id)) {
          return;
        }

        await member.roles.remove(freshRole, "Mute expired automatically.");

        const unmuteCase = await createModerationCase({
          guildId: freshGuild.id,
          userId: member.id,
          moderatorId: interaction.client.user?.id ?? "system",
          type: "unmute",
          reason: "Mute expired automatically.",
          metadata: {
            muteRoleId: freshRole.id,
            automated: true
          }
        });

        const userForDm = await member.user.fetch();
        const inviteUrl = await getOrCreatePermanentInvite(freshGuild);
        await sendModerationDm({
          user: userForDm,
          guildName: freshGuild.name,
          type: "unmute",
          caseId: unmuteCase.caseId,
          reason: "Mute expired automatically.",
          inviteUrl
        });

        // Log del unmute automático
        await logModerationAction({
          guild: freshGuild,
          actionType: "unmute",
          caseId: unmuteCase.caseId,
          targetUser: {
            id: member.id,
            tag: userForDm.tag,
            username: userForDm.username
          },
          moderator: {
            id: interaction.client.user?.id ?? "system",
            tag: interaction.client.user?.tag ?? "System"
          },
          reason: "Mute expired automatically.",
          metadata: { automated: true }
        });
      } catch (error) {
        logger.error(
          `Error trying to automatically remove the mute of ${targetUser.id} in ${guild.id}`,
          error
        );
      }
    }, durationMs).unref();
  }

  const embed = createBaseEmbed({
    title: `Mute applied: case #${moderationCase.caseId}`,
    description: `${targetUser} has been muted.`,
    footerText: "Remember to remove the role manually if you did not define a duration."
  }).addFields(
    {
      name: "Moderator",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Duration",
      value: durationMs ? formatDuration(durationMs) : "Indefinite",
      inline: true
    },
    {
      name: "Reason",
      value: reason
    }
  );

  if (expiresAt) {
    embed.addFields({
      name: "Expires",
      value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
    });
  }

  if (evidence.length) {
    embed.addFields({
      name: "Evidence",
      value: evidence.map((item, index) => `${index + 1}. ${item}`).join("\n")
    });
  }

  await interaction.reply({
    content: "Mute applied successfully.",
    embeds: [embed],
    ephemeral: true
  });

  // Enviar DM con invite (sin bloquear la respuesta)
  getOrCreatePermanentInvite(guild)
    .then((inviteUrl) => {
      if (durationMs) {
        return sendModerationDm({
          user: targetUser,
          guildName: guild.name,
          type: "mute",
          caseId: moderationCase.caseId,
          reason,
          durationText: formatDuration(durationMs),
          inviteUrl
        });
      } else {
        return sendModerationDm({
          user: targetUser,
          guildName: guild.name,
          type: "mute",
          caseId: moderationCase.caseId,
          reason,
          inviteUrl
        });
      }
    })
    .catch((error) => {
      logger.debug("Error getting invite or sending DM in mute:", error);
    });

  // Enviar log al canal de moderación
  await logModerationAction({
    guild,
    actionType: "mute",
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
  requiredPermissions: [PermissionFlagsBits.ModerateMembers],
  access: "staff"
};

export default command;



