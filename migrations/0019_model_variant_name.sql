PRAGMA foreign_keys = ON;

-- Separates the character/public model name from the specific product variant.
-- Existing rows remain valid with an empty variant until the next audited
-- catalog publication repopulates metadata from the bundle.
ALTER TABLE models
ADD COLUMN variant_name TEXT NOT NULL DEFAULT ''
CHECK(length(variant_name) <= 160);
