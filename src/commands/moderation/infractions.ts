import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

import type { Command } from "../../types/Command.js";
import type { ModerationActionType } from "../../types/Moderation.js";
import { getUserCases, getUserStats } from "../../services/moderationService.js";
import { createBaseEmbed } from "../../utils/embedBuilder.js";
import { logger } from "../../utils/logger.js";

const actionChoices: { name: string; value: ModerationActionType; icon: string }[] = [
  { name: "Warnings", value: "warn", icon: "🔔" },
  { name: "Mutes", value: "mute", icon: "🔇" },
  { name: "Kicks", value: "kick", icon: "👋" },
  { name: "Bans", value: "ban", icon: "🔨" },
  { name: "Notes", value: "note", icon: "📝" }
];

const builder = new SlashCommandBuilder()
  .setName("infractions")
  .setDescription("View the disciplinary history of a member.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("User to view the disciplinary history of.").setRequired(true)
  )
  .addStringOption((option) => {
    option.setName("type").setDescription("Optional: Filter by specific type or search all types.");
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
  return `#${modCase.caseId} · **${modCase.type.toUpperCase()}** · ${timestamp}\n> ${modCase.reason}\n> Responsible: <@${modCase.moderatorId}>`;
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "This command can only be executed within a server.",
      ephemeral: true
    });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const typeFilter = interaction.options.getString("type") as ModerationActionType | null;

  await interaction.deferReply();

  const caseQueryOptions = typeFilter ? { type: typeFilter } : undefined;

  const [cases, stats] = await Promise.all([
    getUserCases(interaction.guildId, targetUser.id, caseQueryOptions),
    getUserStats(interaction.guildId, targetUser.id)
  ]);

  if (cases.length === 0) {
    await interaction.editReply({
      content: "No records found for this member with the selected filters.",
      embeds: []
    });
    return;
  }

  const formatCount = (value?: number) => (value && value > 0 ? `${value}` : "N/A");
  const summaryLines = actionChoices
    .map((choice) => `${choice.icon} ${choice.name}: ${formatCount(stats.typeCounts[choice.value])}`)
    .join("\n");

  const totalForView = typeFilter ? stats.typeCounts[typeFilter] ?? 0 : stats.totalCases;
  const lastCaseForView = typeFilter ? cases[0] : stats.lastAction;

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(cases.length / pageSize));
  let currentPage = 0;

  const buildPageEmbed = (page: number) => {
    const baseEmbed = createBaseEmbed({
      title: `History of ${targetUser.username}`,
      description: `Found ${cases.length} record(s)${
        typeFilter ? ` of type ${typeFilter}` : ""
      }.`,
      footerText: "These records are stored for future audits."
    });

    baseEmbed.addFields(
      {
        name: typeFilter ? `Total ${typeFilter}` : "Total cases",
        value: formatCount(totalForView),
        inline: true
      },
      {
        name: "Last action",
        value: lastCaseForView
          ? `#${lastCaseForView.caseId} · ${lastCaseForView.type} · <t:${Math.floor(
              new Date(lastCaseForView.createdAt).getTime() / 1000
            )}:R>`
          : "N/A",
        inline: true
      }
    );

    if (!typeFilter) {
      baseEmbed.addFields({
        name: "Total by type",
        value: summaryLines
      });
    }

    const start = page * pageSize;
    const slice = cases.slice(start, start + pageSize);

    const caseChunks = slice.map((modCase) => formatCaseLine(modCase));
    baseEmbed.addFields({
      name: `Records (page ${page + 1}/${totalPages})`,
      value: caseChunks.join("\n\n")
    });

    return baseEmbed;
  };

  const components =
    totalPages > 1
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("infractions_prev")
              .setEmoji("⬅️")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("infractions_next")
              .setEmoji("➡️")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("infractions_close")
              .setEmoji("🗑️")
              .setStyle(ButtonStyle.Danger)
          )
        ]
      : [];

  const initialMessage = await interaction.editReply({
    content: null,
    embeds: [buildPageEmbed(currentPage)],
    components
  });

  if (totalPages === 1) return;

  const collector = initialMessage.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id,
    time: 60_000
  });

  collector.on("collect", async (i) => {
    try {
      await i.deferUpdate();

      if (i.customId === "infractions_close") {
        collector.stop("closed");
        await initialMessage.edit({
          embeds: [buildPageEmbed(currentPage)],
          components: []
        });
        return;
      }

      if (i.customId === "infractions_prev") {
        currentPage = currentPage === 0 ? totalPages - 1 : currentPage - 1;
      } else if (i.customId === "infractions_next") {
        currentPage = currentPage === totalPages - 1 ? 0 : currentPage + 1;
      }

      await initialMessage.edit({
        embeds: [buildPageEmbed(currentPage)],
        components
      });
    } catch (error) {
      logger.error("Error processing pagination of /infractions.", error);
    }
  });

  collector.on("end", async () => {
    try {
      await initialMessage.edit({
        embeds: [buildPageEmbed(currentPage)],
        components: []
      });
    } catch {
      // mensaje borrado, ignorar
    }
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


