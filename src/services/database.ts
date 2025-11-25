import mongoose from "mongoose";

import { getEnvVar } from "../utils/env.js";
import { logger } from "../utils/logger.js";

let isConnecting = false;

export const connectToDatabase = async () => {
  if (mongoose.connection.readyState === 1 || isConnecting) {
    return;
  }

  const uri = getEnvVar("MONGODB_URI");

  try {
    isConnecting = true;
    await mongoose.connect(uri);
    logger.info("🚀 Connection to MongoDB established.");
  } catch (error) {
    logger.error("‼️ Could not connect to MongoDB.", error);
    throw error;
  } finally {
    isConnecting = false;
  }
};

export const disconnectDatabase = async () => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info("🔒 Connection to MongoDB closed.");
};


