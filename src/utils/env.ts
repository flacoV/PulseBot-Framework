import { logger } from "./logger.js";

export const getEnvVar = (key: string): string => {
  const value = process.env[key];

  if (!value || value.trim().length === 0) {
    const message = `The environment variable ${key} is required and not defined.`;
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

export const getEnvVarOptional = (key: string, defaultValue?: string): string | undefined => {
  const value = process.env[key];
  if (!value || value.trim().length === 0) return defaultValue;
  return value.trim();
};

