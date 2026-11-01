# Changelog

## [0.0.4](https://github.com/solve4it/mycollections/compare/mycollections-v0.0.3...mycollections-v0.0.4) (2026-08-29)


### Bug Fixes

* **deps:** update all non-major dependencies ([#300](https://github.com/solve4it/mycollections/issues/300)) ([c4b129f](https://github.com/solve4it/mycollections/commit/c4b129f1e9fad88476b80c9ab2856b023f26ba37))

## [0.0.3](https://github.com/solve4it/mycollections/compare/mycollections-v0.0.2...mycollections-v0.0.3) (2026-08-22)


### Bug Fixes

* **docs-site:** fail the build when a doc is published empty or never reaches the site ([#298](https://github.com/solve4it/mycollections/issues/298)) ([6f845bb](https://github.com/solve4it/mycollections/commit/6f845bbc10b76355d0e6bca34ff3b83df62aa708))
* **docs-site:** rewrite relative Markdown links so they stop 404ing on the published site ([#293](https://github.com/solve4it/mycollections/issues/293)) ([87da1cd](https://github.com/solve4it/mycollections/commit/87da1cd10399203d5c14d5e1e6257fd7401ae4b2))
* **web:** keep the API token usable where the browser refuses to store it ([#297](https://github.com/solve4it/mycollections/issues/297)) ([ff33f14](https://github.com/solve4it/mycollections/commit/ff33f14c808d755b77cde64a750ed33de84493d8))

## [0.0.2](https://github.com/solve4it/mycollections/compare/mycollections-v0.0.1...mycollections-v0.0.2) (2026-08-22)


### Features

* **api,db:** edit a collection's field schema after creation ([#197](https://github.com/solve4it/mycollections/issues/197) part 1) ([#287](https://github.com/solve4it/mycollections/issues/287)) ([5cecf76](https://github.com/solve4it/mycollections/commit/5cecf769893c3897d6db1c15cb5344585f20a54f))
* **web:** collection editor — change a collection's fields after creation ([#197](https://github.com/solve4it/mycollections/issues/197) part 2) ([#288](https://github.com/solve4it/mycollections/issues/288)) ([dfc60a8](https://github.com/solve4it/mycollections/commit/dfc60a8fb40dd6c9982b5c1d83fb5c6db1682a4f))


### Bug Fixes

* **deps:** update all non-major dependencies ([#289](https://github.com/solve4it/mycollections/issues/289)) ([da523a7](https://github.com/solve4it/mycollections/commit/da523a724eb8e3a4c80327a0c2405839c84508c9))

## 0.0.1 (2026-08-16)


### Features

* **api,web:** data export / import (JSON backup & restore) [#189](https://github.com/solve4it/mycollections/issues/189) ([#190](https://github.com/solve4it/mycollections/issues/190)) ([949d2ea](https://github.com/solve4it/mycollections/commit/949d2eaef6d4d840dc3a03a637ab3701938d0737))
* **api:** empty the trash on demand ([#33](https://github.com/solve4it/mycollections/issues/33) part 3) ([#283](https://github.com/solve4it/mycollections/issues/283)) ([48b0311](https://github.com/solve4it/mycollections/commit/48b031107c2d744338fad9561781928d9cb953cd))
* **api:** trash listing, item restore, and permanent delete ([#33](https://github.com/solve4it/mycollections/issues/33) part 1) ([#281](https://github.com/solve4it/mycollections/issues/281)) ([4439e98](https://github.com/solve4it/mycollections/commit/4439e98c71ce70627a2a8cde10ed3d015f394de9))
* **auth:** OIDC AuthProvider with PKCE, secure store & seams ([#176](https://github.com/solve4it/mycollections/issues/176)) ([3cb519a](https://github.com/solve4it/mycollections/commit/3cb519a3bce2fe1ecc02a0f01a122e66c573fbea))
* **core:** add domain types, Zod schemas, and provider interfaces ([#160](https://github.com/solve4it/mycollections/issues/160)) ([ecc1c3c](https://github.com/solve4it/mycollections/commit/ecc1c3cf3d1d17108f9967569dd8e2f473829d3c))
* **db:** Drizzle schema, auto-migrations with pre-backup, and repository layer ([#179](https://github.com/solve4it/mycollections/issues/179)) ([6e72fbd](https://github.com/solve4it/mycollections/commit/6e72fbd63686b0bb4d86d6f207e2a8711be1fe52))
* Fastify API server ([#27](https://github.com/solve4it/mycollections/issues/27)), React web app shell ([#28](https://github.com/solve4it/mycollections/issues/28)), and i18n foundation ([#23](https://github.com/solve4it/mycollections/issues/23)) ([#180](https://github.com/solve4it/mycollections/issues/180)) ([ece03cd](https://github.com/solve4it/mycollections/commit/ece03cdc78812a88379891b2708b92ce66a6c441))
* observability foundation — pino logging + ErrorReporter ([#21](https://github.com/solve4it/mycollections/issues/21)) ([#215](https://github.com/solve4it/mycollections/issues/215)) ([1609408](https://github.com/solve4it/mycollections/commit/160940853514150a8f1e8b134d3f636dadb4763d))
* scaffold Starlight docs site and deploy to GitHub Pages [#12](https://github.com/solve4it/mycollections/issues/12) ([#119](https://github.com/solve4it/mycollections/issues/119)) ([2fd564d](https://github.com/solve4it/mycollections/commit/2fd564d1c4b08bc29bdf5bb79ee54aa84c6f5aaa))
* **web:** Cabinet & Paper design tokens + typography foundation ([#220](https://github.com/solve4it/mycollections/issues/220)) ([#229](https://github.com/solve4it/mycollections/issues/229)) ([f82d330](https://github.com/solve4it/mycollections/commit/f82d3306beae8f51919e28ee224129513b3c44d8))
* **web:** item CRUD with dynamic form generation ([#32](https://github.com/solve4it/mycollections/issues/32)) ([#184](https://github.com/solve4it/mycollections/issues/184)) ([54b38b0](https://github.com/solve4it/mycollections/commit/54b38b00a43ebbaba4443e1b16ea2ef1a2a7e1bf))
* **web:** onboarding ([#29](https://github.com/solve4it/mycollections/issues/29)), collections dashboard ([#30](https://github.com/solve4it/mycollections/issues/30)), collection creation UI ([#31](https://github.com/solve4it/mycollections/issues/31)) ([#181](https://github.com/solve4it/mycollections/issues/181)) ([8493a70](https://github.com/solve4it/mycollections/commit/8493a703d3d93d17bb4d3cb3657a531a7854620c))
* **web:** theming — light/dark/system with no flash of the wrong theme ([#278](https://github.com/solve4it/mycollections/issues/278)) ([fd40178](https://github.com/solve4it/mycollections/commit/fd40178f71d726ebcc8d4f9cf5fc4156304e5e8f))
* **web:** trash management in Settings ([#35](https://github.com/solve4it/mycollections/issues/35)) ([#284](https://github.com/solve4it/mycollections/issues/284)) ([21acdb7](https://github.com/solve4it/mycollections/commit/21acdb70c2b8c83a6bcdce3c2304f463e694746c))
* **web:** undo toast on item delete ([#33](https://github.com/solve4it/mycollections/issues/33) part 2) ([#282](https://github.com/solve4it/mycollections/issues/282)) ([9effe0d](https://github.com/solve4it/mycollections/commit/9effe0d360e4512430e3e05faa48c1a4cbe38887))


### Bug Fixes

* **api:** allow PATCH and DELETE through CORS so browser writes work [#200](https://github.com/solve4it/mycollections/issues/200) ([#201](https://github.com/solve4it/mycollections/issues/201)) ([5c34b5a](https://github.com/solve4it/mycollections/commit/5c34b5a95ba22527f3afb724522949bdc657e76f))
* **api:** anchor the default database path and log it on startup ([#186](https://github.com/solve4it/mycollections/issues/186)) ([#187](https://github.com/solve4it/mycollections/issues/187)) ([539703c](https://github.com/solve4it/mycollections/commit/539703ca0260bdc607d6e5b9a47b52d3ef4bf4e0))
* **api:** guard the bind address and pin browser origins to loopback ([#246](https://github.com/solve4it/mycollections/issues/246)) ([1a4575e](https://github.com/solve4it/mycollections/commit/1a4575e30b024b8d49cd081cd92756a9bdbf44d1))
* **api:** item PATCH ownership check before mutation + partial PATCH bodies ([#216](https://github.com/solve4it/mycollections/issues/216)) ([#217](https://github.com/solve4it/mycollections/issues/217)) ([a44e70c](https://github.com/solve4it/mycollections/commit/a44e70c2b0bd6e518c5e22d085996cb64c455ce1))
* **api:** make API server start on a fresh local checkout ([#182](https://github.com/solve4it/mycollections/issues/182)) ([#183](https://github.com/solve4it/mycollections/issues/183)) ([f3e8995](https://github.com/solve4it/mycollections/commit/f3e8995af13d785c911a27c78a203e8abd4c9a6d))
* **api:** protect routes by scope with @fastify/bearer-auth, not by path matching ([#245](https://github.com/solve4it/mycollections/issues/245)) ([bb46880](https://github.com/solve4it/mycollections/commit/bb46880fe7f5b32393ea4b7e3a6d5ef1357d04a6))
* **api:** warn when production falls back to a generated API_TOKEN ([#248](https://github.com/solve4it/mycollections/issues/248)) ([225a8f8](https://github.com/solve4it/mycollections/commit/225a8f866a147cb3b1ce873f0ba1ed2bb5bfdc17))
* biome migration ([#147](https://github.com/solve4it/mycollections/issues/147)) ([21149e3](https://github.com/solve4it/mycollections/commit/21149e34aa2b517a16dd6420b60c308ba6246b87))
* **db:** create the database, its sidecars, and backups owner-readable only ([#244](https://github.com/solve4it/mycollections/issues/244)) ([ad2a62a](https://github.com/solve4it/mycollections/commit/ad2a62aefcd228f6325ebcff90778da1f0c5f0f3))
* **deps:** update all non-major dependencies ([#144](https://github.com/solve4it/mycollections/issues/144)) ([fb375c5](https://github.com/solve4it/mycollections/commit/fb375c56c619e20e852d4efd72818e88d14683d2))
* **deps:** update all non-major dependencies ([#149](https://github.com/solve4it/mycollections/issues/149)) ([67164fa](https://github.com/solve4it/mycollections/commit/67164fa8c65f922e2348b1863940da7ac47dcf62))
* **deps:** update all non-major dependencies ([#152](https://github.com/solve4it/mycollections/issues/152)) ([7799f94](https://github.com/solve4it/mycollections/commit/7799f943b59796f42d200d2c25fbd558fd422708))
* **deps:** update all non-major dependencies ([#167](https://github.com/solve4it/mycollections/issues/167)) ([42d8bbd](https://github.com/solve4it/mycollections/commit/42d8bbde15b46c448ee1da78f0a2114ab75784d5))
* **deps:** update all non-major dependencies ([#206](https://github.com/solve4it/mycollections/issues/206)) ([1566470](https://github.com/solve4it/mycollections/commit/1566470ed2ab520ec0181c16b155cc8348828cc7))
* **deps:** update all non-major dependencies ([#209](https://github.com/solve4it/mycollections/issues/209)) ([25da965](https://github.com/solve4it/mycollections/commit/25da96570372c786238a4a85ea5b19df3bc0ee55))
* **deps:** update all non-major dependencies ([#213](https://github.com/solve4it/mycollections/issues/213)) ([a2b0904](https://github.com/solve4it/mycollections/commit/a2b09046dd39f2d448664187e05dcc244d56c188))
* **deps:** update all non-major dependencies ([#230](https://github.com/solve4it/mycollections/issues/230)) ([612dca6](https://github.com/solve4it/mycollections/commit/612dca698ac60b626b4420411f42564ec17e2b14))
* **deps:** update all non-major dependencies ([#267](https://github.com/solve4it/mycollections/issues/267)) ([0ea7088](https://github.com/solve4it/mycollections/commit/0ea70883588e50795cf6737dd8797b59649bb3bd))
* **deps:** update dependency @fastify/swagger-ui to v6 ([#207](https://github.com/solve4it/mycollections/issues/207)) ([3f658f1](https://github.com/solve4it/mycollections/commit/3f658f1c43ab5c66a5ba4d9faa2f4583aa8efe20))
* **deps:** update dependency @tanstack/react-query to ^5.101.2 ([#212](https://github.com/solve4it/mycollections/issues/212)) ([b130b33](https://github.com/solve4it/mycollections/commit/b130b335c6386c913111834c0073fa050d33104b))
* **deps:** update dependency better-sqlite3 to v13 ([#251](https://github.com/solve4it/mycollections/issues/251)) ([5d6e49a](https://github.com/solve4it/mycollections/commit/5d6e49a75106e9877656c86bb86eccd50768104d))
* **dev:** build and watch workspace packages so pnpm dev can't serve stale dist [#195](https://github.com/solve4it/mycollections/issues/195) ([#196](https://github.com/solve4it/mycollections/issues/196)) ([7a85acd](https://github.com/solve4it/mycollections/commit/7a85acd1ef6357c25929d5420be8938d61282af2))
* **docs:** serialize astro check before astro build to remove Vite race ([#166](https://github.com/solve4it/mycollections/issues/166)) ([d762ad8](https://github.com/solve4it/mycollections/commit/d762ad8745206cffed22cd01ed9ba496925beb32)), closes [#161](https://github.com/solve4it/mycollections/issues/161)
* drop matchPackageNames wildcard in Renovate grouping rule [#102](https://github.com/solve4it/mycollections/issues/102) ([#103](https://github.com/solve4it/mycollections/issues/103)) ([74b3788](https://github.com/solve4it/mycollections/commit/74b3788fbb63697a6322204bff22eb56752582f2))
* drop Renovate vuln-alert rule clobbering groupName [#108](https://github.com/solve4it/mycollections/issues/108) ([#109](https://github.com/solve4it/mycollections/issues/109)) ([bf8abce](https://github.com/solve4it/mycollections/commit/bf8abcee48438cec7902547f3d938e50add447a5))
* pin release-please-action to SHA ([#99](https://github.com/solve4it/mycollections/issues/99)) ([42f8e6d](https://github.com/solve4it/mycollections/commit/42f8e6d683034b095b1a60dcfecbefd508d919f8))
* use explicit groupName for Renovate non-major deps [#100](https://github.com/solve4it/mycollections/issues/100) ([#101](https://github.com/solve4it/mycollections/issues/101)) ([eb22bda](https://github.com/solve4it/mycollections/commit/eb22bdab3a9a64dddf5ed412e86c01a992e110c1))
* use group:allNonMajor preset for Renovate grouping ([#97](https://github.com/solve4it/mycollections/issues/97)) ([0cdf600](https://github.com/solve4it/mycollections/commit/0cdf600f35dcbc7251a28974abbd39704c4b61e0))
* **web:** announce and lock the settings import while it runs ([#261](https://github.com/solve4it/mycollections/issues/261)) ([a8d94c2](https://github.com/solve4it/mycollections/commit/a8d94c22fe50430547982594b05463b9f1be34bc))
* **web:** denied storage no longer takes out Settings or the error reporter ([#280](https://github.com/solve4it/mycollections/issues/280)) ([2f2ad96](https://github.com/solve4it/mycollections/commit/2f2ad96cb04b383c88aded94edbd38e5207b4779))
* **web:** don't send JSON Content-Type on requests with no body [#202](https://github.com/solve4it/mycollections/issues/202) ([#203](https://github.com/solve4it/mycollections/issues/203)) ([2d08ab6](https://github.com/solve4it/mycollections/commit/2d08ab67d1129743d65770e8c700ca4107fd5e14))
* **web:** recover from a stale API token instead of getting stuck ([#185](https://github.com/solve4it/mycollections/issues/185)) ([#188](https://github.com/solve4it/mycollections/issues/188)) ([bae0a6c](https://github.com/solve4it/mycollections/commit/bae0a6c755f31f771f9efd96c9445a93b702cd3a))
* **web:** show real item count on collection cards [#191](https://github.com/solve4it/mycollections/issues/191) ([#192](https://github.com/solve4it/mycollections/issues/192)) ([475114e](https://github.com/solve4it/mycollections/commit/475114ef10d4ebfbaca1bb1c69c7c1e45bd7869a))
* **web:** show the error state, not the empty state, when a collections query never loads ([#236](https://github.com/solve4it/mycollections/issues/236)) ([b6baa46](https://github.com/solve4it/mycollections/commit/b6baa463dfdcf99363ddfe9022fdccbe5f7c4fc6))
* **web:** stop the primary-button skin leaking into the nav ([#260](https://github.com/solve4it/mycollections/issues/260)) ([11633a4](https://github.com/solve4it/mycollections/commit/11633a4b598a8729b219bccc865eefd7c83aaed2))
* **web:** surface item create/update/delete failures ([#263](https://github.com/solve4it/mycollections/issues/263)) ([92bc185](https://github.com/solve4it/mycollections/commit/92bc185b6ad56f8b294af3c1f0933288757977f7))
