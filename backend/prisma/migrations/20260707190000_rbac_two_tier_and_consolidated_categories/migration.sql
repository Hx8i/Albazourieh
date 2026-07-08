-- 1. PropertyType: add the consolidated two-card categories.
--    Legacy values (HOUSE/APARTMENT/LAND/SHOP/CAR/MOTORCYCLE) are kept
--    so historical report rows remain readable in the dashboard.
ALTER TYPE "PropertyType" ADD VALUE IF NOT EXISTS 'BUILDING';
ALTER TYPE "PropertyType" ADD VALUE IF NOT EXISTS 'VEHICLE';

-- 2. MunicipalityRole: collapse to the two-tier hierarchy.
--    Any existing AUDITOR / FIELD_INSPECTOR accounts become STAFF_MEMBER;
--    SUPER_ADMIN accounts are preserved as-is.
CREATE TYPE "MunicipalityRole_new" AS ENUM ('SUPER_ADMIN', 'STAFF_MEMBER');

ALTER TABLE "municipality_users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "municipality_users"
  ALTER COLUMN "role" TYPE "MunicipalityRole_new"
  USING (
    CASE WHEN "role"::text = 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
         ELSE 'STAFF_MEMBER'
    END
  )::"MunicipalityRole_new";

DROP TYPE "MunicipalityRole";
ALTER TYPE "MunicipalityRole_new" RENAME TO "MunicipalityRole";

ALTER TABLE "municipality_users"
  ALTER COLUMN "role" SET DEFAULT 'STAFF_MEMBER';
