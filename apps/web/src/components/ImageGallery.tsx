import { useTranslation } from "react-i18next";
import { useMediaList } from "../lib/queries.js";
import { MediaImage } from "./MediaImage.js";

interface ImageGalleryProps {
  collectionId: string;
  itemId: string;
  /** What the item is called, for each photo's alternative text. */
  itemName: string;
}

/**
 * An item's photos in order (#37). The first is the item's cover — what its row
 * shows — and says so in text, not by position or styling alone.
 */
export function ImageGallery({ collectionId, itemId, itemName }: ImageGalleryProps) {
  const { t } = useTranslation("items");
  const media = useMediaList(collectionId, itemId);

  // Rendered with its message inside: a `role="alert"` is announced on insertion.
  if (media.error) return <p role="alert">{t("photos_error")}</p>;
  if (!media.data) return <p className="form-hint">{t("photos_loading")}</p>;
  if (media.data.length === 0) return <p className="form-hint">{t("photos_empty")}</p>;

  const count = media.data.length;
  return (
    <ul className="image-gallery">
      {media.data.map((image, index) => (
        <li key={image.id} className="image-gallery-item">
          <MediaImage
            collectionId={collectionId}
            itemId={itemId}
            mediaId={image.id}
            variant="thumb"
            width={image.width}
            height={image.height}
            alt={t("photo_alt", { name: itemName, position: index + 1, count })}
            className="image-gallery-thumb"
          />
          {index === 0 && <span className="image-cover-badge">{t("photo_cover")}</span>}
        </li>
      ))}
    </ul>
  );
}
