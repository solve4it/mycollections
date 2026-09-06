import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";
import { API_URL, E2E_API_TOKEN, WEB_URL } from "../playwright.config.js";

export interface FieldSpec {
  id: string;
  label: string;
  type: string;
  required?: boolean;
}

export interface SeededCollection {
  id: string;
  name: string;
}

/** Creates fixture data through the API, the same way the app does. */
export class ApiFixture {
  constructor(private readonly request: APIRequestContext) {}

  async createCollection(input: {
    name: string;
    description?: string;
    fields: FieldSpec[];
    isFiniteSet?: boolean;
  }): Promise<SeededCollection> {
    const res = await this.request.post(`${API_URL}/api/collections`, {
      headers: this.headers,
      data: { isFiniteSet: false, ...input },
    });
    expect(res.status(), `creating collection "${input.name}"`).toBe(201);
    return (await res.json()) as SeededCollection;
  }

  async createItem(collectionId: string, fields: Record<string, unknown>, status?: string): Promise<{ id: string }> {
    const res = await this.request.post(`${API_URL}/api/collections/${collectionId}/items`, {
      headers: this.headers,
      data: status === undefined ? { fields } : { fields, status },
    });
    expect(res.status(), `creating item in ${collectionId}`).toBe(201);
    return (await res.json()) as { id: string };
  }

  /** Soft-deletes an item, which is how something reaches the trash that Settings renders. */
  async deleteItem(collectionId: string, itemId: string): Promise<void> {
    const res = await this.request.delete(`${API_URL}/api/collections/${collectionId}/items/${itemId}`, {
      headers: this.headers,
    });
    expect(res.ok(), `deleting item ${itemId}`).toBe(true);
  }

  /**
   * Empties the API. "No collections yet" is a fact about the whole database
   * rather than about one spec, so a spec asserting it has to say so first.
   */
  async reset(): Promise<void> {
    const listed = await this.request.get(`${API_URL}/api/collections`, { headers: this.headers });
    // A 401 here means the worker's token is not the one the server was started
    // with — say that, rather than letting it surface as a puzzling empty list.
    expect(listed.status(), "listing collections (401 means the worker and the server disagree on the token)").toBe(
      200,
    );
    for (const { id } of (await listed.json()) as SeededCollection[]) {
      const deleted = await this.request.delete(`${API_URL}/api/collections/${id}`, { headers: this.headers });
      expect(deleted.ok(), `deleting collection ${id}`).toBe(true);
    }
    // Deleting a collection is a soft delete, so without this the trash carries
    // every fixture of every earlier spec into the Settings scan.
    const emptied = await this.request.delete(`${API_URL}/api/trash`, { headers: this.headers });
    expect(emptied.ok(), "emptying the trash").toBe(true);
  }

  private get headers(): Record<string, string> {
    return { Authorization: `Bearer ${E2E_API_TOKEN}` };
  }
}

export const test = base.extend<{ api: ApiFixture }>({
  /**
   * Fails any spec whose page talks to an origin this harness did not start.
   *
   * `VITE_API_URL` is baked into the bundle at build time, and its fallback is
   * `http://localhost:3001` — the port a developer's real API runs on, backed by
   * the working tree's real database. If the e2e build ever loses that variable
   * the specs would still pass, having quietly created and deleted collections
   * in someone's actual data. This turns that into a red test.
   */
  page: async ({ page }, use) => {
    const foreign = new Set<string>();
    page.on("request", (request) => {
      const origin = new URL(request.url()).origin;
      if (origin !== WEB_URL && origin !== API_URL) foreign.add(origin);
    });
    await use(page);
    expect([...foreign], "the page requested an origin this harness did not start").toEqual([]);
  },
  api: async ({ request }, use) => {
    await use(new ApiFixture(request));
  },
});

export { expect } from "@playwright/test";

/** The rule set #24 is measured against. Named once so no spec can quietly narrow its scope. */
const WCAG_2_1_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Structural rules axe classifies as best-practice rather than WCAG, so they run
 * under no `wcag*` tag. The Shell commits to exactly this structure — a skip
 * link, two labelled `<nav>`s, `<main id="main-content">`, one `<h1>` per screen
 * — and losing it is the kind of regression that costs a screen-reader user the
 * page while every WCAG rule still passes.
 */
const STRUCTURAL_RULES = ["region", "landmark-one-main", "heading-order", "page-has-heading-one"];

interface AxeResultNode {
  target: unknown[];
}
interface AxeResult {
  id: string;
  impact?: string | null;
  nodes: AxeResultNode[];
}

/** One line per result, naming the rule and the elements — enough to fix it from the failure alone. */
function summarize(results: AxeResult[]): string[] {
  return results.map((r) => `${r.id} (${r.impact ?? "unknown"}): ${r.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/**
 * Runs axe over the current page and asserts it found nothing to report.
 *
 * Two passes because axe's `runOnly` takes tags or rules, not both, and the
 * structural rules above carry no WCAG tag.
 *
 * `incomplete` is asserted alongside `violations`: it is axe's "could not
 * decide", which is not a pass. Leaving it unchecked is how a baseline goes
 * green over exactly the elements a human needs to look at — text over the
 * generated collection covers being the obvious candidate here.
 *
 * The assertion is on a summarized list rather than a count so a failure names
 * the rule and the offending selector instead of "expected 0, received 3".
 */
export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const wcag = await new AxeBuilder({ page }).withTags(WCAG_2_1_AA).analyze();
  const structural = await new AxeBuilder({ page }).withRules(STRUCTURAL_RULES).analyze();

  expect(summarize([...wcag.violations, ...structural.violations] as AxeResult[])).toEqual([]);
  expect(summarize([...wcag.incomplete, ...structural.incomplete] as AxeResult[]), "axe could not decide").toEqual([]);
}
