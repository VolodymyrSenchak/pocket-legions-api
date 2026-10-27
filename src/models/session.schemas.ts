import { z } from "zod";

export const NICKNAME_MAX_LENGTH = 20;
export const PASSWORD_MAX_LENGTH = 64;

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, "Nickname is required")
  .max(NICKNAME_MAX_LENGTH, `Nickname must be at most ${NICKNAME_MAX_LENGTH} characters`);

/** An empty password means "no password". */
export const passwordSchema = z.string().max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const createSessionBodySchema = z.object({
  nickname: nicknameSchema,
  password: passwordSchema.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const joinSessionBodySchema = z.object({
  nickname: nicknameSchema,
  password: passwordSchema.optional(),
});

export type CreateSessionBody = z.output<typeof createSessionBodySchema>;
export type JoinSessionBody = z.output<typeof joinSessionBodySchema>;
