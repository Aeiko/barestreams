# Jackett on Dokploy

Jackett runs as a **separate Compose service on the same server**. Barestreams queries its JSON API server-side. Configure and test public torrent indexers in Jackett; no new Barestreams scraper is needed for each supported indexer.

## Request flow

```text
Stremio -> HTTPS Barestreams -> existing scrapers + private Jackett API
                                      Jackett -> configured public indexers
                     <- normalized, deduplicated info-hash streams
```

The existing Redis cache, request deadline, zero-seeder filter, and tracker appending apply to Jackett results too. Existing scrapers run in parallel, not only when Jackett fails. An unavailable Jackett must not prevent their results from being returned.

## 1. Deploy the updated Barestreams service first

Keep `JACKETT_URL` and `JACKETT_API_KEY` blank initially. Deploy the standard `docker-compose.yml` from this fork. It creates a dedicated bridge network named `barestreams-indexers` and attaches Barestreams and Byparr to it. Both retain their existing deployment network; Redis stays on that deployment network only.

This is a same-Docker-host setup. It does not connect services on different servers. Do not mark this network `internal: true`: Jackett needs internet access to search indexers.

## 2. Deploy Jackett as a separate service

In Dokploy, create another **Compose** service, not an Application or Stack. Use this repository with Compose path `./docker-compose.jackett.yml`, or paste that file into a Raw Compose service.

The file uses the [LinuxServer Jackett image](https://docs.linuxserver.io/images/docker-jackett/), which supports ARM64, and stores configuration in a named Docker volume. It joins the existing `barestreams-indexers` network. The network must already exist from step 1.

Review Dokploy's generated/preview Compose configuration and confirm the external network is retained. Do not add a public domain or public port mapping. The provided port mapping binds `9117` to **127.0.0.1 only** for SSH-tunnel dashboard access. Do not open port 9117 in Oracle ingress rules.

`PUID`/`PGID` default to 1000; use the appropriate numeric IDs if your server requires different permissions. `TZ` defaults to `Etc/UTC`. Do not delete the `jackett-config` volume when redeploying.

## 3. Open Jackett privately

From PowerShell, replace the key path and server IP:

```powershell
ssh -i "C:\path\to\oracle.key" -N -L 9117:127.0.0.1:9117 ubuntu@YOUR_SERVER_IP
```

Keep that terminal open, then visit **http://localhost:9117**. If local port 9117 is occupied, use `-L 19117:127.0.0.1:9117` and browse to port 19117 instead.

Set an admin password in Jackett, add a few **public video/anime indexers**, and use Jackett's Test and manual search buttons before enabling the integration. Start with Nyaa.si (`nyaasi`). Add ExtraTorrent.st (`extratorrent-st`) only if it is offered and its test/search succeed in your installation. EXT.to is not guaranteed to be supported. RiveStream is a streaming frontend, not a Jackett torrent indexer.

For indexers that report "Challenge detected but FlareSolverr is not configured", scroll to Jackett Configuration, set **FlareSolverr API URL** to `http://flaresolverr:8191`, and click **Apply server settings**. This reuses the existing Byparr service through the shared network. Redeploy Barestreams after pulling the network configuration before testing this URL; `localhost:8191` inside Jackett would point to Jackett itself. No public port mapping or Oracle ingress rule is needed. Retry the indexer test and inspect Jackett/Byparr logs if it still fails; challenge solving is not guaranteed.

Copy the API key shown in Jackett. Do not paste it into Git, logs, screenshots, or a Stremio URL.

## 4. Enable the Barestreams connection

In the **Barestreams Compose service -> Environment**, set:

```dotenv
JACKETT_URL=http://jackett:9117
JACKETT_API_KEY=YOUR_REAL_KEY
JACKETT_INDEXERS=nyaasi
MAX_REQUEST_WAIT_SECONDS=45
```

The standard Compose file explicitly passes these variables into Barestreams. Save and redeploy **Barestreams**. The API key remains server-side. Use the base URL, not a copied Torznab feed URL. Subpath installations can use a base such as `https://trusted-host.example/jackett`.

`JACKETT_INDEXERS` contains comma-separated **IDs**, not display names. Leave it blank to search all configured indexers; prefer a small set of tested public video sources. Jackett calls have a 30-second timeout, while the global deadline bounds all scraper work including a possible fallback query. Setting the global deadline above 30 seconds gives slower sources more time than the original 15-second default, but does not guarantee a result.

If using the VPN or another Compose file instead of the standard file, explicitly pass these environment variables and configure connectivity yourself. The separate Jackett service is **not** routed through Gluetun by these examples.

## 5. Verify

Open a movie or a specific show episode in Stremio. Returned Jackett streams display `Jackett / <indexer name>`. Barestreams' `[stream]` log summarizes result counts and sources; `[scraper] Jackett` warnings indicate HTTP/search failures or no usable results. Inspect Jackett's own logs/UI for individual indexer failures, even when its API returns HTTP 200.

Existing non-empty Redis entries can remain cached for the configured TTL (168 hours in the standard Compose file). Test an uncached title/episode first. Empty results are not cached by Barestreams. Jackett has its own caching too.

## Intentional limits

- **Only validated BTIH hashes/magnets are returned.** Results that expose only a `.torrent`/Jackett download URL are skipped. Barestreams never follows those URLs or exposes their API keys. This can exclude otherwise usable results from some indexers.
- Private tracker authentication and passkeys are not supported. Upstream magnet trackers are not forwarded; Barestreams' existing tracker configuration is applied instead.
- Release titles must contain the normalized IMDb primary title and, for movies with a known year, that year. Unsupported aliases and year-less movie releases can therefore be excluded.
- Episode matching requires a single `SxxExx` / `NxM` tag for the requested episode and rejects recognized ranges/pack markers. Absolute-numbered anime releases, title aliases, and season-to-absolute mapping need a separate, tested implementation. Jackett alone does not solve that.
- Season packs without a confident episode match are skipped; there is no torrent-file inspection or episode `fileIdx` selection.
- Changing indexers/domains in Jackett reduces local scraper maintenance but does not guarantee source availability, challenge solving, or matching content.
- The examples use `latest`, so deployment can change the Jackett image version. Pin a tested image tag/digest if you require reproducible deployments.

## Sources

- [Jackett JSON search API implementation](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Server/Controllers/ResultsController.cs)
- [LinuxServer Jackett installation](https://docs.linuxserver.io/images/docker-jackett/)
- [Docker Compose cross-project networking](https://docs.docker.com/compose/how-tos/networking/)
- [Dokploy Compose networking](https://docs.dokploy.com/docs/core/docker-compose/domains)
