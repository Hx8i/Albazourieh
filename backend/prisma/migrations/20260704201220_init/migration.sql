-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'CAR', 'SHOP');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('TOTAL', 'PARTIAL', 'MINOR');

-- CreateEnum
CREATE TYPE "MunicipalityRole" AS ENUM ('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('PHOTO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('AR', 'EN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phoneNumber" VARCHAR(20) NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "preferredLanguage" "Language" NOT NULL DEFAULT 'AR',
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "otpCode" VARCHAR(10),
    "otpExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "type" "PropertyType" NOT NULL,
    "realEstateNumber" VARCHAR(60),
    "neighborhood" VARCHAR(120) NOT NULL,
    "addressLine" VARCHAR(255),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_reports" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "voiceNoteUrl" VARCHAR(2048),
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "severity" "DamageSeverity" NOT NULL,
    "submittedByProxy" BOOLEAN NOT NULL DEFAULT false,
    "proxyName" VARCHAR(120),
    "proxyRelation" VARCHAR(60),
    "rejectionReason" TEXT,
    "reporterId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "reviewedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "mimeType" VARCHAR(100),
    "sizeBytes" INTEGER,
    "reportId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipality_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "role" "MunicipalityRole" NOT NULL DEFAULT 'AUDITOR',
    "municipalityName" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipality_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_logs" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "inspectorId" UUID NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "structuralNotes" TEXT NOT NULL,
    "estimatedCostUsd" DECIMAL(12,2) NOT NULL,
    "confirmedSeverity" "DamageSeverity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");

-- CreateIndex
CREATE INDEX "properties_neighborhood_idx" ON "properties"("neighborhood");

-- CreateIndex
CREATE INDEX "properties_latitude_longitude_idx" ON "properties"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "damage_reports_status_idx" ON "damage_reports"("status");

-- CreateIndex
CREATE INDEX "damage_reports_severity_idx" ON "damage_reports"("severity");

-- CreateIndex
CREATE INDEX "damage_reports_createdAt_idx" ON "damage_reports"("createdAt");

-- CreateIndex
CREATE INDEX "attachments_reportId_idx" ON "attachments"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "municipality_users_email_key" ON "municipality_users"("email");

-- CreateIndex
CREATE INDEX "inspection_logs_reportId_idx" ON "inspection_logs"("reportId");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "municipality_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "damage_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_logs" ADD CONSTRAINT "inspection_logs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "damage_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_logs" ADD CONSTRAINT "inspection_logs_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "municipality_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
