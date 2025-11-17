import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type User
} from "discord.js";

import { createModerationCase } from "../services/moderationService.js";
import { logger } from "./logger.js";
import { logUserReport } from "./reportLogger.js";

/**
 * Crea el modal para reportar un usuario.
 */
export const createReportModal = () => {
  const modal = new ModalBuilder().setCustomId("report_user_modal").setTitle("Reportar Usuario");

  const userInput = new TextInputBuilder()
    .setCustomId("report_user_id")
    .setLabel("Usuario a Reportar")
    .setPlaceholder("Pega el ID del usuario a reportar")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const reasonInput = new TextInputBuilder()
    .setCustomId("report_reason")
    .setLabel("Motivo del Reporte")
    .setPlaceholder("Describe detalladamente qué hizo el usuario que viola las reglas...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  const evidenceInput = new TextInputBuilder()
    .setCustomId("report_evidence")
    .setLabel("Evidencia (Opcional)")
    .setPlaceholder("URLs de imágenes, mensajes, o referencias (separadas por comas)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  const userRow = new ActionRowBuilder<TextInputBuilder>().addComponents(userInput);
  const reasonRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  const evidenceRow = new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput);

  modal.addComponents(userRow, reasonRow, evidenceRow);

  return modal;
};

/**
 * Extrae el ID de usuario de una mención o ID directo.
 */
const extractUserId = (input: string): string | null => {
  // Formato de mención: <@123456789> o <@!123456789>
  const mentionMatch = input.match(/<@!?(\d+)>/);
  if (mentionMatch && mentionMatch[1]) {
    return mentionMatch[1];
  }

  // ID directo (solo números)
  if (/^\d+$/.test(input.trim())) {
    return input.trim();
  }

  return null;
};

/**
 * Formatea las URLs de evidencia.
 */
const formatEvidence = (raw?: string | null): string[] => {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
};

/**
 * Procesa un reporte de usuario y crea un caso de moderación tipo "note".
 */
export const processUserReport = async (
  guild: Guild,
  reporter: User,
  userInput: string,
  reason: string,
  evidenceInput?: string | null
): Promise<{ success: boolean; message: string; caseId?: number }> => {
  try {
    // Extraer ID del usuario reportado
    const reportedUserId = extractUserId(userInput);
    if (!reportedUserId) {
      return {
        success: false,
        message: "No pude identificar al usuario. Por favor, menciona al usuario (@usuario) o pega su ID."
      };
    }

    // Verificar que el usuario reportado existe en el servidor
    const reportedMember = await guild.members.fetch(reportedUserId).catch(() => null);
    if (!reportedMember) {
      return {
        success: false,
        message: "No pude encontrar a ese usuario en el servidor. Verifica que la mención o ID sea correcta."
      };
    }

    // Verificar que no se está reportando a sí mismo
    if (reportedUserId === reporter.id) {
      return {
        success: false,
        message: "No puedes reportarte a ti mismo."
      };
    }

    // Verificar que no se está reportando a un bot
    if (reportedMember.user.bot) {
      return {
        success: false,
        message: "No puedes reportar a un bot."
      };
    }

    // Formatear evidencia
    const evidence = formatEvidence(evidenceInput);

    // Crear caso de moderación tipo "note" (reporte)
    const moderationCase = await createModerationCase({
      guildId: guild.id,
      userId: reportedUserId,
      moderatorId: reporter.id,
      type: "note",
      reason: `[REPORTE] ${reason}`,
      ...(evidence.length > 0 && { evidenceUrls: evidence }),
      metadata: {
        reportedBy: reporter.id,
        reportType: "user_report"
      }
    });

    // Enviar log al canal de reportes si está configurado
    await logUserReport({
      guild,
      caseId: moderationCase.caseId,
      reporter: {
        id: reporter.id,
        tag: reporter.tag,
        username: reporter.username
      },
      reportedUser: {
        id: reportedMember.user.id,
        tag: reportedMember.user.tag,
        username: reportedMember.user.username
      },
      reason,
      ...(evidence.length > 0 && { evidenceUrls: evidence })
    });

    return {
      success: true,
      message: `Reporte enviado correctamente. Caso #${moderationCase.caseId}. El equipo de moderación lo revisará pronto.`,
      caseId: moderationCase.caseId
    };
  } catch (error) {
    logger.error("Error al procesar reporte de usuario:", error);
    return {
      success: false,
      message: "Ocurrió un error al procesar tu reporte. Por favor, intenta nuevamente más tarde."
    };
  }
};

