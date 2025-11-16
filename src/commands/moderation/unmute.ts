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

const ensureHierarchy = (moderator: GuildMember, target?: GuildMember | null) => {
  if (!target) return true;
  if (target.id === moderator.id) return false;
  if (target.id === moderator.guild.ownerId) return false;

  return moderator.roles.highest.comparePositionTo(target.roles.highest) > 0;
};

const builder = new SlashCommandBuilder()
  .setName("unmute")
  .setDescription("Quita el mute (rol configurado) de un miembro.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Miembro a desmutear.").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("razon")
      .setDescription("Motivo de la remoción del mute.")
      .setMinLength(3)
      .setMaxLength(512)
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

  const moderationConfig = await configurationService.getModerationConfig(interaction.guildId);
  if (!moderationConfig?.muteRoleId) {
    await interaction.reply({
      content: "Aún no se ha configurado el rol de mute. Usa /setup-mute-role antes de continuar.",
      ephemeral: true
    });
    return;
  }

  const muteRole = interaction.guild.roles.cache.get(moderationConfig.muteRoleId);
  if (!muteRole) {
    await interaction.reply({
      content:
        "El rol configurado para los mutes ya no existe. Configúralo nuevamente con /setup-mute-role.",
      ephemeral: true
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("razon")?.trim() ?? "Mute levantado manualmente.";

  const guild = interaction.guild;
  const moderatorMember = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch({ user: targetUser.id }).catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "No pude obtener al miembro especificado. Inténtalo nuevamente.",
      ephemeral: true
    });
    return;
  }

  if (!ensureHierarchy(moderatorMember, targetMember)) {
    await interaction.reply({
      content: "No puedes modificar a este miembro. Verifica la jerarquía de roles.",
      ephemeral: true
    });
    return;
  }

  if (!targetMember.roles.cache.has(muteRole.id)) {
    await interaction.reply({
      content: "El miembro no tiene el rol de mute aplicado.",
      ephemeral: true
    });
    return;
  }

  await targetMember.roles.remove(
    muteRole.id,
    `Mute removido por ${interaction.user.tag}: ${reason}`
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
    title: `Mute removido: caso #${moderationCase.caseId}`,
    description: `${targetUser} ya puede hablar nuevamente.`,
    footerText: "Revisa /infractions para ver el historial completo."
  }).addFields(
    {
      name: "Moderador",
      value: `<@${interaction.user.id}>`,
      inline: true
    },
    {
      name: "Motivo",
      value: reason
    }
  );

  await interaction.reply({
    content: "Se removió el mute correctamente.",
    embeds: [embed],
    ephemeral: true
  });

  await sendModerationDm({
    user: targetUser,
    guildName: guild.name,
    type: "unmute",
    caseId: moderationCase.caseId,
    reason
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



