-- 115 — Page images converted on upload (owner, 2026-10-20: "the compression to WebP that we use in other projects, to
-- save as much storage as possible"). The CMS turns every upload into WebP (sharp, quality 82, the longest side at most
-- 1600 px — twice the width the documentation is read at, sharp on high-resolution screens —, the camera's rotation
-- applied, other metadata dropped), as the adenai map does. The name stays as embedded (![[Bild.png]] keeps working);
-- content_type says what it is now. width/height: so the site reserves the space before the image loads;
-- original_bytes: the size before, for the saving shown in the CMS.
ALTER TABLE page_images
  ADD COLUMN width integer CHECK (width > 0),
  ADD COLUMN height integer CHECK (height > 0),
  ADD COLUMN original_bytes integer CHECK (original_bytes > 0);
