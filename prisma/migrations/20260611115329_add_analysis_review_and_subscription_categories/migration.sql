-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "categories" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sightingId" TEXT,
    "eventId" TEXT,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "isResearch" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Analysis_sightingId_fkey" FOREIGN KEY ("sightingId") REFERENCES "Sighting" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Analysis_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Analysis" ("confidence", "content", "createdAt", "eventId", "id", "isResearch", "sightingId", "userId") SELECT "confidence", "content", "createdAt", "eventId", "id", "isResearch", "sightingId", "userId" FROM "Analysis";
DROP TABLE "Analysis";
ALTER TABLE "new_Analysis" RENAME TO "Analysis";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
