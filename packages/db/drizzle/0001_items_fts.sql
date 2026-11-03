-- Full-text search over items (#41). Hand-written: drizzle-kit cannot express a
-- virtual table or triggers, and every statement needs its own breakpoint
-- because the migrator prepares each chunk as a single statement.
--
-- The index is keyed by item_id, never by rowid: items has a TEXT primary key,
-- so its rowid is implicit and may be renumbered (VACUUM, or drizzle-kit's
-- table-recreate pattern), which would attach one item's text to another.
--
-- What is indexed is decided by the collection's schema, not by the stored JSON:
-- only values under a key the schema defines, and only for field types whose
-- value is words a person would type — text, select, multiselect, tags — plus
-- number. Urls, emails, dates, ratings, currency, booleans and images are not
-- searched; neither are values left behind by a field the schema has dropped.
--
-- The body expression lives only in items_fts_after_update. Everything else that
-- needs the index rebuilt (the insert trigger aside) does it by touching
-- items.fields, so there is one definition of "what is searchable".
CREATE VIRTUAL TABLE `items_fts` USING fts5(item_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `items_fts_after_insert` AFTER INSERT ON `items` BEGIN
  UPDATE `items` SET `fields` = `fields` WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_after_update` AFTER UPDATE OF `fields`, `collection_id` ON `items` BEGIN
  DELETE FROM `items_fts` WHERE `item_id` = OLD.`id`;
  INSERT INTO `items_fts` (`item_id`, `body`) VALUES (
    NEW.`id`,
    (
      SELECT group_concat(`v`, ' ') FROM (
        SELECT `e`.`value` AS `v`
        FROM json_each(NEW.`fields`) AS `e`
        JOIN json_each((SELECT `fields` FROM `collections` WHERE `id` = NEW.`collection_id`)) AS `f`
          ON json_extract(`f`.`value`, '$.id') = `e`.`key`
        WHERE (json_extract(`f`.`value`, '$.type') IN ('text', 'select') AND `e`.`type` = 'text')
           OR (json_extract(`f`.`value`, '$.type') = 'number' AND `e`.`type` IN ('integer', 'real'))
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
CREATE TRIGGER `items_fts_after_delete` AFTER DELETE ON `items` BEGIN
  DELETE FROM `items_fts` WHERE `item_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `collections_fields_reindex` AFTER UPDATE OF `fields` ON `collections`
WHEN OLD.`fields` IS NOT NEW.`fields` BEGIN
  UPDATE `items` SET `fields` = `fields` WHERE `collection_id` = NEW.`id`;
END;
--> statement-breakpoint
UPDATE `items` SET `fields` = `fields`;
