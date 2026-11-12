import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
	config: { x1337xUrls: ["https://1337x.example"], flareSolverrSessions: 0 },
}));
vi.mock("../src/scrapers/query.js", () => ({
	buildQueries: async () => ({
		baseTitle: "Example Movie",
		query: "Example Movie 2025",
		fallbackQuery: null,
		episodeSuffix: null,
	}),
	matchesEpisode: () => true,
}));
vi.mock("../src/scrapers/http.js", () => ({
	fetchText: vi.fn(),
	normalizeBaseUrl: (url: string) => url.replace(/\/+$/, ""),
}));

import { fetchText } from "../src/scrapers/http.js";
import { scrapeX1337xStreams } from "../src/scrapers/x1337x.js";

afterEach(() => vi.resetAllMocks());

it("returns 1337x streams when session pooling is disabled for Byparr", async () => {
	const infoHash = "abcdef0123456789abcdef0123456789abcdef01";
	vi.mocked(fetchText)
		.mockResolvedValueOnce(`<table class="table-list"><tbody><tr>
			<td class="name"><a href="/torrent/123/example/">Example Movie 1080p</a></td>
			<td class="seeds">12</td><td class="leeches">1</td><td class="size">1 GB</td>
		</tr></tbody></table>`)
		.mockResolvedValueOnce(`<a href="magnet:?xt=urn:btih:${infoHash}">Magnet</a>`);

	const result = await scrapeX1337xStreams(
		{ baseId: "tt1234567" },
		{ signal: null },
	);

	expect(result.streams).toHaveLength(1);
	expect(result.streams[0].infoHash).toBe(infoHash);
});
