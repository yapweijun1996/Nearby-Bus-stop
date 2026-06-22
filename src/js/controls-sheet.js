export function initControlsSheet({
	ctrls,
	showBtn,
	sheetHandle,
	searchToggleBtn,
	searchIn,
	map,
	closeSearchSuggestions
}) {
	const mobileSheetQuery = window.matchMedia('(max-width: 480px)');
	let sheetState = 'half';

	function isMobileSheet() {
		return mobileSheetQuery.matches;
	}

	function setSheetState(state) {
		if (!isMobileSheet()) {
			ctrls.classList.remove('sheet-collapsed', 'sheet-half', 'sheet-expanded');
			ctrls.classList.add('sheet-half');
			showBtn.style.display = ctrls.classList.contains('hidden') ? 'flex' : 'none';
			sheetHandle.setAttribute('aria-expanded', 'false');
			sheetHandle.setAttribute('aria-label', 'Toggle controls');
			return;
		}

		sheetState = state;
		ctrls.classList.remove('hidden', 'sheet-collapsed', 'sheet-half', 'sheet-expanded');
		ctrls.classList.add(`sheet-${state}`);
		showBtn.style.display = 'none';

		const expanded = state === 'expanded';
		sheetHandle.setAttribute('aria-expanded', String(expanded));
		sheetHandle.setAttribute('aria-label',
			state === 'expanded' ? 'Collapse controls' : 'Expand controls'
		);
		document.getElementById('toggleBtn').setAttribute('aria-expanded', state !== 'collapsed');
		document.getElementById('toggleBtn').setAttribute('aria-label',
			state === 'collapsed' ? 'Show more controls' : 'Collapse controls'
		);

		if (state === 'collapsed') {
			closeSearchSuggestions();
		}

		requestAnimationFrame(() => map.invalidateSize());
	}

	function toggleSheetFromHandle() {
		if (!isMobileSheet()) {
			document.getElementById('toggleBtn').click();
			return;
		}
		setSheetState(sheetState === 'expanded' ? 'half' : 'expanded');
	}

	function setWatchSearch(open) {
		ctrls.classList.toggle('searching', open);
		searchToggleBtn.setAttribute('aria-expanded', String(open));
		if (open) {
			searchIn.focus();
		}
	}

	searchToggleBtn.onclick = () => setWatchSearch(!ctrls.classList.contains('searching'));
	showBtn.onclick = () => {
		if (isMobileSheet()) {
			setSheetState('half');
			return;
		}
		document.getElementById('toggleBtn').click();
	};

	let sheetDragStartY = null;
	let sheetDragMoved = false;
	sheetHandle.addEventListener('pointerdown', function (e) {
		sheetDragStartY = e.clientY;
		sheetDragMoved = false;
		sheetHandle.setPointerCapture?.(e.pointerId);
	});
	sheetHandle.addEventListener('pointermove', function (e) {
		if (sheetDragStartY === null) return;
		if (Math.abs(e.clientY - sheetDragStartY) > 8) sheetDragMoved = true;
	});
	sheetHandle.addEventListener('pointerup', function (e) {
		if (sheetDragStartY === null) return;
		const deltaY = e.clientY - sheetDragStartY;
		sheetDragStartY = null;
		sheetHandle.releasePointerCapture?.(e.pointerId);

		if (!isMobileSheet()) {
			if (!sheetDragMoved) toggleSheetFromHandle();
			return;
		}

		if (deltaY < -36) {
			setSheetState('expanded');
		} else if (deltaY > 36) {
			setSheetState(sheetState === 'expanded' ? 'half' : 'collapsed');
		} else {
			toggleSheetFromHandle();
		}
	});
	sheetHandle.addEventListener('pointercancel', function () {
		sheetDragStartY = null;
		sheetDragMoved = false;
	});
	sheetHandle.addEventListener('keydown', function (e) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggleSheetFromHandle();
		}
	});

	document.getElementById('toggleBtn').onclick = () => {
		if (isMobileSheet()) {
			setSheetState(sheetState === 'collapsed' ? 'half' : 'collapsed');
			return;
		}

		const isHidden = ctrls.classList.contains('hidden');
		ctrls.classList.toggle('hidden');
		showBtn.style.display = isHidden ? 'none' : 'flex';
		map.invalidateSize();

		document.getElementById('toggleBtn').setAttribute('aria-expanded', !isHidden);
		document.getElementById('toggleBtn').setAttribute('aria-label',
			isHidden ? 'Show Controls' : 'Hide Controls'
		);
	};

	function syncSheetForViewport() {
		if (isMobileSheet()) {
			setSheetState(sheetState || 'half');
		} else {
			ctrls.classList.remove('sheet-collapsed', 'sheet-expanded');
			ctrls.classList.add('sheet-half');
			showBtn.style.display = ctrls.classList.contains('hidden') ? 'flex' : 'none';
			map.invalidateSize();
		}
	}

	mobileSheetQuery.addEventListener?.('change', syncSheetForViewport);
	syncSheetForViewport();

	window.setSheetState = setSheetState;

	return {
		getSheetState: () => sheetState,
		isMobileSheet,
		setSheetState,
		syncSheetForViewport
	};
}
