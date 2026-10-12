-- Sections keep the short name they had on the old system, and the old row's id for the phase 5 import.
ALTER TABLE `Section` ADD COLUMN `shortName` VARCHAR(20) NULL,
    ADD COLUMN `legacyId` INTEGER NULL;

CREATE UNIQUE INDEX `Section_legacyId_key` ON `Section`(`legacyId`);
