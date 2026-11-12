import { describe, expect, it } from "vitest";
import { extractQualityHint } from "../src/streams/quality.js";

describe("extractQualityHint", () => {
	it("normalizes 4k and uhd to 2160p", () => {
		expect(extractQualityHint("Movie 4K HDR")).toBe("2160p");
		expect(extractQualityHint("Movie UHD")).toBe("2160p");
	});

	it.each([
		["Tensei Shitara Ken Deshita (SHQ) ABEMA 4K to 1080p HEVC E-OPUS HR-DR", "1080p"],
		["Movie 2160p to 1080p HEVC", "1080p"],
		["Movie UHD to 720p", "720p"],
		["Movie.4K.to.1080p.WEB", "1080p"],
		["Movie 1080p to 720p", "720p"],
		["Movie 1080p to 4K", "2160p"],
		["Movie 1080p WEB", "1080p"],
	])("uses the output resolution in %s", (title, expected) => {
		expect(extractQualityHint(title)).toBe(expected);
	});

	it("returns null when no quality is present", () => {
		expect(extractQualityHint("Movie Release")).toBeNull();
	});
});
