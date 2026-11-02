-- 188: a private reference image taken from another website keeps where it came from (owner 2026-11-02: images of
-- the Shozokan's collection, whose use needs the museum's permission, as reference images "from links of photos from
-- other websites"). The page (or the image's own address) — shown under the image, never published.
ALTER TABLE private_images ADD COLUMN source_url text CHECK (source_url ~ '^https?://' AND length(source_url) <= 2000);
