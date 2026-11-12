import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAddonInterface } from "../src/addon.js";
import { scrapeJackettStreams } from "../src/scrapers/jackett.js";
import { scrapeYtsStreams } from "../src/scrapers/yts.js";

vi.mock("../src/cache/redis.js", () => ({ getCache: async () => null, setCache: async () => {} }));
vi.mock("../src/imdb/index.js", () => ({ getTitleBasics: async () => ({ primaryTitle: "Example Title" }) }));
vi.mock("../src/trackers/index.js", () => ({ appendTrackersToStream: (stream: unknown) => stream }));
vi.mock("../src/scrapers/jackett.js", () => ({ scrapeJackettStreams: vi.fn() }));
vi.mock("../src/scrapers/yts.js", () => ({ scrapeYtsStreams: vi.fn() }));
vi.mock("../src/scrapers/eztv.js", () => ({ scrapeEztvStreams: async () => ({ streams: [] }) }));
vi.mock("../src/scrapers/torrentGalaxy.js", () => ({ scrapeTorrentGalaxyStreams: async () => ({ streams: [] }) }));
vi.mock("../src/scrapers/pirateBay.js", () => ({ scrapePirateBayStreams: async () => ({ streams: [] }) }));
vi.mock("../src/scrapers/kickass.js", () => ({ scrapeKickassStreams: async () => ({ streams: [] }) }));
vi.mock("../src/scrapers/x1337x.js", () => ({ scrapeX1337xStreams: async () => ({ streams: [] }) }));

const stream = { infoHash: "abcdef0123456789abcdef0123456789abcdef01", seeders: 5 };

beforeEach(() => {
	vi.mocked(scrapeYtsStreams).mockResolvedValue({ streams: [] });
	vi.mocked(scrapeJackettStreams).mockResolvedValue({ streams: [stream] });
	vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it.each([
	["movie", "tt1234567"],
	["series", "tt1234567:1:3"],
])("includes Jackett in the %s stream pipeline", async (type, id) => {
	const result = await createAddonInterface().get("stream", type, id);
	expect(result.streams).toHaveLength(1);
	expect(result.streams[0].infoHash).toBe(stream.infoHash);
	expect(result.streams[0].seeders).toBeUndefined();
	expect(scrapeJackettStreams).toHaveBeenCalledWith(
		expect.objectContaining({ baseId: "tt1234567" }), type, expect.anything(),
	);
});

it("deduplicates Jackett results against existing scrapers", async () => {
	vi.mocked(scrapeYtsStreams).mockResolvedValueOnce({ streams: [stream] });
	const result = await createAddonInterface().get("stream", "movie", "tt1234567");
	expect(result.streams).toHaveLength(1);
});

it("does not let a zero-seeder Jackett duplicate hide an existing seeded result", async () => {
	vi.mocked(scrapeJackettStreams).mockResolvedValueOnce({ streams: [{ ...stream, seeders: 0 }] });
	vi.mocked(scrapeYtsStreams).mockResolvedValueOnce({ streams: [stream] });
	const result = await createAddonInterface().get("stream", "movie", "tt1234567");
	expect(result.streams).toHaveLength(1);
});

it("keeps existing results when Jackett fails", async () => {
	vi.mocked(scrapeYtsStreams).mockResolvedValueOnce({ streams: [stream] });
	vi.mocked(scrapeJackettStreams).mockRejectedValueOnce(new Error("offline"));
	const result = await createAddonInterface().get("stream", "movie", "tt1234567");
	expect(result.streams[0].infoHash).toBe(stream.infoHash);
});
