import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import type { Command } from "../../types/Command.js";
import type { ModerationActionType } from "../../types/Moderation.js";
import { getUserCases, getUserStats } from "../../services/moderationService.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";

const actionChoices: { name: string; value: ModerationActionType; icon: string }[] = [
  { name: "Advertencias", value: "warn", icon: "🔔" },
  { name: "Silencios", value: "mute", icon: "🔇" },
  { name: "Expulsiones", value: "kick", icon: "👋" },
  { name: "Baneos", value: "ban", icon: "🔨" },
  { name: "Notas", value: "note", icon: "📝" }
];

const builder = new SlashCommandBuilder()
  .setName("infractions")
  .setDescription("Consulta el historial disciplinario de un miembro.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("usuario").setDescription("Miembro a consultar.").setRequired(true)
  )
  .addStringOption((option) => {
    option.setName("tipo").setDescription("Opcional: Filtra por tipo específico o busca todos los tipos.");
    actionChoices.forEach((choice) => option.addChoices(choice));
    return option;
  });

const formatCaseLine = (modCase: {
  caseId: number;
  type: ModerationActionType;
  reason: string;
  createdAt: Date;
  moderatorId: string;
}) => {
  const timestamp = `<t:${Math.floor(new Date(modCase.createdAt).getTime() / 1000)}:R>`;
  return `#${modCase.caseId} · **${modCase.type.toUpperCase()}** · ${timestamp}\n> ${modCase.reason}\n> Responsable: <@${modCase.moderatorId}>`;
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "Este comando solo puede ejecutarse dentro de un servidor.",
      ephemeral: true
    });
    return;
  }

  const targetUser = interaction.options.getUser("usuario", true);
  const typeFilter = interaction.options.getString("tipo") as ModerationActionType | null;

  const caseQueryOptions = typeFilter ? { type: typeFilter } : undefined;

  const [cases, stats] = await Promise.all([
    getUserCases(interaction.guildId, targetUser.id, caseQueryOptions),
    getUserStats(interaction.guildId, targetUser.id)
  ]);

  if (cases.length === 0) {
    await interaction.reply({
      content: "No se encontraron registros para este miembro con los filtros seleccionados.",
      ephemeral: true
    });
    return;
  }

  const formatCount = (value?: number) => (value && value > 0 ? `${value}` : "N/A");
  const summaryLines = actionChoices
    .map((choice) => `${choice.icon} ${choice.name}: ${formatCount(stats.typeCounts[choice.value])}`)
    .join("\n");

  const totalForView = typeFilter ? stats.typeCounts[typeFilter] ?? 0 : stats.totalCases;
  const lastCaseForView = typeFilter ? cases[0] : stats.lastAction;

  const embed = createBaseEmbed({
    title: `Historial de ${targetUser.username}`,
    description: `Se encontraron ${cases.length} registro(s)${
      typeFilter ? ` de tipo ${typeFilter}` : ""
    }.`,
    footerText: "Los datos se almacenan en MongoDB para auditorías futuras."
  });

  embed.addFields(
    {
      name: typeFilter ? `Total ${typeFilter}` : "Total de casos",
      value: formatCount(totalForView),
      inline: true
    },
    {
      name: "Última acción",
      value: lastCaseForView
        ? `#${lastCaseForView.caseId} · ${lastCaseForView.type} · <t:${Math.floor(
            new Date(lastCaseForView.createdAt).getTime() / 1000
          )}:R>`
        : "N/A",
      inline: true
    }
  );

  if (!typeFilter) {
    embed.addFields({
      name: "Totales por tipo",
      value: summaryLines
    });
  }

  const caseChunks = cases.map((modCase) => formatCaseLine(modCase));
  embed.addFields({
    name: "Registros",
    value: caseChunks.join("\n\n")
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true
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


