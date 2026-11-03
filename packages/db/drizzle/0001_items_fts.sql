-- Full-text search over items (#41). Hand-written: drizzle-kit cannot express a
-- virtual table or triggers, and every statement needs its own breakpoint
-- because the migrator prepares each chunk as a single statement.
--
-- items_fts is never keyed by items.rowid: items has a TEXT primary key, so its
-- rowid is implicit and may be renumbered (VACUUM, or drizzle-kit's
-- table-recreate pattern), which would attach one item's text to another. Nor
-- is it looked up by an item_id column inside the FTS table: FTS5 cannot index
-- a column, so every write would scan the whole index. Instead items_search_key
-- gives each item an INTEGER PRIMARY KEY — a rowid alias, which VACUUM keeps —
-- and that key is the FTS rowid. Both lookups are then indexed.
--
-- What is indexed is decided by the collection's schema, not by the stored JSON:
-- only values under a key the schema defines, and only for field types whose
-- value is words a person would type — text, select, multiselect, tags — plus
-- number. Urls, emails, dates, ratings, currency, booleans and images are not
-- searched; neither are values left behind by a field the schema has dropped.
--
-- The body expression lives only in items_fts_after_update. Everything else that
-- needs the index rebuilt does it by touching items.fields, so there is one
-- definition of "what is searchable".
CREATE TABLE `items_search_key` (
	`key` integer PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL UNIQUE REFERENCES `items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `items_fts` USING fts5(body, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `items_fts_after_insert` AFTER INSERT ON `items` BEGIN
  UPDATE `items` SET `fields` = `fields` WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_after_update` AFTER UPDATE OF `fields`, `collection_id` ON `items` BEGIN
  INSERT OR IGNORE INTO `items_search_key` (`item_id`) VALUES (NEW.`id`);
  DELETE FROM `items_fts` WHERE `rowid` = (SELECT `key` FROM `items_search_key` WHERE `item_id` = NEW.`id`);
  INSERT INTO `items_fts` (`rowid`, `body`) VALUES (
    (SELECT `key` FROM `items_search_key` WHERE `item_id` = NEW.`id`),
    (
      SELECT group_concat(`v`, ' ') FROM (
        SELECT `e`.`value` AS `v`
        FROM json_each(NEW.`fields`) AS `e`
        JOIN json_each((SELECT `fields` FROM `collections` WHERE `id` = NEW.`collection_id`)) AS `f`
          ON json_extract(`f`.`value`, '$.id') = `e`.`key`
        WHERE json_extract(`f`.`value`, '$.type') IN ('text', 'select', 'number')
          AND `e`.`type` IN ('text', 'integer', 'real')
        UNION ALL
        SELECT `a`.`value` AS `v`
        FROM json_each(NEW.`fields`) AS `e`
        JOIN json_each((SELECT `fields` FROM `collections` WHERE `id` = NEW.`collection_id`)) AS `f`
          ON json_extract(`f`.`value`, '$.id') = `e`.`key`
        JOIN json_each(CASE WHEN `e`.`type` = 'array' THEN `e`.`value` ELSE '[]' END) AS `a`
        WHERE json_extract(`f`.`value`, '$.type') IN ('multiselect', 'tags') AND `a`.`type` = 'text'
      )
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_before_delete` BEFORE DELETE ON `items` BEGIN
  DELETE FROM `items_fts` WHERE `rowid` = (SELECT `key` FROM `items_search_key` WHERE `item_id` = OLD.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `collections_fields_reindex` AFTER UPDATE OF `fields` ON `collections`
WHEN OLD.`fields` IS NOT NEW.`fields` BEGIN
  UPDATE `items` SET `fields` = `fields` WHERE `collection_id` = NEW.`id`;
END;
--> statement-breakpoint
UPDATE `items` SET `fields` = `fields`;
