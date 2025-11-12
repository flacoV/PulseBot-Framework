import { logger } from "./logger.js";

export const getEnvVar = (key: string): string => {
  const value = process.env[key];

  if (!value || value.trim().length === 0) {
    const message = `La variable de entorno ${key} es obligatoria y no está definida.`;
    logger.error(message);
    throw new Error(message);
  }

  return value;
};

export const getEnvVarList = (key: string): string[] => {
  const rawValue = process.env[key];
  if (!rawValue) return [];

  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

