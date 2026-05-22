// gjsify API coverage data — keep in sync with the Summary table in STATUS.md.
//
// `Full` / `Partial` / `Stub` are the implementation tiers used across the
// codebase:
//
//   Full     — every API surface the consumer reaches in practice works
//              (cross-tested against Node + relevant standards).
//   Partial  — the core surface works; specific subsystems are missing or
//              behind a runtime fallback (typically: a Vala bridge that
//              hasn't landed yet, or an upstream GJS gap tracked in the
//              "Upstream GJS Patch Candidates" section of STATUS.md).
//   Stub     — exists so dependency checks resolve, but the implementation
//              is a no-op or hard-fails on use.

export interface CoverageRow {
	/** Display label. */
	category: string;
	/** Total count of packages in this category. */
	total: number;
	/** Implementation tiers. */
	full: number;
	partial: number;
	stub: number;
	/**
	 * Optional human-friendly note that renders alongside the bar — used for
	 * the categories where percentages alone would be misleading (e.g.
	 * Showcases / Browser UI / Build tools, where every member is "Full"
	 * but the count is the more interesting number).
	 */
	note?: string;
}

/**
 * Source: `STATUS.md` Summary table. The counts deliberately leave out the
 * `*-meta` umbrella packages (which are dep-only and don't represent
 * independent implementation effort) so the percentages reflect real
 * coverage, not inflated by aggregator packages.
 */
export const coverageRows: readonly CoverageRow[] = [
	{
		category: "Node.js APIs",
		total: 44,
		full: 36,
		partial: 4,
		stub: 4,
	},
	{
		category: "Web APIs",
		total: 20,
		full: 18,
		partial: 2,
		stub: 0,
	},
	{
		category: "DOM / Bridges",
		total: 8,
		full: 8,
		partial: 0,
		stub: 0,
	},
	{
		category: "Browser UI",
		total: 3,
		full: 3,
		partial: 0,
		stub: 0,
		note: "adwaita-web · adwaita-fonts · adwaita-icons",
	},
	{
		category: "GJS infrastructure",
		total: 4,
		full: 3,
		partial: 1,
		stub: 0,
	},
	{
		category: "Build & infra tools",
		total: 9,
		full: 9,
		partial: 0,
		stub: 0,
	},
	{
		category: "Showcases",
		total: 8,
		full: 8,
		partial: 0,
		stub: 0,
		note: "Production-quality runnable demos",
	},
	{
		category: "Integration test suites",
		total: 4,
		full: 4,
		partial: 0,
		stub: 0,
		note: "webtorrent · socket.io · streamx · autobahn",
	},
];

/** Sum across all rows (excluding -meta umbrella packages). */
export function totalsAcrossCategories(): { total: number; full: number; partial: number; stub: number } {
	return coverageRows.reduce(
		(acc, row) => ({
			total: acc.total + row.total,
			full: acc.full + row.full,
			partial: acc.partial + row.partial,
			stub: acc.stub + row.stub,
		}),
		{ total: 0, full: 0, partial: 0, stub: 0 },
	);
}
