function addSuggestion(items, seen, suggestion) {
	if (!suggestion || !suggestion.name) return;
	const key = `${suggestion.type}:${suggestion.name}:${suggestion.code || ''}`.toLowerCase();
	if (seen.has(key)) return;
	seen.add(key);
	items.push(suggestion);
}

function addNamedSuggestions(items, seen, list, q, type, limit) {
	if (!list || items.length >= limit) return;
	const ranked = [
		...list.filter(item => item._n === q),
		...list.filter(item => item._n !== q && item._n.startsWith(q)),
		...list.filter(item => item._n !== q && !item._n.startsWith(q) && item._n.includes(q))
	];

	for (const item of ranked) {
		addSuggestion(items, seen, {
			name: item.name,
			lat: item.lat,
			lon: item.lon,
			type,
			code: item.code || '',
			meta: item.kind || type
		});
		if (items.length >= limit) return;
	}
}

function getSearchSuggestions(query, sources) {
	const q = query.trim().toLowerCase();
	const limit = 8;
	const items = [];
	const seen = new Set();
	if (q.length < 2) return items;

	const { localStops, localMrt, localMalls, localPlaces, localStreets } = sources;

	if (localStops) {
		const stopHits = [
			...localStops.filter(s => (s.tags.ref || '').toLowerCase().startsWith(q)),
			...localStops.filter(s => (s.tags.name || '').toLowerCase().includes(q) || (s.tags.road || '').toLowerCase().includes(q))
		];

		for (const stop of stopHits) {
			addSuggestion(items, seen, {
				name: stop.tags.name || 'Bus Stop',
				lat: stop.lat,
				lon: stop.lon,
				type: 'bus stop',
				code: stop.tags.ref || '',
				meta: stop.tags.road || 'bus stop'
			});
			if (items.length >= limit) return items;
		}
	}

	if (localMrt) {
		for (const station of localMrt.filter(s => s._codes.some(code => code.startsWith(q)))) {
			addSuggestion(items, seen, {
				name: station.name,
				lat: station.lat,
				lon: station.lon,
				type: 'MRT/LRT',
				code: station.code || station._codes[0] || '',
				meta: 'MRT/LRT'
			});
			if (items.length >= limit) return items;
		}
	}

	addNamedSuggestions(items, seen, localMrt, q, 'MRT/LRT', limit);
	addNamedSuggestions(items, seen, localMalls, q, 'mall', limit);
	addNamedSuggestions(items, seen, localPlaces, q, 'place', limit);
	addNamedSuggestions(items, seen, localStreets, q, 'street', limit);

	return items.slice(0, limit);
}

export function initSearchCombobox({
	searchIn,
	searchSuggestions,
	getSources,
	performSearch,
	submitSearch,
	escapeHtml
}) {
	let comboOptions = [];
	let activeComboIndex = -1;

	function close() {
		comboOptions = [];
		activeComboIndex = -1;
		searchSuggestions.classList.remove('open');
		searchSuggestions.innerHTML = '';
		searchIn.setAttribute('aria-expanded', 'false');
		searchIn.removeAttribute('aria-activedescendant');
	}

	function setActiveOption(index) {
		activeComboIndex = index;
		const options = searchSuggestions.querySelectorAll('.combo-option');
		options.forEach((option, optionIndex) => {
			const selected = optionIndex === activeComboIndex;
			option.setAttribute('aria-selected', String(selected));
			if (selected) {
				searchIn.setAttribute('aria-activedescendant', option.id);
				option.scrollIntoView({ block: 'nearest' });
			}
		});
		if (activeComboIndex < 0) searchIn.removeAttribute('aria-activedescendant');
	}

	function selectOption(index) {
		const option = comboOptions[index];
		if (!option) return false;
		searchIn.value = option.code && option.type === 'bus stop' ? option.code : option.name;
		close();
		performSearch(searchIn.value);
		return true;
	}

	function update() {
		comboOptions = getSearchSuggestions(searchIn.value, getSources());
		activeComboIndex = -1;

		if (!comboOptions.length) {
			close();
			return;
		}

		searchSuggestions.innerHTML = comboOptions.map((item, index) => {
			const label = item.code ? `${item.code} - ${item.name}` : item.name;
			return `
				<button type="button" class="combo-option" id="searchOption${index}" role="option" aria-selected="false" data-index="${index}">
					<strong>${escapeHtml(label)}</strong>
					<span>${escapeHtml(item.meta || item.type)}</span>
				</button>
			`;
		}).join('');

		searchSuggestions.classList.add('open');
		searchIn.setAttribute('aria-expanded', 'true');
	}

	searchIn.addEventListener('input', update);
	searchIn.addEventListener('focus', update);
	searchIn.addEventListener('keydown', function (e) {
		if (e.key === 'ArrowDown') {
			if (!comboOptions.length) update();
			if (comboOptions.length) {
				e.preventDefault();
				setActiveOption((activeComboIndex + 1) % comboOptions.length);
			}
			return;
		}

		if (e.key === 'ArrowUp') {
			if (!comboOptions.length) update();
			if (comboOptions.length) {
				e.preventDefault();
				setActiveOption(activeComboIndex <= 0 ? comboOptions.length - 1 : activeComboIndex - 1);
			}
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			if (activeComboIndex >= 0 && selectOption(activeComboIndex)) return;
			submitSearch();
			return;
		}

		if (e.key === 'Escape' && searchSuggestions.classList.contains('open')) {
			e.preventDefault();
			close();
		}
	});

	searchSuggestions.addEventListener('pointerdown', function (e) {
		const option = e.target.closest('.combo-option');
		if (!option) return;
		e.preventDefault();
		selectOption(Number(option.dataset.index));
	});

	document.addEventListener('pointerdown', function (e) {
		if (!e.target.closest('.search-combobox')) {
			close();
		}
	});

	return { close, update };
}
