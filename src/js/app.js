import { initControlsSheet } from './controls-sheet.js';
import { initSearchCombobox } from './search.js';

		const DEFAULT = { lat: 1.283, lon: 103.860 };
		const DEFAULT_RADIUS = 200;
		const L = window.L;
		if (!L) {
			throw new Error('Leaflet failed to load');
		}

		function zoomForRadius(radius) {
			const metres = Number(radius) || DEFAULT_RADIUS;
			if (metres <= 150) return 18;
			if (metres <= 300) return 17;
			if (metres <= 500) return 16;
			if (metres <= 900) return 15;
			if (metres <= 1400) return 14;
			return 13;
		}

		// --- Map tile configuration -------------------------------------------------
		// The default OpenStreetMap tiles are FREE FOR HOBBY USE ONLY. The OSMF tile
		// policy (https://operations.osmfoundation.org/policies/tiles/) forbids heavy
		// or commercial use and a business app will be rate-limited / blocked.
		//
		// For business use, sign up with a paid tile provider (MapTiler, Mapbox,
		// Stadia Maps, Thunderforest, ...) and fill in TILE_CONFIG below. Set
		// `provider: 'custom'`, paste the provider's tile URL template (with your key)
		// into `url`, and put the provider's required attribution into `attribution`.
		const TILE_CONFIG = {
			provider: 'osm', // 'osm' (free, hobby only) | 'custom' (paid, business-safe)

			// Used only when provider === 'custom'. Example (MapTiler):
			//   url: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY',
			//   attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors',
			url: '',
			attribution: '',
			maxZoom: 19
		};

		const TILE_PRESETS = {
			osm: {
				url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
				maxZoom: 19
			}
		};

		const tile = TILE_CONFIG.provider === 'custom' && TILE_CONFIG.url
			? TILE_CONFIG
			: TILE_PRESETS.osm;

		// Bus-stop data attribution (Singapore Open Data Licence) is always required.
		const DATA_ATTRIBUTION = 'Data &copy; <a href="https://datamall.lta.gov.sg/" title="LTA DataMall, Singapore Open Data Licence">LTA</a>';

		const map = L.map('map', {
			zoomControl: false,
			attributionControl: true,
			doubleClickZoom: true,
			touchZoom: true,
			tap: false
		}).setView([DEFAULT.lat, DEFAULT.lon], zoomForRadius(DEFAULT_RADIUS));
		map.attributionControl.setPrefix(false);
		map.attributionControl.addAttribution(DATA_ATTRIBUTION);
		L.control.zoom({ position: 'topright' }).addTo(map);
		L.tileLayer(tile.url, {
			attribution: tile.attribution,
			maxZoom: tile.maxZoom || 19,
			crossOrigin: true
		}).addTo(map);

		// Enhanced visual elements
		const circle = L.circle([DEFAULT.lat, DEFAULT.lon], {
			radius: DEFAULT_RADIUS,
			color: '#4f46e5',
			fillColor: '#4f46e5',
			fillOpacity: 0.1,
			weight: 2,
			dashArray: '10, 10'
		}).addTo(map);

		const stopLayer = L.layerGroup().addTo(map);
		let userMarker = null, userPos = null, busStopsData = [], isLoadingBusStops = false;

		// Performance optimization: Debounce radius changes
		let radiusTimeout, searchTimeout;
		const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
		const SEARCH_RESULT_LIMIT = 20;
		const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
		const SEARCH_BOUNDING_BOX = {
			south: 1.15,
			north: 1.48,
			west: 103.55,
			east: 104.1
		};
		const busStopsCache = new Map();

		// Enhanced retry and fallback system
		let retryCount = 0;
		const MAX_RETRIES = 3;
		const RETRY_DELAYS = [1000, 2000, 4000]; // Progressive delays
		let lastApiCall = 0;
		const API_RATE_LIMIT = 1000; // Minimum 1 second between API calls

		function escapeQueryForRegex(query) {
			return query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
		}

		function buildOverpassSearchQuery(query) {
			const trimmed = query.trim().slice(0, 80);
			const tokens = trimmed.split(/\s+/).filter(Boolean);

			let pattern = '.*';
			if (tokens.length) {
				const regexTokens = tokens.map(token => {
					const escaped = escapeQueryForRegex(token);
					if (token.length > 3) {
						return `${escaped}\\w*`;
					}
					return escaped;
				});
				pattern = `.*${regexTokens.join('.*')}.*`;
			}

			const safePattern = pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
			const { south, west, north, east } = SEARCH_BOUNDING_BOX;
			const body = `
				[out:json][timeout:25];
				(
				  node["name"~"${safePattern}", i](${south}, ${west}, ${north}, ${east});
				  way["name"~"${safePattern}", i](${south}, ${west}, ${north}, ${east});
				  relation["name"~"${safePattern}", i](${south}, ${west}, ${north}, ${east});
				);
				out center ${SEARCH_RESULT_LIMIT};
			`;

			return {
				body: body.trim(),
				pattern,
				tokens
			};
		}

		function extractCoordinates(item) {
			if (!item) return null;
			if (typeof item.lat === 'number' && typeof item.lon === 'number') {
				return { lat: item.lat, lon: item.lon };
			}
			if (item.center && typeof item.center.lat === 'number' && typeof item.center.lon === 'number') {
				return { lat: item.center.lat, lon: item.center.lon };
			}
			if (Array.isArray(item.geometry) && item.geometry.length) {
				const first = item.geometry[0];
				if (typeof first.lat === 'number' && typeof first.lon === 'number') {
					return { lat: first.lat, lon: first.lon };
				}
			}

			return null;
		}

		function normalizeOverpassElements(elements) {
			if (!Array.isArray(elements) || elements.length === 0) {
				return null;
			}

			const candidates = elements.map(item => {
				const coords = extractCoordinates(item);
				if (!coords) {
					return null;
				}

				const tags = item.tags || {};
				const locationName = tags.name || tags['name:en'] || tags['addr:full'] || tags['addr:housename'] || tags['addr:street'];
				let score = 0;
				if (tags['addr:housenumber']) score += 3;
				if (tags['addr:street']) score += 2;
				if (tags.amenity) score += 1;
				if (item.type === 'node') score += 1;

				return {
					lat: coords.lat,
					lon: coords.lon,
					name: locationName || 'Location',
					osmType: item.type,
					osmId: item.id,
					score
				};
			}).filter(Boolean);

			if (!candidates.length) {
				return null;
			}

			candidates.sort((a, b) => b.score - a.score);
			const best = candidates[0];
			return {
				location: {
					lat: best.lat,
					lon: best.lon,
					name: best.name,
					osmType: best.osmType,
					osmId: best.osmId
				},
				matches: candidates.length
			};
		}
		const userIcon = L.divIcon({
			html: `
				<div style="
					width: 20px; height: 20px; border-radius: 50%; background: #4f46e5;
					border: 3px solid white; box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.7);
					animation: pulse 2s infinite;
				"></div>
			`,
			className: 'user-marker',
			iconSize: [20, 20],
			iconAnchor: [10, 10]
		});

		function fetchBusStops(lat, lon, radius, callback) {
			// Prevent duplicate API calls
			if (isLoadingBusStops) {
				if (typeof callback === "function") {
					callback();
				}
				return;
			}

			// Rate limiting check
			const now = Date.now();
			if (now - lastApiCall < API_RATE_LIMIT) {
				setTimeout(() => fetchBusStops(lat, lon, radius, callback), API_RATE_LIMIT - (now - lastApiCall));
				return;
			}
			lastApiCall = now;

			isLoadingBusStops = true;
			retryCount = 0;
			showLoadingState('Fetching bus stop data... (Attempt 1/' + MAX_RETRIES + ')');

			executeFetchWithRetry(lat, lon, radius, callback);
		}

		function executeFetchWithRetry(lat, lon, radius, callback) {
			const query = '[out:json][timeout:25];\n' +
			'(\n' +
			'  node["highway"="bus_stop"](around:' + radius + ', ' + lat + ', ' + lon + ');\n' +
			'  node["public_transport"="platform"](around:' + radius + ', ' + lat + ', ' + lon + ');\n' +
			');\n' +
			'out body;\n' +
			'>;\n' +
			'out skel qt;';

			const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

			fetch(url)
			.then(function(response) {
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}
				return response.json();
			})
			.then(function(data) {
				isLoadingBusStops = false;
				retryCount = 0;
				hideLoadingState();

				if (data.elements.length === 0) {
					showMessage('No bus stops found in the specified area', 'warning');
				} else {
					showMessage('Bus stop data updated', 'success');
				}

				busStopsData = data.elements;
				if (typeof callback === "function") {
					callback();
				}
			})
			.catch(function(error) {
				console.error('API request failed:', error);
				retryCount++;

				if (retryCount < MAX_RETRIES) {
					const delay = RETRY_DELAYS[retryCount - 1];
					showLoadingState(`Retrying... (${retryCount}/${MAX_RETRIES})`);

					setTimeout(() => {
						executeFetchWithRetry(lat, lon, radius, callback);
					}, delay);
				} else {
					isLoadingBusStops = false;
					hideLoadingState();
					handleApiFailure(error, lat, lon, radius, callback);
				}
			});
		}

		function handleApiFailure(error, lat, lon, radius, callback) {
			console.warn('All retries failed; falling back to cache if available:', error);

			// Show the retry button
			const retryBtn = document.getElementById('retryBtn');
			if (retryBtn) {
				retryBtn.style.display = 'flex';
			}

			// Try cached data as a fallback
			const cacheKey = `${lat},${lon},${radius}`;
			const cached = busStopsCache.get(cacheKey);

			if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION * 2) {
				console.debug('Using cached data as fallback');
				showMessage('Using cached data to display bus stops (API temporarily unavailable)', 'warning');
				busStopsData = cached.data;
				if (typeof callback === "function") {
					callback();
				}
				return;
			}

			// No cache available: show a friendly error
			showMessage('Bus stop data is temporarily unavailable. Please try again later or check your network connection.', 'error');

			if (typeof callback === "function") {
				callback();
			}
		}

		// Lightweight, NON-blocking loading indicator: a small pill at the top with a
		// mini spinner. Replaces the old full-screen dark overlay so dragging the radius
		// slider (or any background refresh) no longer blocks the whole map.
		function ensureLoadingAnimations() {
			if (document.getElementById('loading-animations')) return;
			const style = document.createElement('style');
			style.id = 'loading-animations';
			style.textContent = `
				@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
				@keyframes pillIn { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
				@keyframes pillOut { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -8px); } }
			`;
			document.head.appendChild(style);
		}

		function showLoadingState(message) {
			ensureLoadingAnimations();

			let pill = document.getElementById('loading-pill');
			if (!pill) {
				pill = document.createElement('div');
				pill.id = 'loading-pill';
				pill.setAttribute('role', 'status');
				pill.setAttribute('aria-live', 'polite');
				pill.style.cssText = `
					position: fixed;
					top: calc(12px + env(safe-area-inset-top));
					left: 50%;
					transform: translateX(-50%);
					display: flex;
					align-items: center;
					gap: 10px;
					background: var(--surface);
					backdrop-filter: blur(20px) saturate(180%);
					color: var(--text);
					padding: 8px 16px;
					border-radius: var(--radius-full);
					font-size: 0.8125rem;
					font-weight: 500;
					box-shadow: var(--shadow);
					border: 1px solid var(--border);
					z-index: 1003;
					pointer-events: none;
					max-width: calc(100vw - 32px);
					animation: pillIn 0.25s ease;
				`;
				document.body.appendChild(pill);
			} else {
				pill.style.animation = 'pillIn 0.25s ease';
			}

			pill.innerHTML = `
				<span style="
					width: 16px; height: 16px; flex-shrink: 0;
					border: 2px solid var(--border);
					border-top-color: var(--primary);
					border-radius: 50%;
					animation: spin 0.8s linear infinite;
				"></span>
				<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${message}</span>
			`;
		}

		function hideLoadingState() {
			const pill = document.getElementById('loading-pill');
			if (!pill) return;
			pill.style.animation = 'pillOut 0.25s ease forwards';
			setTimeout(() => pill.remove(), 250);
		}

		function showMessage(message, type = 'info') {
			// Enhanced message system with different types
			hideMessage(); // Remove any existing message

			const messageDiv = document.createElement('div');
			messageDiv.id = 'message-popup';

			const colors = {
				info: { bg: '#4f46e5', icon: 'i' },
				success: { bg: '#059669', icon: 'OK' },
				warning: { bg: '#d97706', icon: '!' },
				error: { bg: '#dc2626', icon: 'X' }
			};

			const color = colors[type] || colors.info;

			messageDiv.style.cssText = `
				position: fixed;
				top: 20px;
				right: 20px;
				background: ${color.bg};
				color: white;
				padding: 16px 20px;
				border-radius: var(--radius);
				font-size: 0.875rem;
				z-index: 1002;
				box-shadow: var(--shadow);
				max-width: 320px;
				cursor: pointer;
				animation: slideInRight 0.3s ease;
				display: flex;
				align-items: flex-start;
				gap: 12px;
			`;

			messageDiv.innerHTML = `
				<span style="font-size: 1.125rem; flex-shrink: 0;">${color.icon}</span>
				<span style="flex: 1; line-height: 1.5;">${message}</span>
				<button onclick="hideMessage()" style="
					background: none;
					border: none;
					color: white;
					font-size: 1.25rem;
					cursor: pointer;
					padding: 0;
					margin-left: 8px;
					opacity: 0.8;
				">&times;</button>
			`;

			document.body.appendChild(messageDiv);

			// Auto-hide after 5 seconds for info/success, 8 seconds for warnings/errors
			const autoHideDelay = (type === 'error' || type === 'warning') ? 8000 : 5000;
			setTimeout(() => {
				if (document.getElementById('message-popup')) {
					hideMessage();
				}
			}, autoHideDelay);

			// Click to dismiss
			messageDiv.onclick = (e) => {
				if (e.target === messageDiv) {
					hideMessage();
				}
			};
		}

		function hideMessage() {
			const message = document.getElementById('message-popup');
			if (message) {
				message.style.animation = 'slideOutRight 0.3s ease forwards';
				setTimeout(() => message.remove(), 300);
			}
		}

		// Enhanced error handling for different scenarios
		function handleLocationError(error) {
			const messages = {
				1: 'Location access denied. Please enable location permissions and try again.',
				2: 'Location information unavailable. Please check your device settings.',
				3: 'Location request timed out. Please try again.'
			};
			showMessage(messages[error.code] || 'Unable to get your location. Please try again.', 'error');
		}

		function handleSearchError() {
			showMessage('Search failed. Please check your internet connection and try again.', 'error');
		}

		function handleNetworkError() {
			showMessage('Network error. Please check your connection and try again.', 'error');
		}

		// Offline detection and recovery
		function isOnline() {
			return navigator.onLine;
		}

		function showOfflineMessage() {
			showMessage('Network offline detected, will use cached data', 'warning');
		}

		// Listen for network status changes
		window.addEventListener('online', function() {
			console.debug('[Network] Connection restored');
			showMessage('Network connection restored', 'success');

			// Show retry button when network is restored
			const retryBtn = document.getElementById('retryBtn');
			if (retryBtn) {
				retryBtn.style.display = 'flex';
			}
		});

		window.addEventListener('offline', function() {
			console.debug('[Network] Connection lost');
			showOfflineMessage();
		});

		// Stores the last operation so the Retry button can re-run it
		let lastOperation = {
			type: null, // 'location' or 'busStops'
			params: null
		};

		function retryLastOperation() {
			const retryBtn = document.getElementById('retryBtn');
			if (!retryBtn) return;

			if (lastOperation.type === 'location' && lastOperation.params) {
				console.debug('[Retry] Retrying location operation');
				locateMe();
			} else if (lastOperation.type === 'busStops' && lastOperation.params) {
				console.debug('[Retry] Retrying bus stops fetch');
				const { lat, lon, radius } = lastOperation.params;
				fetchBusStops(lat, lon, radius, renderStops);
			}

			retryBtn.style.display = 'none';
		}

		// (Retry-state tracking now lives inside the real locateMe() and setUser().)

		const ctrls = document.getElementById('controls');
		const showBtn = document.getElementById('showBtn');
		const sheetHandle = document.getElementById('sheetHandle');
		const radInput = document.getElementById('radius');
		const radValue = document.getElementById('radiusValue');
		const searchIn = document.getElementById('searchInput');
		const searchSuggestions = document.getElementById('searchSuggestions');
		const searchCombobox = initSearchCombobox({
			searchIn,
			searchSuggestions,
			getSources: () => ({ localStops, localMrt, localMalls, localPlaces, localStreets }),
			performSearch,
			submitSearch: searchLocation,
			escapeHtml
		});
		const closeSearchSuggestions = searchCombobox.close;
		const sheetController = initControlsSheet({
			ctrls,
			showBtn,
			sheetHandle,
			searchToggleBtn: document.getElementById('searchToggleBtn'),
			searchIn,
			map,
			closeSearchSuggestions
		});

		function syncMapZoomToRadius(animate = true) {
			const zoom = zoomForRadius(radInput.value);
			const center = userPos ? [userPos.lat, userPos.lon] : circle.getLatLng();
			if (animate) {
				map.flyTo(center, zoom, { animate: true, duration: 0.45 });
			} else {
				map.setView(center, zoom, { animate: false });
			}
		}

		// Debounced radius input handler for better performance
		radInput.oninput = () => {
			radValue.textContent = radInput.value;
			circle.setRadius(+radInput.value);
			syncMapZoomToRadius(true);

			// Immediate visual feedback
			renderStops();

			// With the local dataset, all stops are already loaded - renderStops()
			// above re-filters by the new radius, so no API call is needed.
			if (localStops) return;

			// Debounce API calls (Overpass fallback only)
			clearTimeout(radiusTimeout);
			radiusTimeout = setTimeout(() => {
				if (userPos && !isLoadingBusStops) {
					const cacheKey = `${userPos.lat},${userPos.lon},${radInput.value}`;
					fetchBusStopsWithCache(userPos.lat, userPos.lon, +radInput.value, renderStops, cacheKey);
				}
			}, 300); // 300ms debounce
		};

		document.getElementById('searchBtn').onclick = searchLocation;
		document.getElementById('locateBtn').onclick = locateMe;
		document.getElementById('retryBtn').onclick = retryLastOperation;

		function locateMe() {
			lastOperation = { type: 'location', params: null };
			const _retryBtn = document.getElementById('retryBtn');
			if (_retryBtn) _retryBtn.style.display = 'none';

			if (!navigator.geolocation) {
				handleLocationError({ code: 2 });
				return;
			}

			showLoadingState('Getting your location...');
			navigator.geolocation.getCurrentPosition(
				pos => {
					hideLoadingState();
					setUser({ lat: pos.coords.latitude, lon: pos.coords.longitude });
					showMessage('Location acquired successfully!', 'success');
				},
				(error) => {
					hideLoadingState();
					handleLocationError(error);
				},
				{
					enableHighAccuracy: true,
					timeout: 10000,
					maximumAge: 300000 // 5 minutes
				}
			);
		}

		function searchLocation() {
			const q = searchIn.value.trim();
			if (!q) {
				console.warn('[Search] Empty query submitted');
				showMessage('Please enter a search term', 'warning');
				return;
			}

			console.debug('[Search] Received user query', { query: q });
			closeSearchSuggestions();

			// Debounce search requests
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(() => {
				console.debug('[Search] Debounced search triggered', { query: q });
				performSearch(q);
			}, 500);
		}

		function performSearch(query) {
			const trimmed = query.trim();
			if (!trimmed) {
				console.warn('[Search] performSearch invoked with empty query after trimming');
				return;
			}

			// "Both" search: try the bundled bus stops first (by code or name); only
			// fall back to Overpass place geocoding when there is no local match.
			const localHit = findLocalMatch(trimmed);
			if (localHit) {
				console.debug('[Search] Local match (stop/street)', { query: trimmed });
				processSearchResult(localHit, { source: 'local', query: trimmed });
				return;
			}

			console.debug('[Search] Executing search', { query: trimmed });
			showLoadingState('Searching for location...');

			const cacheKey = `search_${trimmed.toLowerCase()}`;
			let cachedEntry = null;

			// Try to read the cache
			try {
				const cached = localStorage.getItem(cacheKey);
				if (cached) {
					cachedEntry = JSON.parse(cached);
				}
			} catch (error) {
				console.warn('[Search] Failed to read cache', { query: trimmed, error });
			}

			// Check whether the cache is still valid
			if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_DURATION) {
				hideLoadingState();
				console.debug('[Search] Cache hit', {
					query: trimmed,
					pattern: cachedEntry.pattern,
					ageMs: Date.now() - cachedEntry.timestamp
				});
				processSearchResult(cachedEntry.data, {
					source: 'cache',
					query: trimmed,
					pattern: cachedEntry.pattern
				});
				return;
			}

			if (cachedEntry) {
				console.debug('[Search] Cache expired', {
					query: trimmed,
					pattern: cachedEntry.pattern,
					ageMs: Date.now() - cachedEntry.timestamp
				});
			}

			// Run the search request (with retry)
			executeSearchWithRetry(trimmed, cacheKey, cachedEntry);
		}

		function executeSearchWithRetry(query, cacheKey, cachedEntry) {
			const overpassQuery = buildOverpassSearchQuery(query);
			console.debug('[Search] Prepared Overpass query', {
				query: query,
				regexPattern: overpassQuery.pattern,
				tokens: overpassQuery.tokens,
				boundingBox: SEARCH_BOUNDING_BOX
			});

			const url = `${OVERPASS_ENDPOINT}?data=${encodeURIComponent(overpassQuery.body)}`;
			console.debug('[Search] Overpass request URL', { url });

			fetch(url)
				.then(response => {
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}: ${response.statusText}`);
					}
					return response.json();
				})
				.then(data => {
					hideLoadingState();

					// Handle the Overpass API busy state
					if (data.remark && data.remark.includes('busy')) {
						console.warn('[Search] Overpass busy', { query: query, remark: data.remark });
						showMessage('Search service is busy. Please try again in a moment.', 'warning');

						// If a cache exists, fall back to the cached result
						if (cachedEntry) {
							setTimeout(() => {
								processSearchResult(cachedEntry.data, {
									source: 'expired_cache',
									query: query,
									pattern: cachedEntry.pattern
								});
							}, 2000);
						}
						return;
					}

					const elements = Array.isArray(data.elements) ? data.elements : [];
					console.debug('[Search] Overpass response received', {
						query: query,
						matches: elements.length,
						regexPattern: overpassQuery.pattern
					});

					if (elements.length === 0) {
						showMessage('Location not found. Please try a more specific search term', 'warning');
						return;
					}

					const normalized = normalizeOverpassElements(elements);
					if (!normalized) {
						console.warn('[Search] No valid matches from Overpass', {
							query: query,
							regexPattern: overpassQuery.pattern,
							tokens: overpassQuery.tokens
						});
						showMessage('No valid location found. Please try a more specific search term', 'warning');
						return;
					}

					const { location, matches } = normalized;

					// Cache the search result
					try {
						localStorage.setItem(cacheKey, JSON.stringify({
							data: location,
							timestamp: Date.now(),
							pattern: overpassQuery.pattern
						}));
						console.debug('[Search] Cached result', {
							query: query,
							regexPattern: overpassQuery.pattern
						});
					} catch (error) {
						console.warn('[Search] Failed to cache result', {
							query: query,
							regexPattern: overpassQuery.pattern,
							error
						});
					}

					processSearchResult(location, {
						source: 'overpass',
						query: query,
						matches,
						pattern: overpassQuery.pattern
					});
				})
				.catch(error => {
					console.error('[Search] Request failed', {
						query: query,
						regexPattern: overpassQuery.pattern,
						error
					});

					// If a cache exists, fall back to the cached result
					if (cachedEntry) {
						hideLoadingState();
						console.debug('[Search] Fallback to expired cache', {
							query: query,
							pattern: cachedEntry.pattern,
							ageMs: Date.now() - cachedEntry.timestamp
						});
						showMessage('Search service temporarily unavailable, using cached results', 'warning');
						processSearchResult(cachedEntry.data, {
							source: 'expired_cache',
							query: query,
							pattern: cachedEntry.pattern
						});
						return;
					}

					// Error handling when there is no cache
					hideLoadingState();
					handleSearchError();
				});
		}

		function processSearchResult(result, meta = {}) {
			if (!result) {
				console.warn('[Search] Empty result received', meta);
				showMessage('Location not found. Please try a more specific search term', 'warning');
				return;
			}

			const lat = Number(result.lat);
			const lon = Number(result.lon);
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
				console.warn('[Search] Invalid coordinates in result', { result, meta });
				showMessage('Location not found. Please try a more specific search term', 'warning');
				return;
			}

			const displayName = result.name || 'Location';
			console.debug('[Search] Applying search result', {
				query: meta.query,
				source: meta.source,
				matches: meta.matches,
				lat,
				lon
			});
			setUser({ lat, lon });
			showMessage(`Located: ${escapeHtml(displayName)}`, 'success');
			// Collapse the watch search field once a result is applied
			ctrls.classList.remove('searching');
		}

		// Enhanced fetchBusStops with caching
		function fetchBusStopsWithCache(lat, lon, radius, callback, cacheKey) {
			// Check cache first
			const cached = busStopsCache.get(cacheKey);
			if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
				busStopsData = cached.data;
				if (typeof callback === "function") {
					callback();
				}
				return;
			}

			fetchBusStops(lat, lon, radius, function() {
				// Cache the result
				busStopsCache.set(cacheKey, {
					data: busStopsData,
					timestamp: Date.now()
				});

				// Limit cache size
				if (busStopsCache.size > 50) {
					const firstKey = busStopsCache.keys().next().value;
					busStopsCache.delete(firstKey);
				}

				if (typeof callback === "function") {
					callback();
				}
			});
		}

		// Memory cleanup on page unload
		window.addEventListener('beforeunload', () => {
			clearTimeout(radiusTimeout);
			clearTimeout(searchTimeout);
		});

		function setUser(pos) {
			userPos = pos;
			lastOperation = {
				type: 'busStops',
				params: { lat: pos.lat, lon: pos.lon, radius: parseInt(radInput.value) }
			};
			if (!userMarker) {
				userMarker = L.marker([pos.lat, pos.lon], { icon: userIcon })
					.addTo(map)
					.bindPopup('<div style="text-align: center;"><b>Your Location</b><br>Searching for nearby bus stops...</div>')
					.openPopup();
			} else {
				userMarker.setLatLng([pos.lat, pos.lon]);
				userMarker.bindPopup('<div style="text-align: center;"><b>Your Location</b><br>Location updated</div>').openPopup();
			}

			// Smooth circle transition
			circle.setLatLng([pos.lat, pos.lon]);
			map.flyTo([pos.lat, pos.lon], zoomForRadius(radInput.value), {
				animate: true,
				duration: 1.5
			});

			// Prefer the bundled local dataset (instant, offline). Fall back to the
			// Overpass API only when bus-stops.jsonl is not available.
			if (localStops) {
				busStopsData = localStops;
				renderStops();
			} else {
				renderStops();
				if (!isLoadingBusStops) {
					fetchBusStops(pos.lat, pos.lon, +radInput.value, function() {
						renderStops();
					});
				}
			}
		}

		function loadStops() {
			const p = new URLSearchParams(window.location.search);
			const lat = parseFloat(p.get('lat')),
				lon = parseFloat(p.get('lon'));
			if (!isNaN(lat) && !isNaN(lon)) {
				// Use URL parameters if provided
				setUser({ lat, lon });
			} else {
				// Otherwise try to get user location or use default
				locateMe();
			}
		}

		// --- Local bus-stop dataset (bus-stops.jsonl) ---------------------------------
		// When present, every bus stop is held locally so "nearby" needs no API:
		// instant, offline, and every stop has a valid LTA code. Falls back to Overpass
		// automatically when the file is missing.
		let localStops = null; // array of element-shaped { id, lat, lon, tags:{ ref, name, road } }

		function loadLocalStops() {
			return fetch('./bus-stops.jsonl')
				.then(r => r.ok ? r.text() : Promise.reject(new Error('bus-stops.jsonl not found')))
				.then(text => {
					const arr = [];
					for (const line of text.split('\n')) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						try {
							const o = JSON.parse(trimmed);
							if (o && typeof o.lat === 'number' && typeof o.lon === 'number' && o.code) {
								arr.push({ id: o.code, lat: o.lat, lon: o.lon, tags: { ref: String(o.code), name: o.name || 'Bus Stop', road: o.road || '' } });
							}
						} catch (e) { /* skip malformed line */ }
					}
					if (arr.length) {
						localStops = arr;
						console.debug('[Local] Loaded', arr.length, 'bus stops from bus-stops.jsonl');
						// If the user is already located, switch to local data immediately
						if (userPos) {
							busStopsData = localStops;
							renderStops();
						}
					}
				})
				.catch(() => {
					console.debug('[Local] bus-stops.jsonl unavailable; falling back to Overpass API');
				});
		}

		// --- Local street index (streets.jsonl) --------------------------------------
		// All named SG roads with a representative coordinate, for offline street search.
		let localStreets = null; // array of { name, _n (lowercased), lat, lon }

		function loadLocalStreets() {
			return fetch('./streets.jsonl')
				.then(r => r.ok ? r.text() : Promise.reject(new Error('streets.jsonl not found')))
				.then(text => {
					const arr = [];
					for (const line of text.split('\n')) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						try {
							const o = JSON.parse(trimmed);
							if (o && o.name && typeof o.lat === 'number' && typeof o.lon === 'number') {
								arr.push({ name: o.name, _n: o.name.toLowerCase(), lat: o.lat, lon: o.lon });
							}
						} catch (e) { /* skip */ }
					}
					if (arr.length) {
						localStreets = arr;
						console.debug('[Local] Loaded', arr.length, 'streets from streets.jsonl');
					}
				})
				.catch(() => {
					console.debug('[Local] streets.jsonl unavailable');
				});
		}

		// --- Local mall index (malls.jsonl) ------------------------------------------
		// SG shopping malls with a coordinate, for offline mall search.
		let localMalls = null; // array of { name, _n (lowercased), lat, lon }

		function loadLocalMalls() {
			return fetch('./malls.jsonl')
				.then(r => r.ok ? r.text() : Promise.reject(new Error('malls.jsonl not found')))
				.then(text => {
					const arr = [];
					for (const line of text.split('\n')) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						try {
							const o = JSON.parse(trimmed);
							if (o && o.name && typeof o.lat === 'number' && typeof o.lon === 'number') {
								arr.push({ name: o.name, _n: o.name.toLowerCase(), lat: o.lat, lon: o.lon });
							}
						} catch (e) { /* skip */ }
					}
					if (arr.length) {
						localMalls = arr;
						console.debug('[Local] Loaded', arr.length, 'malls from malls.jsonl');
					}
				})
				.catch(() => {
					console.debug('[Local] malls.jsonl unavailable');
				});
		}

		// --- Local MRT/LRT station index (mrt.jsonl) ---------------------------------
		// SG rail stations, searchable by name or station code (e.g. "NS1").
		let localMrt = null; // array of { name, _n, lat, lon, _codes: [lowercased codes] }

		function loadLocalMrt() {
			return fetch('./mrt.jsonl')
				.then(r => r.ok ? r.text() : Promise.reject(new Error('mrt.jsonl not found')))
				.then(text => {
					const arr = [];
					for (const line of text.split('\n')) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						try {
							const o = JSON.parse(trimmed);
							if (o && o.name && typeof o.lat === 'number' && typeof o.lon === 'number') {
								const codes = (o.code || '').toLowerCase().split(/[;,\s]+/).filter(Boolean);
								arr.push({ name: o.name, _n: o.name.toLowerCase(), lat: o.lat, lon: o.lon, code: o.code || '', _codes: codes });
							}
						} catch (e) { /* skip */ }
					}
					if (arr.length) {
						localMrt = arr;
						console.debug('[Local] Loaded', arr.length, 'MRT/LRT stations from mrt.jsonl');
					}
				})
				.catch(() => {
					console.debug('[Local] mrt.jsonl unavailable');
				});
		}

		// --- Local landmark index (places.jsonl) -------------------------------------
		// SG schools, hospitals, parks and tourist attractions, for offline search.
		let localPlaces = null; // array of { name, _n (lowercased), kind, lat, lon }

		function loadLocalPlaces() {
			return fetch('./places.jsonl')
				.then(r => r.ok ? r.text() : Promise.reject(new Error('places.jsonl not found')))
				.then(text => {
					const arr = [];
					for (const line of text.split('\n')) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						try {
							const o = JSON.parse(trimmed);
							if (o && o.name && typeof o.lat === 'number' && typeof o.lon === 'number') {
								arr.push({ name: o.name, _n: o.name.toLowerCase(), kind: o.kind || 'place', lat: o.lat, lon: o.lon });
							}
						} catch (e) { /* skip */ }
					}
					if (arr.length) {
						localPlaces = arr;
						console.debug('[Local] Loaded', arr.length, 'landmarks from places.jsonl');
					}
				})
				.catch(() => {
					console.debug('[Local] places.jsonl unavailable');
				});
		}

		// Match a {name,_n} list by exact, then starts-with, then contains
		function matchNamed(list, q) {
			if (!list) return null;
			const hit = list.find(s => s._n === q)
				|| list.find(s => s._n.startsWith(q))
				|| list.find(s => s._n.includes(q));
			return hit ? { lat: hit.lat, lon: hit.lon, name: hit.name } : null;
		}

		// Local "Both" search: exact bus-stop code, then a mall name, then a road
		// name, then a bus-stop name/road substring. Returns { lat, lon, name } or
		// null (then Overpass place geocoding runs as a fallback).
		function findLocalMatch(query) {
			const q = query.trim().toLowerCase();
			if (!q) return null;

			// 1. Exact bus-stop code (e.g. "07379")
			if (localStops) {
				const byCode = localStops.find(s => s.tags.ref.toLowerCase() === q);
				if (byCode) return { lat: byCode.lat, lon: byCode.lon, name: byCode.tags.name };
			}

			// 2. MRT/LRT station - by station code (e.g. "ns1") or name
			if (localMrt) {
				const byCode = localMrt.find(s => s._codes.includes(q));
				if (byCode) return { lat: byCode.lat, lon: byCode.lon, name: byCode.name };
				const byStn = matchNamed(localMrt, q);
				if (byStn) return byStn;
			}

			// 3. Shopping mall (a common search destination)
			const mall = matchNamed(localMalls, q);
			if (mall) return mall;

			// 4. Landmark (school / hospital / park / tourist attraction)
			const place = matchNamed(localPlaces, q);
			if (place) return place;

			// 5. Road name
			const street = matchNamed(localStreets, q);
			if (street) return street;

			// 6. Bus-stop name / road substring
			if (localStops) {
				const byName = localStops.find(s =>
					(s.tags.name || '').toLowerCase().includes(q) ||
					(s.tags.road || '').toLowerCase().includes(q)
				);
				if (byName) return { lat: byName.lat, lon: byName.lon, name: byName.tags.name };
			}

			return null;
		}

		// Escape text from OpenStreetMap (user-editable) before putting it in innerHTML
		function escapeHtml(value) {
			return String(value ?? '').replace(/[&<>"']/g, ch => ({
				'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
			}[ch]));
		}

		// Format a distance in metres into a friendly string (e.g. 850m / 1.2km)
		function formatDistance(metres) {
			return metres >= 1000 ? (metres / 1000).toFixed(1) + 'km' : Math.round(metres) + 'm';
		}

		// Rough walking time at ~80 m/min (about 4.8 km/h)
		function walkMin(metres) {
			return Math.max(1, Math.round(metres / 80));
		}

		// The LTA bus-stop code (a 5-digit ref). Returns null when OSM has no usable code.
		function stopCode(s) {
			return s.tags?.ref || s.tags?.['ref:LTA'] || null;
		}

		// The arrival-times service is keyed by the 5-digit LTA code only
		function isValidBusCode(code) {
			return /^\d{5}$/.test(code);
		}

		function arrivalUrl(code) {
			return 'https://yapweijun1996.github.io/SG-Bus-Arrival-Time-By-Bus-Code/?busId=' + encodeURIComponent(code);
		}

		// Overpass returns both highway=bus_stop and public_transport=platform nodes,
		// so the same physical stop can appear twice. Collapse duplicates by stop code,
		// falling back to rounded coordinates when there is no code.
		function dedupeStops(stops) {
			const seen = new Map();
			stops.forEach(s => {
				const key = s.tags?.ref
					? 'ref:' + s.tags.ref
					: 'pos:' + s.lat.toFixed(5) + ',' + s.lon.toFixed(5);
				if (!seen.has(key)) seen.set(key, s);
			});
			return Array.from(seen.values());
		}

		// Keep references to markers so a list row can focus its map marker
		const stopMarkers = new Map();

		function focusStop(key) {
			const marker = stopMarkers.get(key);
			if (!marker) return;
			map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { animate: true, duration: 0.8 });
			marker.openPopup();
		}

		function renderStops() {
			if (!userPos) return;
			stopLayer.clearLayers();
			stopMarkers.clear();

			const radius = +radInput.value;
			const nearbyStops = dedupeStops(busStopsData.filter(s =>
				map.distance([s.lat, s.lon], [userPos.lat, userPos.lon]) <= radius
			));

			// Sort by distance for better UX
			nearbyStops.sort((a, b) => {
				const distA = map.distance([a.lat, a.lon], [userPos.lat, userPos.lon]);
				const distB = map.distance([b.lat, b.lon], [userPos.lat, userPos.lon]);
				return distA - distB;
			});

			const listEl = document.getElementById('stopList');
			listEl.innerHTML = '';

			nearbyStops.forEach((s, index) => {
			const distance = map.distance([s.lat, s.lon], [userPos.lat, userPos.lon]);
			const code = stopCode(s);
			const hasCode = isValidBusCode(code);
			const badge = escapeHtml(code || 'Stop');
			const safeName = escapeHtml(s.tags?.name || 'Bus Stop');
			const distLabel = formatDistance(distance) + ' - ' + walkMin(distance) + ' min walk';
			const key = s.tags?.ref ? 'ref:' + s.tags.ref : 'pos:' + s.lat.toFixed(5) + ',' + s.lon.toFixed(5);

			const busIcon = L.divIcon({
				html: `
					<div style="
						width: 32px; height: 32px; border-radius: 50%;
						background: linear-gradient(135deg, #059669, #10b981);
						border: 2px solid white;
						box-shadow: 0 2px 8px rgba(0,0,0,0.2);
						display: flex; align-items: center; justify-content: center;
						color: white; font-weight: bold; font-size: 10px;
						animation: fadeInScale 0.3s ease;
					">${badge}</div>
				`,
				className: 'bus-stop-marker',
				iconSize: [32, 32],
				iconAnchor: [16, 16]
			});

			const timesLink = hasCode
				? `<a href="${arrivalUrl(code)}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 6px; background: #4f46e5; color: white; text-decoration: none; padding: 8px 12px; border-radius: 6px; font-size: 0.875rem; font-weight: 500;">View Times</a>`
				: '';

			const marker = L.marker([s.lat, s.lon], { icon: busIcon })
				.bindPopup(`
					<div style="min-width: 200px;">
						<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
							<span style="font-size: 0.75rem; font-weight: 700; color: #059669; text-transform: uppercase;">Bus</span>
							<b style="color: #059669;">${badge}</b>
						</div>
						<div style="color: #4b5563; margin-bottom: 8px;">${safeName}</div>
						<div style="display: flex; align-items: center; gap: 4px; margin-bottom: 12px;">
							<span style="font-size: 0.875rem; color: #6b7280;">Distance</span>
							<span style="font-size: 0.875rem; color: #6b7280;">${distLabel}</span>
						</div>
						${timesLink}
					</div>
				`, { maxWidth: 250, closeButton: true })
				.addTo(stopLayer);

			stopMarkers.set(key, marker);

			// List row, synced to the map marker
			const row = document.createElement('div');
			row.className = 'stop-item';
			row.setAttribute('role', 'listitem');
			row.tabIndex = 0;
			row.innerHTML = `
				<span class="stop-code">${badge}</span>
				<span class="stop-info">
					<span class="stop-name">${safeName}</span>
					<span class="stop-distance">${distLabel}</span>
				</span>
				${hasCode ? `<a class="stop-times" href="${arrivalUrl(code)}" target="_blank" rel="noopener">Times -></a>` : ''}
			`;
			// On a watch the map is tiny, so the most useful tap is "view arrival times"
			// (when the stop has a real code); otherwise tapping focuses its map marker.
			const isWatch = () => window.matchMedia('(max-width: 250px)').matches;
			const activateRow = () => {
				if (hasCode && isWatch()) {
					window.open(arrivalUrl(code), '_blank', 'noopener');
				} else {
					focusStop(key);
				}
			};
			row.addEventListener('click', (e) => {
				if (e.target.closest('.stop-times')) return; // let the link work
				activateRow();
			});
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					activateRow();
				}
			});
			listEl.appendChild(row);

			// Staggered animation for markers
			setTimeout(() => {
				if (marker._icon) marker._icon.style.animation = 'fadeInScale 0.5s ease';
			}, index * 50);
			});

			// Empty state with one-tap "expand radius" action
			if (nearbyStops.length === 0) {
				const max = +radInput.max;
				const next = Math.min(radius + 150, max);
				listEl.innerHTML = `
					<div class="stop-list-empty">
						No bus stops within ${formatDistance(radius)}.
						${next > radius ? `<br><button id="expandRadiusBtn">Expand to ${next}m</button>` : ''}
					</div>
				`;
				const expandBtn = document.getElementById('expandRadiusBtn');
				if (expandBtn) {
					expandBtn.onclick = () => {
						radInput.value = next;
						radInput.dispatchEvent(new Event('input'));
					};
				}
			}

			// Update results counter (single source of truth: stops within radius)
			const counter = document.getElementById('results-counter') || createResultsCounter();
			counter.textContent = `${nearbyStops.length} bus stop${nearbyStops.length === 1 ? '' : 's'} within ${formatDistance(radius)}`;
		}

		function createResultsCounter() {
			const counter = document.createElement('div');
			counter.id = 'results-counter';
			counter.setAttribute('aria-live', 'polite');
			map.getContainer().appendChild(counter);

			// Show counter after a short delay
			setTimeout(() => {
				counter.classList.add('visible');
			}, 500);

			return counter;
		}

		loadLocalStops(); // bundled bus stops; falls back to Overpass if absent
		loadLocalStreets(); // bundled street index for offline place search
		loadLocalMalls(); // bundled shopping-mall index for offline search
		loadLocalMrt(); // bundled MRT/LRT station index for offline search
		loadLocalPlaces(); // bundled landmark index (schools/hospitals/parks/attractions)
		loadStops();

		// Add keyboard navigation for all interactive elements
		document.addEventListener('keydown', function (e) {
			if (e.defaultPrevented) return;

			// Escape key to hide controls
			if (e.key === 'Escape' && searchSuggestions.classList.contains('open')) {
				closeSearchSuggestions();
				return;
			}

			if (e.key === 'Escape' && sheetController.isMobileSheet() && sheetController.getSheetState() !== 'collapsed') {
				sheetController.setSheetState('collapsed');
				document.getElementById('toggleBtn').focus();
				return;
			}

			if (e.key === 'Escape' && !sheetController.isMobileSheet() && !ctrls.classList.contains('hidden')) {
				document.getElementById('toggleBtn').click();
				document.getElementById('toggleBtn').focus();
			}

			// Tab navigation enhancement
			if (e.key === 'Tab') {
				// Ensure proper focus management
				const focusableElements = ctrls.querySelectorAll(
					'input, button, [tabindex]:not([tabindex="-1"])'
				);

				const firstElement = focusableElements[0];
				const lastElement = focusableElements[focusableElements.length - 1];

				// Trap focus within controls when visible
				if (!ctrls.classList.contains('hidden') && !(sheetController.isMobileSheet() && sheetController.getSheetState() === 'collapsed')) {
					if (e.shiftKey && document.activeElement === firstElement) {
						e.preventDefault();
						lastElement.focus();
					} else if (!e.shiftKey && document.activeElement === lastElement) {
						e.preventDefault();
						firstElement.focus();
					}
				}
			}
		});

		// Update fullscreen button ARIA state
		document.getElementById('fullscreenBtn').onclick = () => {
			const isFullscreen = !!document.fullscreenElement;
			document.getElementById('fullscreenBtn').setAttribute('aria-pressed', !isFullscreen);
			document.fullscreenElement
				? document.exitFullscreen()
				: document.documentElement.requestFullscreen();
		};

		// Add focus indicators for keyboard users
		const style = document.createElement('style');
		style.textContent = `
			.controls:focus-within {
				outline: 2px solid var(--primary);
				outline-offset: 2px;
			}

			.controls-row input:focus,
			.controls-row button:focus {
				outline: 2px solid var(--primary);
				outline-offset: 2px;
			}

			/* High contrast mode support */
			@media (prefers-contrast: high) {
				:root {
					--primary: #0000ff;
					--success: #008000;
					--neutral: #666666;
					--text: #000000;
					--surface: #ffffff;
					--border: #000000;
				}
			}

			/* Reduced motion support */
			@media (prefers-reduced-motion: reduce) {
				* {
					animation-duration: 0.01ms !important;
					animation-iteration-count: 1 !important;
					transition-duration: 0.01ms !important;
				}
			}
		`;
		document.head.appendChild(style);

		if ('serviceWorker' in navigator) {
			window.addEventListener('load', () => {
				navigator.serviceWorker.register('./service-worker.js').catch(error => {
					console.warn('[PWA] Service worker registration failed', error);
				});
			});
		}
