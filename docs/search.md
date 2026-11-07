---

title: Search
description: Finding items in a collection — search, sort, filters, tags, and the All / Collected / Remaining tabs.
---

# Search

Everything on this page happens on one collection's own page, above its list of items. Search, sort, filters and the status tabs all work together: the list shows the items that match **all** of them at once.

Each of them is kept in the page's address. A bookmark, a shared link, or reloading the page opens the collection showing exactly the same items in the same order. There is no search across every collection at once yet.

## Searching a collection

Type in **Search items** and the list narrows as you type. A line above the list says how many items match, for example **2 items match “blue”**. If you use a screen reader, that count is also read out once you stop typing for a moment.

- **What is searched:** text, single- and multiple-choice values, tags and numbers. Web addresses, email addresses, dates, ratings, prices, yes/no fields and images are not searched.
- **How words match:** every word you type has to appear, and each word matches the start of a word in the item, so `blu tra` finds “Blue Train”. Case and accents do not matter: `cafe` finds “Café”. Up to ten words are used.
- **Clearing it:** press Escape in the box, or delete the text. When nothing matches, the list says so and offers **Clear search**.

Searches are limited to 200 characters.

## Sorting a collection

The **Sort by** list on a collection's page orders its items.

| Option                                       | Order                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Best match                                   | Closest match to your search first (offered only while you search)                 |
| Date added, oldest first / newest first      | The order you added items, or the reverse                                          |
| Recently updated                             | The item you changed last comes first                                              |
| Name, A to Z / Z to A                        | By the item's name, which is the first field that holds a value                    |
| Status, collected first                      | Items you own, then items on order, then items you want                            |
| Status, remaining first                      | Items you want, then items on order, then items you own                            |
| _Field_, A to Z, low to high, oldest first … | By one field. The words depend on the field's type. Empty values always come last. |

Without a search, the list is in the order you added items. While you search, it is in best-match order unless you choose another.

Items that tie, such as two wanted items under a status sort, stay in the order you added them. Every descending option — newest first, Z to A, high to low, remaining first — reverses that too, so the item you added last comes first among its ties. Items with an empty value come last whichever way you sort.

Fields of these types can be sorted by: text, web address, email address, number, price, rating, date, yes/no, and single choice. A multiple-choice or tags field holds several values, and an image has no order, so they cannot.

## Filtering a collection

Choose **Filters** to open the filter panel. It has one section for each field that can be filtered, and nothing changes until you choose **Apply filters**.

| Field type            | How you filter it                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Single choice         | Tick the choices you want; an item matches if it has any of them                          |
| Multiple choice, tags | Tick values; with more than one to choose from, pick **Any of these** or **All of these** |
| Number, price, rating | A **Minimum**, a **Maximum**, or both                                                     |
| Date                  | A **From** date, a **To** date, or both                                                   |
| Yes/no                | **Any**, **Yes**, **No**, or **Not set**                                                  |

Every filter applies at once: an item has to pass all of them. The tags you can tick are the ones used anywhere in the collection, so ticking one never makes the others disappear.

Each filter in force appears as a button under the panel, such as **Year: from 1959**. Press it to remove that filter, or choose **Clear filters** to remove them all. The browser's Back button undoes the last change to the filters.

A collection can have up to ten filters at once. If a field is removed or changes type, a filter on it in an old bookmark is ignored rather than stopping the list from loading.

## Tags

A tags field holds any number of short labels you make up as you go, typed into the item form separated by commas. Tags are searched, can be filtered by (above), and can be tidied up for the whole collection at once.

To tidy them, open the collection and choose **Edit collection**. Under **Tags in use** each tags field lists its tags, most used first, with how many items carry each. The 50 most used are listed; use **Find a tag** to reach the rest.

- **Rename** changes a tag on every item that carries it. Renaming a tag to one that already exists merges the two, so items carrying both end up with it once.
- **Remove** takes a tag off every item that carries it, after asking you to confirm. This cannot be undone.

Both also apply to items in the trash, so restoring one later brings it back with the tags you tidied.

## All, Collected and Remaining

Above the list, three tabs split a collection by status:

- **All** shows every item.
- **Collected** shows the items whose status is **Owned**.
- **Remaining** shows the items whose status is **Wanted** or **Ordered** — what you are still looking for, and what is on its way.

The tabs are on every collection, not just finite sets. A tab only changes what is shown; it never changes an item. The tab you are on is kept in the address (`?show=collected` or `?show=remaining`; All is the plain address), and switching tabs does not add a step to the browser's Back button.

With a keyboard, the tabs are one stop: Tab reaches the selected tab, the Left and Right arrow keys move to the others and show them straight away, and Home and End go to the first and last. In a right-to-left language the arrows follow the direction the tabs run. The next Tab moves into the list.

Under **Collected** and **Remaining** a line above the list says how many items are in the tab, for example **2 items remaining**. Search, sort and filters still apply inside a tab.

**When a tab is empty**, it says why rather than calling the collection empty:

| Tab       | Situation                                     | What it says                                      |
| --------- | --------------------------------------------- | ------------------------------------------------- |
| Collected | Nothing is owned                              | **Nothing collected yet**                         |
| Remaining | Nothing is wanted or ordered, and no set size | **Nothing on your wanted list**                   |
| Remaining | A finite set that is not complete yet         | How many are left, for example **3 more to find** |
| Remaining | A finite set that is complete                 | **All collected**                                 |

A finite set counts as complete once you own as many items as the set has — the same rule as its **Complete** badge — even if some wanted or ordered items are still listed. See [Seeing your progress](./collections.md#seeing-your-progress).

**Adding an item from the Remaining tab** starts its status on **Wanted**, so it appears in the tab you are looking at. You can still change it before saving.

If you save an item so it no longer belongs in the list you are looking at — for example you change an owned item to wanted while on **Collected**, or a search no longer matches it — the item is saved and leaves the list, and the app tells you why it is not shown.

## Saved searches

Not available yet. Bookmark the page instead: the address holds the search, sort, filters and tab.

## Related

- [Collections](./collections.md)
- [Items](./items.md)
