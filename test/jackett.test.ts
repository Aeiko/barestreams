import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { scrapeJackettStreams } from "../src/scrapers/jackett.js";
import { buildQueries } from "../src/scrapers/query.js";

vi.mock("../src/scrapers/query.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/scrapers/query.js")>()),
	buildQueries: vi.fn(async () => ({
		baseTitle: "Example Show",
		query: "Example Show S01E03",
		fallbackQuery: "Example Show",
		episodeSuffix: "S01E03",
	})),
}));

const originalConfig = { ...config };
const hash = "abcdef0123456789abcdef0123456789abcdef01";
const magnet = `magnet:?xt=urn:btih:${hash}&tr=udp%3A%2F%2Ftracker.example%3A80%2Fannounce`;
const parsed = { baseId: "tt1234567", season: 1, episode: 3 };
const context = { signal: null };
const release = {
	Title: "Example.Show.S01E03.1080p.WEB.mkv",
	MagnetUri: magnet,
	Tracker: "Nyaa.si",
	Seeders: 12,
	Size: 1024 ** 3,
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	Object.assign(config, {
		jackettUrl: "http://jackett:9117",
		jackettApiKey: "test-secret-key",
		jackettIndexers: ["nyaasi", "extratorrent-st"],
	});
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	Object.assign(config, originalConfig);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	fetchMock.mockReset();
});

const respond = (results: unknown[]) => new Response(JSON.stringify({ Results: results, Indexers: [] }));

describe("Jackett scraper", () => {
	it("is opt-in and does not fetch when disabled or cancelled", async () => {
		config.jackettUrl = null;
		expect(await scrapeJackettStreams(parsed, "series", context)).toEqual({ streams: [] });
		config.jackettUrl = "http://jackett:9117";
		expect(await scrapeJackettStreams(parsed, "series", { signal: AbortSignal.abort() })).toEqual({ streams: [] });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("queries selected indexers and converts a magnet without exposing the API key", async () => {
		fetchMock.mockResolvedValueOnce(respond([release]));
		const result = await scrapeJackettStreams(parsed, "series", context);
		const [input, options] = fetchMock.mock.calls[0];
		const url = new URL(String(input));
		expect(url.pathname).toBe("/api/v2.0/indexers/all/results");
		expect(url.searchParams.get("apikey")).toBe("test-secret-key");
		expect(url.searchParams.get("Query")).toBe("Example Show S01E03");
		expect(url.searchParams.getAll("Tracker[]")).toEqual(["nyaasi", "extratorrent-st"]);
		expect(options?.redirect).toBe("error");
		expect(result.streams).toHaveLength(1);
		expect(result.streams[0]).toMatchObject({ infoHash: hash, seeders: 12 });
		expect(result.streams[0].sources).toBeUndefined();
		expect(url.searchParams.getAll("Category[]")).toEqual(["5000"]);
		expect(result.streams[0].description).toContain("Jackett / Nyaa.si");
		expect(JSON.stringify(result)).not.toContain("test-secret-key");
		expect(result.streams[0].url).toBeUndefined();
	});

	it("accepts InfoHash or magnet Link, deduplicates, and ignores download URLs and malformed entries", async () => {
		fetchMock.mockResolvedValueOnce(respond([
			release,
			{ ...release, MagnetUri: null, InfoHash: hash.toUpperCase() },
			{ ...release, MagnetUri: null, Link: magnet },
			{ ...release, MagnetUri: null, Link: "http://jackett:9117/download?apikey=test-secret-key" },
			{ ...release, MagnetUri: null, InfoHash: "not-a-hash" },
			{ ...release, Title: 123 }, null, "bad",
		]));
		const result = await scrapeJackettStreams(parsed, "series", context);
		expect(result.streams).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(result)).not.toContain("apikey");
	});

	it("rejects conflicting hashes and malformed metadata", async () => {
		fetchMock.mockResolvedValueOnce(respond([
			{ ...release, InfoHash: "1234567890123456789012345678901234567890" },
			{ ...release, Seeders: "12", Size: "1000", Tracker: { bad: true } },
		]));
		const result = await scrapeJackettStreams(parsed, "series", context);
		expect(result.streams).toHaveLength(1);
		expect(result.streams[0].seeders).toBeUndefined();
	});

	it("rejects unrelated titles and keeps a seeded duplicate from another indexer", async () => {
		fetchMock.mockResolvedValueOnce(respond([
			{ ...release, Title: "Different.Show.S01E03.1080p" },
			{ ...release, Seeders: 0 },
			release,
		]));
		const result = await scrapeJackettStreams(parsed, "series", context);
		expect(result.streams).toHaveLength(1);
		expect(result.streams[0].seeders).toBe(12);
		expect(result.streams[0].description).not.toContain("Different");
	});

	it("searches movies with the movie category", async () => {
		vi.mocked(buildQueries).mockResolvedValueOnce({
			baseTitle: "Example Movie", query: "Example Movie 2025", fallbackQuery: "Example Movie", episodeSuffix: null,
		});
		fetchMock.mockResolvedValueOnce(respond([
			{ ...release, Title: "Unrelated Movie 2025 1080p" },
			{ ...release, Title: "Example Movie 1999 1080p" },
			{ ...release, Title: "Example Movie 2025 1080p" },
		]));
		const result = await scrapeJackettStreams({ baseId: "tt1234567" }, "movie", context);
		expect(result.streams).toHaveLength(1);
		expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.getAll("Category[]")).toEqual(["2000"]);
		expect(result.streams[0].description).not.toContain("Unrelated");
		expect(result.streams[0].description).toContain("2025");
	});

	it("does not mistake video dimensions for a second episode token", async () => {
		fetchMock.mockResolvedValueOnce(respond([{ ...release, Title: "Example.Show.S01E03.1920x1080.WEB" }]));
		expect((await scrapeJackettStreams(parsed, "series", context)).streams).toHaveLength(1);
	});

	it("rejects oversized response bodies", async () => {
		fetchMock.mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1)));
		vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await scrapeJackettStreams(parsed, "series", context)).toEqual({ streams: [] });
	});

	it("rejects other episodes and season packs and retries using the base title", async () => {
		fetchMock.mockResolvedValueOnce(respond([
			{ ...release, Title: "Example.Show.S01E04.1080p" },
			{ ...release, Title: "Example.Show.S01.Complete.1080p" },
			{ ...release, Title: "Example.Show.S01E03-E04.1080p" },
			{ ...release, Title: "Example.Show.S01E03E04.1080p" },
			{ ...release, Title: "Example.Show.S01E03.S01E04.1080p" },
			{ ...release, Title: "Example.Show.S01E03.Complete.Batch.1080p" },
			{ ...release, Title: "Example.Show.S01E03 to E10.1080p" },
		])).mockResolvedValueOnce(respond([release]));
		const result = await scrapeJackettStreams(parsed, "series", context);
		expect(result.streams).toHaveLength(1);
		expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("Query")).toBe("Example Show");
	});

	it.each([
		new Response("unauthorized", { status: 401 }),
		new Response("bad gateway", { status: 502 }),
		new Response("not JSON"),
		new Response(JSON.stringify({ Results: "bad" })),
	])("fails softly on invalid API responses without logging secrets", async (response) => {
		fetchMock.mockResolvedValueOnce(response);
		const log = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await scrapeJackettStreams(parsed, "series", context)).toEqual({ streams: [] });
		expect(log).toHaveBeenCalled();
		expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret-key");
	});

	it("handles network errors without logging credential-bearing exception messages", async () => {
		fetchMock.mockRejectedValueOnce(new Error("request failed ?apikey=test-secret-key"));
		const log = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await scrapeJackettStreams(parsed, "series", context)).toEqual({ streams: [] });
		expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret-key");
	});

	it("times out a stalled Jackett request after 30 seconds without retrying", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), milliseconds);
			return controller.signal;
		});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
			options!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
		}));
		try {
			const result = scrapeJackettStreams(parsed, "series", context);
			await vi.advanceTimersByTimeAsync(30_001);
			expect(await result).toEqual({ streams: [] });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops reading the body when the shared deadline cancels the request", async () => {
		const controller = new AbortController();
		fetchMock.mockImplementationOnce(async (_input, options) => new Response(new ReadableStream({
			start(body) {
				options!.signal!.addEventListener("abort", () => body.error(new DOMException("aborted", "AbortError")), { once: true });
				body.enqueue(new TextEncoder().encode('{"Results":['));
				queueMicrotask(() => controller.abort());
			},
		})));
		expect(await scrapeJackettStreams(parsed, "series", { signal: controller.signal })).toEqual({ streams: [] });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("propagates cancellation to an in-flight request", async () => {
		const controller = new AbortController();
		fetchMock.mockImplementationOnce(async (_input, options) => {
			controller.abort();
			expect(options?.signal?.aborted).toBe(true);
			throw new DOMException("aborted", "AbortError");
		});
		expect(await scrapeJackettStreams(parsed, "series", { signal: controller.signal })).toEqual({ streams: [] });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
