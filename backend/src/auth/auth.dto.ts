import { z } from 'zod';
import { MunicipalityRole } from '../generated/prisma/client';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    /** "Remember Me" — extends the session token from 12h to 7 days. */
    rememberMe: z.boolean().default(false),
  })
  .strict();

export type LoginDto = z.infer<typeof loginSchema>;

/** Shape embedded in every signed JWT. */
export interface JwtPayload {
  sub: string;
  email: string;
  fullName: string;
  role: MunicipalityRole;
}

export interface LoginResponseDto {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: MunicipalityRole;
    municipalityName: string;
  };
}
