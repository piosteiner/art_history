-- 189: private reference images in an order of their own, the first the main one (owner 2026-11-02: "the reference
-- images also need the buttons to move images and to make one the main") — per account and work, as images.position.
-- The main one is what stands in for a missing public picture (the site's and the CMS's previews, the quiz).
ALTER TABLE private_images ADD COLUMN position int NOT NULL DEFAULT 0;
UPDATE private_images i SET position = o.n
  FROM (SELECT id, row_number() OVER (PARTITION BY artwork_id, owner_id ORDER BY created_at, id) - 1 AS n FROM private_images) o
 WHERE o.id = i.id;
CREATE INDEX private_images_order_idx ON private_images (artwork_id, owner_id, position);
