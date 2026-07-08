-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "district" VARCHAR(120);

-- CreateIndex
CREATE INDEX "damage_reports_status_severity_idx" ON "damage_reports"("status", "severity");

-- CreateIndex
CREATE INDEX "properties_district_idx" ON "properties"("district");
