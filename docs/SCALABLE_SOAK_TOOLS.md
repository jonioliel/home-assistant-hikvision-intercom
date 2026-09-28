# Fleet and loopback resilience tools

There is no fixed nine-station acceptance condition. Select an explicit resource
budget for the actual installation, and interpret results within that budget.

## Read-only fleet observation

`python -m tools.fleet_soak --config PRIVATE.json --seconds 300 --interval 5
--concurrency 8 --station-budget 256 --output PRIVATE-new-report.json`

The private JSON configuration contains a `stations` array of existing connection
settings. Do not commit that file or a raw protocol trace. Configuration is
validated before network I/O, capped at 2 MiB, and duplicate host/scheme/port
endpoints are rejected. Station budget accepts 1–4096 and concurrency 1–64;
the selected array must fit the declared budget. Reports use ordinal stations,
not credentials/addresses/raw exceptions. Output files are created exclusively,
so an existing configuration or observation cannot be overwritten accidentally.

Read concurrency is bounded across the fleet. Each read and the complete run
have deadlines. Time spent waiting for a worker is separate from request timing.
`sampled: false` and `all_stations_sampled: false` mean incomplete observation,
not an available/healthy station. A station failure is isolated from its peers.
This tool opens no lock and uploads no audio or credential change.

## Local protocol simulator

`python -m tests.soak.run_audio --seconds 60 --stations 12 --station-budget 128
--media-budget 3 --poll-concurrency 8 --event-budget 512 --output NEW-report.json`

This runner creates loopback mock stations only. It never takes installation
credentials. It exercises actual client/queue/parser paths for media sessions,
slow-reader overflow, upload failure, offline credential-revocation recovery,
fragmented events, duplicate events and replay after a simulated restart. Its
media session, event-cache, polling and peer-task limits are explicit. The chosen
12-station example is a sample size, not a system requirement or capacity promise.

The automated suite covers 1, 4 and 12 mock stations. A successful run establishes
bounded recovery in the simulator. It does not certify camera decoders, hardware
capacity, real network jitter, physical credential denial or audible speech.
Observe the actual installation separately before deriving a deployment limit.
