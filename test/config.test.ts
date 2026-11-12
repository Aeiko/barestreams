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
