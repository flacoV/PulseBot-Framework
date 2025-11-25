import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";

import type { Command } from "../../types/Command.js";
import { configurationService } from "../../services/configurationService.js";
import { createModerationCase } from "../../services/moderationService.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { sendModerationDm } from "../../utils/moderationDm.js";
import { getOrCreatePermanentInvite } from "../../utils/inviteHelper.js";
import { logger } from "../../utils/logger.js";
import { logModerationAction } from "../../utils/moderationLogger.js";

const ensureHierarchy = (moderator: GuildMember, target?: GuildMember | null) => {
  if (!target) return true;
  if (target.id === moderator.id) return false;
  if (target.id === moderator.guild.ownerId) return false;

  return moderator.roles.highest.comparePositionTo(target.roles.highest) > 0;
};

const builder = new SlashCommandBuilder()
  .setName("unmute")
  .setDescription("Removes the mute (configured role) from a member.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("Member to unmute.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the removal of the mute.")
      .setMinLength(3)
      .setMaxLength(512)
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
  const reason = interaction.options.getString("reason")?.trim() ?? "Mute removed manually.";

  const guild = interaction.guild;
  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "I was unable to get the specified member. Try again.",
      ephemeral: true
    });
    return;
  }

  if (!ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.reply({
      content: "You cannot modify this member. Verify the role hierarchy.",
      ephemeral: true
    });
    return;
  }

  if (!targetMember.roles.cache.has(muteRole.id)) {
    await interaction.reply({
      content: "The member does not have the mute role applied.",
      ephemeral: true
    });
    return;
  }

  await targetMember.roles.remove(
    muteRole.id,
    `Mute removed by ${interaction.user.tag}: ${reason}`
  );

  const moderationCase = await createModerationCase({
    guildId: guild.id,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    type: "unmute",
    reason,
    metadata: {
      muteRoleId: muteRole.id
    }
  });

  const embed = createBaseEmbed({
    title: `Mute removed: case #${moderationCase.caseId}`,
    description: `${targetUser} can now speak again.`,
    footerText: "Check /infractions to see the full history."
  }).addFields(
    {
      name: "Moderator",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Reason",
      value: reason
    }
  );

  await interaction.reply({
    content: "Mute removed successfully.",
    embeds: [embed],
    ephemeral: true
  });

  // Enviar DM con invite (sin bloquear la respuesta)
  getOrCreatePermanentInvite(guild)
    .then((inviteUrl) =>
      sendModerationDm({
        user: targetUser,
        guildName: guild.name,
        type: "unmute",
        caseId: moderationCase.caseId,
        reason,
        inviteUrl
      })
    )
    .catch((error) => {
      logger.debug("Error getting invite or sending DM in unmute:", error);
    });

  // Enviar log al canal de moderación
  await logModerationAction({
    guild,
    actionType: "unmute",
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
    metadata: moderationCase.metadata
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



