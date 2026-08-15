/**
 * Loading skeletons (#225). A skeleton is a picture of the content that is
 * coming, so it is built from the same containers the real content uses — the
 * collection grid, the item list — and reserves the same boxes. That is the
 * whole point: when the data lands, nothing moves.
 *
 * Announcing it is a separate job. The blocks are decorative and hidden from
 * assistive technology (a dozen empty boxes is not a loading message), and the
 * wait is said once, in words, by a clipped label inside the `role="status"`
 * wrapper. Keeping those words in the DOM is also what lets the #228 guards keep
 * telling "still loading" apart from "there is nothing here".
 */

/**
 * Keys for placeholders that never reorder. Derived from the index but not the
 * index itself — a placeholder has no identity of its own to key on.
 */
function placeholderKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `placeholder-${index}`);
}

interface SkeletonProps {
  /** What is being waited for, in words. Announced; never shown. */
  label: string;
  count?: number;
}

/**
 * Placeholder collection cards, in the grid the real cards use. Four by default
 * rather than a full screen of them: enough to show the shape of the grid — one
 * row at a typical desktop width — without implying how many are coming.
 */
export function CollectionGridSkeleton({ label, count = 4 }: SkeletonProps) {
  return (
    <div role="status">
      <span className="visually-hidden">{label}</span>
      <div className="collection-grid" aria-hidden="true">
        {placeholderKeys(count).map((key) => (
          <div key={key} className="skeleton-card">
            {/* The cover block is what stops the grid resizing when the data
                arrives: it reserves the same 5:3 box the real cover does. */}
            <span className="skeleton skeleton-cover" />
            <div className="collection-card-body">
              <span className="skeleton skeleton-line skeleton-line-eyebrow" />
              <span className="skeleton skeleton-line skeleton-line-name" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The placeholder list itself, shared by the two screens that show items. */
function PlaceholderItemList({ count }: { count: number }) {
  return (
    <ul className="item-list" aria-hidden="true">
      {placeholderKeys(count).map((key) => (
        <li key={key} className="skeleton-row">
          <span className="skeleton skeleton-line skeleton-line-status" />
          <span className="skeleton skeleton-line skeleton-line-field" />
        </li>
      ))}
    </ul>
  );
}

/** Placeholder item rows, in the list the real items use. */
export function ItemListSkeleton({ label, count = 3 }: SkeletonProps) {
  return (
    <div role="status">
      <span className="visually-hidden">{label}</span>
      <PlaceholderItemList count={count} />
    </div>
  );
}

/**
 * The whole collection page before the collection itself has arrived: its title
 * and its items. One `role="status"` for the screen, not one per block — a page
 * that is loading is loading once, however many placeholders it draws.
 */
export function CollectionDetailSkeleton({ label, count = 3 }: SkeletonProps) {
  return (
    <div role="status">
      <span className="visually-hidden">{label}</span>
      <span className="skeleton skeleton-line skeleton-line-title" aria-hidden="true" />
      <PlaceholderItemList count={count} />
    </div>
  );
}
