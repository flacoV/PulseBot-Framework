import {
  PermissionFlagsBits,
  type APIInteractionGuildMember,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";

import { getEnvVarList } from "./env.js";

const staffRoleIds = new Set(getEnvVarList("STAFF_ROLE_IDS"));

const hasCustomStaffConfig = () => staffRoleIds.size > 0;

const extractRoleIds = (member?: GuildMember | APIInteractionGuildMember | null): string[] => {
  if (!member) return [];

  if ("roles" in member) {
    const roles = member.roles;

    if (Array.isArray(roles)) {
      return roles;
    }

    if ("cache" in roles) {
      return Array.from(roles.cache.keys());
    }
  }

  return [];
};

const memberHasStaffRole = (member?: GuildMember | APIInteractionGuildMember | null): boolean => {
  if (staffRoleIds.size === 0) return false;

  const memberRoles = extractRoleIds(member);
  return memberRoles.some((roleId) => staffRoleIds.has(roleId));
};


export const hasStaffAccess = (
  interaction: ChatInputCommandInteraction | { inGuild: () => boolean; memberPermissions: any; member: any }
): boolean => {
  if (!interaction.inGuild()) {
    return false;
  }

  if (memberHasStaffRole(interaction.member as GuildMember | APIInteractionGuildMember | null)) {
    return true;
  }

  if (!hasCustomStaffConfig()) {
    if ("memberPermissions" in interaction && interaction.memberPermissions) {
      return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
    }
    return false;
  }

  return false;
};

export const ensureStaffAccess = async (
  interaction: ChatInputCommandInteraction
): Promise<boolean> => {
  const allowed = hasStaffAccess(interaction);
  if (allowed) return true;

  await interaction.reply({
    content:
      "This command is limited to authorized staff. Verify that you have the corresponding role or permission.",
    ephemeral: true
  });

  return false;
};


