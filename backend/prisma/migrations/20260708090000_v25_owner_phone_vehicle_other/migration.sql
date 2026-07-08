-- v2.5: "Other" vehicle sub-type free text + optional landlord phone
-- shared by tenant submissions.
ALTER TABLE "properties" ADD COLUMN "vehicleTypeOther" VARCHAR(120);
ALTER TABLE "properties" ADD COLUMN "ownerPhoneNumber" VARCHAR(20);
