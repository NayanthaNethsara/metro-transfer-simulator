(function () {
  "use strict";

  const LANE_OFFSET_PX = 4;
  const BORELLA_INSET_RADIUS_KM = 0.9;
  const RECENT_OUTCOME_WINDOW_MIN = 14;
  const TRAFFIC_STATE_NAMES = ["Free", "Slow", "Jammed"];
  const TRAFFIC_DASH_PATTERNS = [null, "8 5", "2 5"];
  const CONNECTOR_LEGS = ["CM01_MAK_to_FOR", "CM03_MAK_to_KAD"];
  const LEG_LABELS = {
    CM01_MAK_to_FOR: "CM01 to Fort",
    CM01_FOR_to_MAK: "CM01 to Makumbura",
    CM03_MAK_to_KAD: "CM03 to Kadawatha",
    CM03_KAD_to_MAK: "CM03 to Makumbura"
  };
  const PERMANENT_STOP_LABELS = {
    Makumbura: "Makumbura",
    Kadawatha: "Kadawatha",
    "Colombo Fort": "Colombo Fort",
    "Borella 02 (YMBA)": "Borella interchange"
  };
  const ESRI_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/{service}/MapServer/tile/{z}/{y}/{x}";
  const BASEMAPS = {
    Dark: {
      services: ["Canvas/World_Dark_Gray_Base", "Canvas/World_Dark_Gray_Reference"],
      maxNativeZoom: 16,
      attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
    },
    Light: {
      services: ["Canvas/World_Light_Gray_Base", "Canvas/World_Light_Gray_Reference"],
      maxNativeZoom: 16,
      attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
    },
    Satellite: {
      services: ["World_Imagery"],
      maxNativeZoom: 19,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics"
    }
  };

  function createBasemapLayer(name) {
    const spec = BASEMAPS[name];
    return L.layerGroup(spec.services.map((service, i) => L.tileLayer(ESRI_TILE_URL, {
      service,
      maxZoom: 19,
      maxNativeZoom: spec.maxNativeZoom,
      attribution: i === 0 ? spec.attribution : ""
    })));
  }

  function readCssVar(name, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  function haversineKm(a, b) {
    const toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLng = (b.lng - a.lng) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371.0 * Math.asin(Math.sqrt(h));
  }

  function prepareLegGeometry(legGeo) {
    const latlngs = legGeo.path.map(([lat, lng]) => L.latLng(lat, lng));
    const cumKm = [0];
    for (let i = 1; i < latlngs.length; i++) {
      cumKm.push(cumKm[i - 1] + haversineKm(latlngs[i - 1], latlngs[i]));
    }
    return { latlngs, cumKm, stopKm: legGeo.stopVertex.map((v) => cumKm[v]) };
  }

  function locateAlongPath(geometry, distanceKm) {
    const { cumKm, latlngs } = geometry;
    let lo = 0;
    let hi = cumKm.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumKm[mid] <= distanceKm) lo = mid;
      else hi = mid;
    }
    const segmentKm = cumKm[hi] - cumKm[lo];
    const frac = segmentKm > 0 ? Math.max(0, Math.min(1, (distanceKm - cumKm[lo]) / segmentKm)) : 0;
    const from = latlngs[lo];
    const to = latlngs[hi];
    return {
      latlng: L.latLng(from.lat + (to.lat - from.lat) * frac, from.lng + (to.lng - from.lng) * frac),
      from,
      to
    };
  }

  function offsetToLeftOfTravel(map, located, offsetPx) {
    const zoom = map.getZoom();
    const p = map.project(located.latlng, zoom);
    const a = map.project(located.from, zoom);
    const b = map.project(located.to, zoom);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      latlng: map.unproject(L.point(p.x + (dy / len) * offsetPx, p.y - (dx / len) * offsetPx), zoom),
      headingDeg: (Math.atan2(dy, dx) * 180) / Math.PI
    };
  }

  function offsetPathToLeft(map, latlngs, offsetPx) {
    const zoom = map.getZoom();
    const points = latlngs.map((ll) => map.project(ll, zoom));
    return points.map((p, i) => {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return map.unproject(L.point(p.x + (dy / len) * offsetPx, p.y - (dx / len) * offsetPx), zoom);
    });
  }

  function computeBusProgress(bus, tNow, borellaStopIdx) {
    const tl = bus.stopTimeline;
    if (tNow < tl[0].arrMin || tNow > tl[tl.length - 1].depMin) return null;
    for (let i = 0; i < tl.length; i++) {
      const stop = tl[i];
      if (tNow > stop.depMin) continue;
      if (tNow >= stop.arrMin) {
        const isHolding = i === borellaStopIdx && bus.borellaHoldMin > 0.05 && tNow > bus.borellaBaseDepMin;
        return {
          stopIdx: i,
          fraction: 0,
          onboardPax: stop.onboardPax,
          status: isHolding ? "Holding" : "At stop",
          where: stop.stopName
        };
      }
      const prev = tl[i - 1];
      return {
        stopIdx: i - 1,
        fraction: (tNow - prev.depMin) / Math.max(0.1, stop.arrMin - prev.depMin),
        onboardPax: prev.onboardPax,
        status: "Moving",
        where: `${prev.stopName} to ${stop.stopName}`
      };
    }
    return null;
  }

  function distanceAlongLegKm(geometry, progress) {
    const startKm = geometry.stopKm[progress.stopIdx];
    if (progress.fraction <= 0) return startKm;
    const endKm = geometry.stopKm[progress.stopIdx + 1];
    return startKm + progress.fraction * (endKm - startKm);
  }

  function loadClass(onboardPax, capacityPax) {
    const ratio = onboardPax / Math.max(1, capacityPax);
    if (ratio >= 0.98) return "load-full";
    if (ratio >= 0.7) return "load-busy";
    return "load-ok";
  }

  function createBusIcon(routeCode) {
    return L.divIcon({
      className: `bus-marker route-${routeCode.toLowerCase()}`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      html: '<div class="bus-body"></div><div class="bus-load"><i></i></div>'
    });
  }

  function addOverlayControl(map, position, element) {
    const OverlayControl = L.Control.extend({
      onAdd() {
        L.DomEvent.disableClickPropagation(element);
        L.DomEvent.disableScrollPropagation(element);
        return element;
      }
    });
    new OverlayControl({ position }).addTo(map);
  }

  function createElement(className, innerHtml) {
    const el = document.createElement("div");
    el.className = className;
    el.innerHTML = innerHtml;
    return el;
  }

  function setHtmlIfChanged(el, html) {
    if (el.dataset.renderedHtml !== html) {
      el.innerHTML = html;
      el.dataset.renderedHtml = html;
    }
  }

  function buildLegendElement() {
    return createElement("map-card map-legend", `
      <div class="overlay-title">Legend</div>
      <div class="legend-item"><span class="legend-line route-cm01"></span>CM01 Makumbura - Fort</div>
      <div class="legend-item"><span class="legend-line route-cm03"></span>CM03 Makumbura - Kadawatha</div>
      <div class="legend-subtitle">Traffic per direction (left lane)</div>
      <div class="legend-item"><span class="lane-swatch state-0"></span>Free (36 km/h)</div>
      <div class="legend-item"><span class="lane-swatch state-1"></span>Slow (20 km/h)</div>
      <div class="legend-item"><span class="lane-swatch state-2"></span>Jammed (10 km/h)</div>
      <div class="legend-subtitle">Buses and passengers</div>
      <div class="legend-item"><span class="legend-bus route-cm01"></span>Bus (bar = load vs capacity)</div>
      <div class="legend-item"><span class="legend-bus is-holding"></span>Connector holding at Borella</div>
      <div class="legend-item"><span class="legend-dot made"></span>Transfer walk, connection made</div>
      <div class="legend-item"><span class="legend-dot missed"></span>Transfer walk, connection missed</div>
    `);
  }

  function createUnavailableMap(container, reason) {
    container.classList.add("map-unavailable");
    container.innerHTML = `<div class="map-unavailable-message">${reason}</div>`;
    return { render() {} };
  }

  window.createCorridorMap = function createCorridorMap(options) {
    const { container, routes, geo, formatTime, isPeakTime, onBusHover, onBusClick, onBackgroundClick } = options;
    if (!window.L) {
      return createUnavailableMap(container, "The street map needs an internet connection to load. The simulation, KPIs and research panel still run offline.");
    }
    if (!geo) {
      return createUnavailableMap(container, "Corridor geometry (corridor-geo.js) is missing. Run scripts/build_corridor_geometry.py.");
    }

    const colors = {
      cm01: readCssVar("--route-cm01", "#1d9bd6"),
      cm03: readCssVar("--route-cm03", "#a855f7"),
      states: [
        readCssVar("--state-free", "#0f9d6e"),
        readCssVar("--state-slow", "#d6a10a"),
        readCssVar("--state-jammed", "#e5484d")
      ],
      made: readCssVar("--color-success", "#22c55e"),
      missed: readCssVar("--color-danger", "#f43f5e"),
      borella: readCssVar("--color-warning", "#eab308"),
      ink: readCssVar("--color-ink", "#fafafa"),
      bg: readCssVar("--color-bg", "#09090b")
    };

    const legGeometry = {};
    for (const legKey of Object.keys(routes)) {
      legGeometry[legKey] = prepareLegGeometry(geo.legs[legKey]);
    }
    const walkLatLngs = geo.borellaWalk.path.map(([lat, lng]) => L.latLng(lat, lng));
    const walkGeometry = prepareLegGeometry({ path: geo.borellaWalk.path, stopVertex: [0, walkLatLngs.length - 1] });
    const borellaCentre = L.latLngBounds(walkLatLngs).getCenter();

    const map = L.map(container, { zoomSnap: 0.25, zoomControl: false, attributionControl: true });
    map.createPane("routeCasingPane").style.zIndex = 405;
    map.createPane("lanePane").style.zIndex = 410;
    map.createPane("stopPane").style.zIndex = 450;
    map.createPane("walkerPane").style.zIndex = 460;

    const baseLayers = {};
    for (const name of Object.keys(BASEMAPS)) {
      baseLayers[name] = createBasemapLayer(name);
    }
    baseLayers.Dark.addTo(map);

    for (const legKey of CONNECTOR_LEGS) {
      L.polyline(legGeometry[legKey].latlngs, {
        pane: "routeCasingPane",
        color: routes[legKey].code === "CM01" ? colors.cm01 : colors.cm03,
        weight: 15,
        opacity: 0.3,
        lineCap: "round",
        lineJoin: "round",
        interactive: false
      }).addTo(map);
    }

    const laneLines = {};
    const laneStates = {};
    for (const legKey of Object.keys(routes)) {
      laneLines[legKey] = L.polyline(legGeometry[legKey].latlngs, {
        pane: "lanePane",
        color: colors.states[0],
        weight: 3,
        opacity: 0.95,
        lineCap: "butt",
        lineJoin: "round",
        interactive: false
      }).addTo(map);
    }

    function refreshLaneOffsets() {
      for (const legKey of Object.keys(laneLines)) {
        laneLines[legKey].setLatLngs(offsetPathToLeft(map, legGeometry[legKey].latlngs, LANE_OFFSET_PX));
      }
    }

    const stopRoutes = {};
    for (const route of Object.values(routes)) {
      for (const name of route.stops) {
        stopRoutes[name] = stopRoutes[name] || new Set();
        stopRoutes[name].add(route.code);
      }
    }
    for (const [name, routeCodes] of Object.entries(stopRoutes)) {
      const isBorella = name.includes("Borella");
      const isShared = routeCodes.size > 1;
      const marker = L.circleMarker(geo.stops[name], {
        pane: "stopPane",
        radius: isBorella ? 6 : 4.5,
        color: isBorella || isShared ? colors.ink : routeCodes.has("CM01") ? colors.cm01 : colors.cm03,
        weight: 2,
        fillColor: isBorella ? colors.borella : colors.bg,
        fillOpacity: 1
      }).addTo(map);
      const permanentLabel = PERMANENT_STOP_LABELS[name];
      marker.bindTooltip(permanentLabel || name, {
        permanent: Boolean(permanentLabel),
        direction: name === "Colombo Fort" ? "left" : "right",
        offset: name === "Colombo Fort" ? [-8, 0] : [8, 0],
        className: permanentLabel ? "stop-label stop-label-major" : "stop-label"
      });
    }

    map.fitBounds(L.latLngBounds(Object.values(geo.stops)), { padding: [36, 36] });

    const inspectorEl = createElement("map-card trip-inspector", "");
    const hudEl = createElement("map-card network-hud", "");
    const insetEl = createElement("map-card borella-inset", `
      <div class="overlay-title">Borella interchange <span class="overlay-hint">${geo.borellaWalk.distanceM} m walk via Baseline Road</span></div>
      <div class="borella-map"></div>
      <div class="hold-bar"><div class="hold-bar-fill"></div><span class="hold-bar-label"></span></div>
      <ul class="inset-events"></ul>
    `);
    const legendEl = buildLegendElement();

    addOverlayControl(map, "topleft", inspectorEl);
    addOverlayControl(map, "topright", hudEl);
    L.control.layers(baseLayers, null, { position: "topright", collapsed: true }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    addOverlayControl(map, "bottomleft", insetEl);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    addOverlayControl(map, "bottomright", legendEl);

    const insetMap = L.map(insetEl.querySelector(".borella-map"), {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      zoomSnap: 0.25
    });
    insetMap.createPane("walkerPane").style.zIndex = 460;
    let insetBaseLayer = createBasemapLayer("Dark").addTo(insetMap);
    map.on("baselayerchange", (e) => {
      insetMap.removeLayer(insetBaseLayer);
      insetBaseLayer = createBasemapLayer(e.name).addTo(insetMap);
    });
    L.polyline(walkLatLngs, { color: colors.borella, weight: 3, dashArray: "4 6", opacity: 0.9, interactive: false }).addTo(insetMap);
    const insetStops = [
      ["Borella 02 (YMBA)", "YMBA (CM03)", colors.cm03, "top", [0, -9]],
      ["Borella (Singer Mega)", "Singer Mega (CM01)", colors.cm01, "bottom", [0, 9]]
    ];
    for (const [name, label, color, direction, offset] of insetStops) {
      L.circleMarker(geo.stops[name], { radius: 7, color: colors.ink, weight: 2, fillColor: color, fillOpacity: 1, interactive: false })
        .bindTooltip(label, { permanent: true, direction, offset, className: "stop-label stop-label-major" })
        .addTo(insetMap);
    }
    function fitInset() {
      insetMap.invalidateSize();
      insetMap.fitBounds(L.latLngBounds(walkLatLngs), { padding: [34, 34] });
    }
    setTimeout(fitInset, 0);

    const holdFillEl = insetEl.querySelector(".hold-bar-fill");
    const holdLabelEl = insetEl.querySelector(".hold-bar-label");
    const insetEventsEl = insetEl.querySelector(".inset-events");

    map.on("zoomend", refreshLaneOffsets);
    map.on("click", () => onBackgroundClick());
    refreshLaneOffsets();

    let renderedDay = null;
    const busMarkers = new Map();
    const insetBusMarkers = new Map();
    const walkerMarkers = new Map();
    const insetWalkerMarkers = new Map();

    function clearMarkers(markerMap, ownerMap) {
      for (const marker of markerMap.values()) ownerMap.removeLayer(marker);
      markerMap.clear();
    }

    function getOrCreateBusMarker(markerMap, ownerMap, bus, isInteractive) {
      let marker = markerMap.get(bus.tripId);
      if (!marker) {
        marker = L.marker([0, 0], { icon: createBusIcon(bus.routeCode), interactive: isInteractive, keyboard: false });
        if (isInteractive) {
          marker.on("mouseover", () => onBusHover(bus.tripId));
          marker.on("mouseout", () => onBusHover(null));
          marker.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            onBusClick(bus.tripId);
          });
        }
        markerMap.set(bus.tripId, marker);
      }
      if (!ownerMap.hasLayer(marker)) marker.addTo(ownerMap);
      return marker;
    }

    function styleBusMarker(marker, placement, progress, flags) {
      marker.setLatLng(placement.latlng);
      const el = marker.getElement();
      if (!el) return;
      el.classList.toggle("is-holding", flags.isHolding);
      el.classList.toggle("is-selected", flags.isSelected);
      el.firstChild.style.transform = `rotate(${placement.headingDeg.toFixed(1)}deg)`;
      const loadFill = el.lastChild.firstChild;
      loadFill.style.width = `${Math.min(100, (100 * progress.onboardPax) / Math.max(1, flags.capacityPax)).toFixed(0)}%`;
      loadFill.className = loadClass(progress.onboardPax, flags.capacityPax);
      marker.setZIndexOffset(flags.isSelected ? 1000 : flags.isHolding ? 500 : 0);
    }

    function renderBuses(day, tNow, params, focusId) {
      const visibleMain = new Set();
      const visibleInset = new Set();
      let holdingConnector = null;

      for (const bus of day.buses) {
        const route = routes[bus.legKey];
        const progress = computeBusProgress(bus, tNow, route.borellaStopIndex);
        if (!progress) continue;
        const geometry = legGeometry[bus.legKey];
        const located = locateAlongPath(geometry, distanceAlongLegKm(geometry, progress));
        const isHolding = progress.status === "Holding";
        if (isHolding) holdingConnector = bus;
        const flags = { isHolding, isSelected: bus.tripId === focusId, capacityPax: params.capacityPax };

        visibleMain.add(bus.tripId);
        styleBusMarker(getOrCreateBusMarker(busMarkers, map, bus, true), offsetToLeftOfTravel(map, located, LANE_OFFSET_PX), progress, flags);

        if (haversineKm(located.latlng, borellaCentre) <= BORELLA_INSET_RADIUS_KM) {
          visibleInset.add(bus.tripId);
          styleBusMarker(getOrCreateBusMarker(insetBusMarkers, insetMap, bus, false), offsetToLeftOfTravel(insetMap, located, 9), progress, flags);
        }
      }

      for (const [tripId, marker] of busMarkers) {
        if (!visibleMain.has(tripId) && map.hasLayer(marker)) map.removeLayer(marker);
      }
      for (const [tripId, marker] of insetBusMarkers) {
        if (!visibleInset.has(tripId) && insetMap.hasLayer(marker)) insetMap.removeLayer(marker);
      }
      return holdingConnector;
    }

    function walkPosition(ev, tNow) {
      const frac = Math.max(0, Math.min(1, (tNow - ev.startWalkMin) / Math.max(0.2, ev.readyMin - ev.startWalkMin)));
      const totalKm = walkGeometry.cumKm[walkGeometry.cumKm.length - 1];
      const walksFromYmba = ev.fromRoute === "CM03";
      return locateAlongPath(walkGeometry, (walksFromYmba ? frac : 1 - frac) * totalKm).latlng;
    }

    function renderWalkers(day, tNow) {
      const active = new Set();
      for (const ev of day.transferEvents) {
        if (tNow < ev.startWalkMin || tNow >= ev.readyMin) continue;
        active.add(ev.feederId);
        const position = walkPosition(ev, tNow);
        const isMade = ev.madeCount > 0;

        let walker = walkerMarkers.get(ev.feederId);
        if (!walker) {
          walker = L.circleMarker(position, {
            pane: "walkerPane",
            radius: 4,
            color: colors.bg,
            weight: 1.5,
            fillColor: isMade ? colors.made : colors.missed,
            fillOpacity: 1,
            interactive: false
          }).addTo(map);
          walkerMarkers.set(ev.feederId, walker);
        }
        walker.setLatLng(position);

        let insetWalker = insetWalkerMarkers.get(ev.feederId);
        if (!insetWalker) {
          insetWalker = L.marker(position, {
            pane: "walkerPane",
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
              className: "walker-marker",
              iconSize: [20, 20],
              iconAnchor: [10, 10],
              html: `<span class="walker ${isMade ? "made" : "missed"}">${ev.paxCount}</span>`
            })
          }).addTo(insetMap);
          insetWalkerMarkers.set(ev.feederId, insetWalker);
        }
        insetWalker.setLatLng(position);
      }
      for (const [key, marker] of walkerMarkers) {
        if (!active.has(key)) {
          map.removeLayer(marker);
          walkerMarkers.delete(key);
        }
      }
      for (const [key, marker] of insetWalkerMarkers) {
        if (!active.has(key)) {
          insetMap.removeLayer(marker);
          insetWalkerMarkers.delete(key);
        }
      }
    }

    function renderHoldBar(holdingConnector, tNow, params) {
      if (holdingConnector) {
        const elapsed = Math.max(0, tNow - holdingConnector.borellaBaseDepMin);
        const maxHold = Math.max(0.5, params.holdMaxMin);
        holdFillEl.style.width = `${(100 * Math.min(1, elapsed / maxHold)).toFixed(1)}%`;
        holdLabelEl.textContent = `Holding ${holdingConnector.tripId}: ${elapsed.toFixed(1)} / ${maxHold.toFixed(1)} min`;
        insetEl.classList.add("has-hold");
      } else {
        holdFillEl.style.width = "0%";
        holdLabelEl.textContent = `Walk ${params.walkTimeMin.toFixed(1)} min (model) | no active hold`;
        insetEl.classList.remove("has-hold");
      }
    }

    function renderRecentOutcomes(day, tNow) {
      const recent = day.transferEvents
        .filter((ev) => tNow >= ev.readyMin && tNow - ev.readyMin < RECENT_OUTCOME_WINDOW_MIN)
        .slice(-3)
        .reverse();
      const html = recent.length
        ? recent.map((ev) => {
          const missed = ev.missedTimingCount + ev.missedCapCount;
          return `<li><span class="mono">${formatTime(ev.readyMin)}</span> ${ev.feederId}: ` +
            `<span class="outcome made">${ev.madeCount} made</span>` +
            (missed > 0 ? ` <span class="outcome missed">${missed} missed</span>` : "") + "</li>";
        }).join("")
        : '<li class="muted">No transfers settled in the last 14 min</li>';
      setHtmlIfChanged(insetEventsEl, html);
    }

    function pickInspectorBus(day, tNow, focusId) {
      if (focusId) {
        const focused = day.buses.find((b) => b.tripId === focusId);
        if (focused) return { bus: focused, isPinned: true };
      }
      const connectors = day.buses
        .filter((b) => CONNECTOR_LEGS.includes(b.legKey))
        .sort((a, b) => a.borellaActualDepMin - b.borellaActualDepMin);
      return { bus: connectors.find((c) => c.borellaActualDepMin >= tNow - 5) || connectors[0] || null, isPinned: false };
    }

    function renderInspector(day, tNow, params, focusId) {
      const { bus, isPinned } = pickInspectorBus(day, tNow, focusId);
      if (!bus) {
        setHtmlIfChanged(inspectorEl, '<div class="overlay-title">Trip inspector</div><div class="muted">No trip selected</div>');
        return;
      }
      const progress = computeBusProgress(bus, tNow, routes[bus.legKey].borellaStopIndex);
      const delayMin = bus.borellaArrMin - bus.borellaSchedMin;
      const statusLine = progress ? `${progress.status}: ${progress.where}` : `Not running (${bus.originName} to ${bus.destName})`;
      setHtmlIfChanged(inspectorEl, `
        <div class="overlay-title">${isPinned ? "Trip inspector" : "Next Borella connector"}${isPinned ? ' <span class="overlay-hint">pinned</span>' : ""}</div>
        <div class="inspector-trip route-${bus.routeCode.toLowerCase()}"><strong>${bus.tripId}</strong><span>${bus.role}</span></div>
        <div class="inspector-status">${statusLine}</div>
        <dl class="inspector-grid">
          <dt>Borella arrival</dt><dd>${formatTime(bus.borellaArrMin)} (${delayMin >= 0 ? "+" : ""}${delayMin.toFixed(1)} min)</dd>
          <dt>Departs Borella</dt><dd>${formatTime(bus.borellaActualDepMin)}</dd>
          <dt>Hold</dt><dd>${bus.borellaHoldMin > 0.05 ? `${bus.borellaHoldMin.toFixed(1)} min` : "none"}</dd>
          <dt>Load at Borella</dt><dd>${bus.borellaOnboardPax} / ${params.capacityPax}</dd>
        </dl>
      `);
    }

    function renderNetworkHud(tNow, trafficStateByLeg) {
      const isPeak = isPeakTime(tNow);
      const rows = Object.keys(LEG_LABELS).map((legKey) => {
        const stateIdx = trafficStateByLeg[legKey];
        return `<li><span class="lane-swatch state-${stateIdx}"></span><span>${LEG_LABELS[legKey]}</span><b>${TRAFFIC_STATE_NAMES[stateIdx]}</b></li>`;
      }).join("");
      setHtmlIfChanged(hudEl, `
        <div class="hud-clock"><span class="mono">${formatTime(tNow)}</span><span class="regime-pill ${isPeak ? "peak" : "offpeak"}">${isPeak ? "Peak" : "Off-peak"}</span></div>
        <ul class="hud-traffic">${rows}</ul>
      `);
    }

    function renderLaneTraffic(trafficStateByLeg) {
      for (const [legKey, line] of Object.entries(laneLines)) {
        const stateIdx = trafficStateByLeg[legKey];
        if (laneStates[legKey] === stateIdx) continue;
        laneStates[legKey] = stateIdx;
        line.setStyle({ color: colors.states[stateIdx], dashArray: TRAFFIC_DASH_PATTERNS[stateIdx] });
      }
    }

    function render(frame) {
      const { day, tNow, params, focusId, trafficStateByLeg } = frame;
      if (!day) return;
      if (day !== renderedDay) {
        clearMarkers(busMarkers, map);
        clearMarkers(insetBusMarkers, insetMap);
        clearMarkers(walkerMarkers, map);
        clearMarkers(insetWalkerMarkers, insetMap);
        renderedDay = day;
      }
      renderLaneTraffic(trafficStateByLeg);
      const holdingConnector = renderBuses(day, tNow, params, focusId);
      renderWalkers(day, tNow);
      renderHoldBar(holdingConnector, tNow, params);
      renderRecentOutcomes(day, tNow);
      renderInspector(day, tNow, params, focusId);
      renderNetworkHud(tNow, trafficStateByLeg);
    }

    return { render };
  };
})();
