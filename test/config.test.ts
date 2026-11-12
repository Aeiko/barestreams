import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
	it.each([
		[undefined, 10],
		["0", 0],
		["1", 1],
		["10", 10],
		["-1", 10],
		["invalid", 10],
	])("parses FLARESOLVERR_SESSIONS=%s as %i", async (raw, expected) => {
		if (raw === undefined) {
			delete process.env.FLARESOLVERR_SESSIONS;
		} else {
			process.env.FLARESOLVERR_SESSIONS = raw;
		}
		const { loadConfig } = await import("../src/config.js");

		expect(loadConfig().flareSolverrSessions).toBe(expected);
	});

	it("leaves Jackett disabled when unconfigured", async () => {
		delete process.env.JACKETT_URL;
		delete process.env.JACKETT_API_KEY;
		delete process.env.JACKETT_INDEXERS;
		const { loadConfig } = await import("../src/config.js");

		expect(loadConfig()).toMatchObject({
			jackettUrl: null,
			jackettApiKey: null,
			jackettIndexers: [],
		});
	});

	it("loads the Jackett connection and selected indexers", async () => {
		process.env.JACKETT_URL = " http://jackett:9117/ ";
		process.env.JACKETT_API_KEY = " example-key ";
		process.env.JACKETT_INDEXERS = "nyaasi, extratorrent-st";
		const { loadConfig } = await import("../src/config.js");

		expect(loadConfig()).toMatchObject({
			jackettUrl: "http://jackett:9117",
			jackettApiKey: "example-key",
			jackettIndexers: ["nyaasi", "extratorrent-st"],
		});
	});

	it.each(["ftp://jackett", "http://user:password@jackett", "not-a-url", "http://jackett?apikey=secret"])(
		"rejects invalid Jackett URL %s without exposing its value", async (url) => {
			process.env.JACKETT_URL = url;
			process.env.JACKETT_API_KEY = "example-key";
			const { loadConfig } = await import("../src/config.js");

			expect(() => loadConfig()).toThrow("JACKETT_URL must be an HTTP(S) base URL without credentials, query or fragment");
		},
	);

	it("rejects an incomplete Jackett connection", async () => {
		process.env.JACKETT_URL = "http://jackett:9117";
		delete process.env.JACKETT_API_KEY;
		const { loadConfig } = await import("../src/config.js");

		expect(() => loadConfig()).toThrow("Set both JACKETT_URL and JACKETT_API_KEY");
	});

	it("defaults tracker appending to enabled with no custom source", async () => {
		delete process.env.USE_TRACKERSLIST;
		delete process.env.CUSTOM_TRACKERS;
		const { loadConfig } = await import("../src/config.js");

		expect(loadConfig().useTrackerslist).toBe(true);
		expect(loadConfig().customTrackerSource).toBeNull();
	});

	it("parses explicit tracker disable", async () => {
		process.env.USE_TRACKERSLIST = "false";
		const { loadConfig } = await import("../src/config.js");

		expect(loadConfig().useTrackerslist).toBe(false);
	});

	it("accepts a custom tracker source string", async () => {
		process.env.CUSTOM_TRACKERS =
			"udp://one.example:80/announce,udp://two.example:80/announce";
		const { loadConfig } = await import("../src/config.js");

		expect(loadConfig().customTrackerSource).toBe(
			"udp://one.example:80/announce,udp://two.example:80/announce",
		);
	});
});
