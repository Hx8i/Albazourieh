import { MunicipalityRole } from '@prisma/client';
import { z } from 'zod';

/** Only the two-tier hierarchy is assignable through the admin UI. */
export const assignableRoleSchema = z.enum(['SUPER_ADMIN', 'STAFF_MEMBER']);

export const createStaffSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is too short').max(120),
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    // "Temporary password" handed to the new staff member on creation.
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128),
    role: assignableRoleSchema.default('STAFF_MEMBER'),
  })
  .strict();

export type CreateStaffDto = z.infer<typeof createStaffSchema>;

export const staffIdParamSchema = z.string().uuid('Staff id must be a UUID');

/** Safe projection of a staff account — never includes the password hash. */
export interface StaffAccountDto {
  id: string;
  fullName: string;
  email: string;
  role: MunicipalityRole;
  municipalityName: string;
  isActive: boolean;
  createdAt: string;
}
