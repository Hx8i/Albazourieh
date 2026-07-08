import { z } from 'zod';
import { MunicipalityRole } from '@prisma/client';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
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
