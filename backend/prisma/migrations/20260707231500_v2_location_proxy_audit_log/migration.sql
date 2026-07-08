-- v2 form-logic + audit logging.

-- 1. Deep-precision location + vehicle sub-type on properties.
ALTER TABLE "properties" ADD COLUMN "vehicleType" VARCHAR(30);
ALTER TABLE "properties" ADD COLUMN "street" VARCHAR(120);
ALTER TABLE "properties" ADD COLUMN "projectName" VARCHAR(120);
ALTER TABLE "properties" ADD COLUMN "floor" VARCHAR(30);
ALTER TABLE "properties" ADD COLUMN "additionalDirections" VARCHAR(255);

-- 2. Proxy contact number on reports.
ALTER TABLE "damage_reports" ADD COLUMN "proxyPhoneNumber" VARCHAR(20);

-- 3. Administrative audit trail ("تتبع العمليات").
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "adminName" VARCHAR(120) NOT NULL,
    "actionType" VARCHAR(40) NOT NULL,
    "targetId" VARCHAR(60) NOT NULL,
    "details" TEXT NOT NULL,
    "ipAddress" VARCHAR(45),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_adminId_idx" ON "audit_logs"("adminId");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "municipality_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
