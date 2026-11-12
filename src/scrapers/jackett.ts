import { config } from "../config.js";
import { parseMagnet } from "../parsing/magnet.js";
import type { ParsedStremioId } from "../parsing/stremioId.js";
import { formatStreamDisplay } from "../streams/display.js";
import type { Stream, StreamResponse } from "../types.js";
import { shouldAbort, type ScrapeContext } from "./context.js";
import { logScraperWarning } from "./logging.js";
import { buildQueries, matchesEpisode, normalizeQuery } from "./query.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const isSingleEpisode = (title: string, parsed: ParsedStremioId): boolean => {
	const tags = Array.from(title.matchAll(
		/(?<![a-z0-9])(?:S\d{1,2}E\d{1,2}|\d{1,2}x\d{1,2})(?!\d)/gi,
	));
	if (tags.length !== 1) return false;
	const suffix = title.slice(tags[0].index + tags[0][0].length);
	const range = /^[\s._]*(?:[-+&]\s*E?|E|(?:to|through)\s*E?)[\s._]*\d{1,3}(?!\d)/i;
	return (
		!range.test(suffix) && !/\b(?:complete|batch|pack)\b/i.test(title) &&
		matchesEpisode(tags[0][0], parsed.season, parsed.episode)
	);
};

export const scrapeJackettStreams = async (
	parsed: ParsedStremioId,
	type: "movie" | "series",
	context: ScrapeContext,
): Promise<StreamResponse> => {
	const { jackettUrl, jackettApiKey } = config;
	if (
		!jackettUrl || !jackettApiKey || shouldAbort(context) ||
		(type === "series" && (!parsed.season || !parsed.episode))
	) {
		return { streams: [] };
	}
	const { baseTitle, query, fallbackQuery } = await buildQueries(parsed);
	const titleQuery = normalizeQuery(baseTitle).toLowerCase();
	const yearSuffix = type === "movie" ? query.slice(normalizeQuery(baseTitle).length).trim() : "";
	const movieYear = /^\d{4}$/.test(yearSuffix) ? yearSuffix : null;
	const search = async (searchQuery: string): Promise<Stream[] | null> => {
		if (shouldAbort(context)) return [];
		const url = new URL(`${jackettUrl}/api/v2.0/indexers/all/results`);
		url.searchParams.set("apikey", jackettApiKey);
		url.searchParams.set("Query", searchQuery.slice(0, 300));
		url.searchParams.append("Category[]", type === "movie" ? "2000" : "5000");
		for (const indexer of config.jackettIndexers) {
			url.searchParams.append("Tracker[]", indexer);
		}
		const timeout = AbortSignal.timeout(30_000);
		const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
		try {
			const response = await fetch(url, { signal, redirect: "error" });
			if (!response.ok) {
				await response.body?.cancel();
				logScraperWarning("Jackett", "search failed", { status: response.status });
				return null;
			}
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Empty response");
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					bytes += value.byteLength;
					if (bytes > MAX_RESPONSE_BYTES) {
						await reader.cancel();
						throw new Error("Response too large");
					}
					chunks.push(value);
				}
			} finally {
				reader.releaseLock();
			}
			const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			if (!payload || !Array.isArray(payload.Results)) throw new Error("Invalid response");
			const streams: Stream[] = [];
			const seen = new Set<string>();
			for (const entry of payload.Results.slice(0, 200)) {
				if (!entry || typeof entry !== "object" || typeof entry.Title !== "string") continue;
				const title = entry.Title.trim().slice(0, 500);
				const normalizedTitle = ` ${normalizeQuery(title).toLowerCase()} `;
				if (
					!title || !normalizedTitle.includes(` ${titleQuery} `) ||
					(movieYear && !normalizedTitle.includes(` ${movieYear} `)) ||
					(type === "series" && !isSingleEpisode(title, parsed))
				) continue;
				const magnetUri = typeof entry.MagnetUri === "string" ? entry.MagnetUri : entry.Link;
				const magnet = typeof magnetUri === "string" ? parseMagnet(magnetUri) : null;
				const hash =
					typeof entry.InfoHash === "string" &&
					/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(entry.InfoHash)
						? parseMagnet(`magnet:?xt=urn:btih:${entry.InfoHash}`)?.infoHash
						: undefined;
				if (hash && magnet && hash !== magnet.infoHash) continue;
				const infoHash = magnet?.infoHash ?? hash;
				if (!infoHash || seen.has(infoHash)) continue;
				const seeders =
					typeof entry.Seeders === "number" &&
					Number.isFinite(entry.Seeders) && entry.Seeders >= 0
						? entry.Seeders : undefined;
				if (seeders === 0) continue;
				seen.add(infoHash);
				const sizeBytes =
					typeof entry.Size === "number" &&
					Number.isSafeInteger(entry.Size) && entry.Size > 0
						? entry.Size : null;
				const tracker = typeof entry.Tracker === "string"
					? entry.Tracker.replace(/[\r\n]/g, " ").slice(0, 80) : "Unknown";
				const display = formatStreamDisplay({
					imdbTitle: baseTitle,
					season: parsed.season,
					episode: parsed.episode,
					torrentName: title,
					source: `Jackett / ${tracker}`,
					seeders,
					sizeBytes,
				});
				// Never expose Jackett download URLs, API keys, or upstream tracker credentials.
				streams.push({
					name: display.name,
					description: display.description,
					infoHash,
					seeders,
				});
			}
			return streams;
		} catch {
			if (!shouldAbort(context)) logScraperWarning("Jackett", "search failed or returned invalid data");
			return null;
		}
	};

	let streams = await search(query);
	if (streams?.length === 0 && fallbackQuery && fallbackQuery !== query && !shouldAbort(context)) {
		streams = await search(fallbackQuery);
	}
	if (streams?.length === 0 && !shouldAbort(context)) {
		logScraperWarning("Jackett", "no usable magnet/hash results", { type, imdbId: parsed.baseId });
	}
	return { streams: streams ?? [] };
};
