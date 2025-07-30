/* 
 * SLP Tilty Table
 * An interactive tour of nature reserves in Mexico.
 * 
 * This script manages map layers, hotspots, and user interactions (zoom, pan, tilt, spin)
 * for the GeoConnecTable project. It integrates with Google Maps and WebRTC for real-time
 * sensor-driven navigation and data display.
 * 
 * Zoom layers are defined as objects where:
 *   - A value of true for a key indicates a hotspot with visual content.
 *   - A value of false indicates a region of interest shown via GeoJson.
 *   - A string value indicates a hotspot marker to be highlighted.
 * 
 * Hotspot <div>s are defined in the HTML, e.g.:
 *   <div class="instructions" id="site1">
 *     <img src="cedulas/Tilty 1.png" id="site1_img">
 *   </div>
 * 
 * Regions of interest are loaded as GeoJson and styled on the map.
 */

// --- Regions of interest and global variables ---
var features = {}; // Holds loaded GeoJson features and their styles

var targetColor = '#ff0000';
var currentZoom = 0;
var targetRectangle;
var currentScale = 1.0;
var mapData = [];
var currentSpinPosition = 0;

var ws; // WebSocket for controller communication

var messages = document.createElement('ul');
var jsonData;

var loadedFeatures = [];
var allowZoomIn = true; // Controlled by satellite data detector
var floatZoom = 14.0;
var mexicoFullZoom = 5;
var idleTimer;
var map;
var ignoreKeys = [
  'pannable','mapZoom','imageSequenceLayer',
  'spinInstruction', 'tiltInstruction', 'showLabels',
  'imageSequenceLayer'
];

var hotspot = {}; // Holds Google Maps Marker objects for hotspots
var lastZoom = -1;
var currentFeatureSet = {}; // <-- Add this line

let cumulativeTicks = 0; // Add at the top-level (if not already present)
let maxTicksAtLocation = maxClicks; // Will be set by MaxZoomService
let maxZoomService = null; // Initialize as null

// Configuration flags
const ENABLE_MAX_ZOOM_SERVICE = true; // Set to true to enable MaxZoomService dynamic zoom boundaries
const ENABLE_FRACTIONAL_ZOOM = true; // Set to true to enable fractional zoom levels (may cause oscillation)

/*
 * ZOOM OSCILLATION ANALYSIS FINDINGS:
 * 
 * Root Cause: Google Maps accepts fractional zoom values via setZoom() but then 
 * systematically snaps them back to preferred values (often integers) through the 
 * zoom_changed event. This creates a fighting loop between our continuous fractional 
 * calculations and Google's internal correction mechanisms.
 * 
 * Time Series Analysis Results:
 * - Sustained Zoom: 63 events in 101ms with 10 snap-backs detected
 * - Oscillation Period: 102 events in 220ms with 81 rapid oscillations  
 * - Pattern: SET fractional → REPORT fractional → REPORT integer (snap-back)
 * 
 * Browser Behavior: This appears to be consistent across browsers as it's a 
 * Google Maps API behavior, not browser-specific. The isFractionalZoomEnabled 
 * option defaults to true for vector maps but the snap-back behavior still occurs.
 * 
 * Solution: Either disable fractional zoom entirely or implement logic to detect 
 * and avoid fighting Google's zoom corrections.
 */

// Throttle settings for MaxZoomService calls
let maxZoomServicePending = false;
let maxZoomServiceLastCall = 0;

// Trip wire settings for large zoom changes
let lastZoomLevel = null;
const MAX_EXPECTED_DELTA = 5; // Hardware should never send deltas larger than this
const ZOOM_JUMP_THRESHOLD = 0.02; // Flag zoom level changes larger than this (since normal changes are ~0.002)

// Trip wire settings for zoom derivatives during panning
let zoomHistory = []; // Array of {timestamp, zoomLevel, delta, isPan} objects
const ZOOM_HISTORY_SIZE = 20; // Keep last 20 zoom events for derivative analysis
const ZOOM_VELOCITY_THRESHOLD = 0.01; // Alert if zoom velocity exceeds this per second
const ZOOM_ACCELERATION_THRESHOLD = 0.005; // Alert if zoom acceleration exceeds this per second²
const PAN_ZOOM_CORRELATION_WINDOW = 2000; // Look for zoom changes within 2 seconds of pan events

// Time series data collection for zoom oscillation analysis
let zoomTimeSeriesData = []; // Array of {timestamp, type: 'set'|'reported', value, source} objects
const ZOOM_TIMESERIES_MAX_SIZE = 500; // Keep last 500 zoom events for plotting

// --- Function to add zoom data to time series collection ---
function addZoomToTimeSeries(zoomValue, type, source = '') {
  const timestamp = Date.now();
  zoomTimeSeriesData.push({
    timestamp,
    type, // 'set' or 'reported'
    value: zoomValue,
    source // 'zoom_gesture', 'pan_operation', 'zoom_changed_event', etc.
  });
  
  // Keep only recent data
  if (zoomTimeSeriesData.length > ZOOM_TIMESERIES_MAX_SIZE) {
    zoomTimeSeriesData.shift();
  }
}

// --- Function to generate time series plot of zoom values ---
function generateZoomTimeSeriesPlot() {
  if (zoomTimeSeriesData.length < 2) {
    console.log("Not enough zoom data for plotting (need at least 2 points)");
    return;
  }
  
  console.log("🎯 ZOOM TIME SERIES PLOT DATA:");
  console.log("=".repeat(80));
  
  // Get time range
  const firstTime = zoomTimeSeriesData[0].timestamp;
  const lastTime = zoomTimeSeriesData[zoomTimeSeriesData.length - 1].timestamp;
  const totalTimeSpan = lastTime - firstTime;
  
  console.log(`Time range: ${totalTimeSpan}ms (${(totalTimeSpan/1000).toFixed(2)}s)`);
  console.log(`Data points: ${zoomTimeSeriesData.length}`);
  console.log("");
  
  // Separate set vs reported values
  const setValues = zoomTimeSeriesData.filter(d => d.type === 'set');
  const reportedValues = zoomTimeSeriesData.filter(d => d.type === 'reported');
  
  console.log(`📤 Values we SET (${setValues.length} points):`);
  setValues.forEach((d, i) => {
    const relativeTime = ((d.timestamp - firstTime) / 1000).toFixed(3);
    console.log(`  ${relativeTime}s: ${d.value.toFixed(6)} (${d.source})`);
  });
  
  console.log("");
  console.log(`📥 Values Google REPORTED (${reportedValues.length} points):`);
  reportedValues.forEach((d, i) => {
    const relativeTime = ((d.timestamp - firstTime) / 1000).toFixed(3);
    console.log(`  ${relativeTime}s: ${d.value.toFixed(6)} (${d.source})`);
  });
  
  // Look for oscillation patterns
  console.log("");
  console.log("🔍 OSCILLATION ANALYSIS:");
  console.log("-".repeat(40));
  
  // Check for rapid back-and-forth between set and reported values
  let oscillations = 0;
  let maxDeviation = 0;
  
  for (let i = 1; i < zoomTimeSeriesData.length; i++) {
    const prev = zoomTimeSeriesData[i-1];
    const curr = zoomTimeSeriesData[i];
    const timeDiff = curr.timestamp - prev.timestamp;
    const valueDiff = Math.abs(curr.value - prev.value);
    
    if (timeDiff < 100 && valueDiff > 0.001) { // Quick changes > 0.001 zoom levels
      oscillations++;
      maxDeviation = Math.max(maxDeviation, valueDiff);
      
      const relativeTime = ((curr.timestamp - firstTime) / 1000).toFixed(3);
      console.log(`  ${relativeTime}s: ${prev.type}=${prev.value.toFixed(6)} → ${curr.type}=${curr.value.toFixed(6)} (Δ=${valueDiff.toFixed(6)}, ${timeDiff}ms)`);
    }
  }
  
  console.log(`Total rapid oscillations detected: ${oscillations}`);
  console.log(`Maximum deviation: ${maxDeviation.toFixed(6)} zoom levels`);
  
  // Calculate correlation between set and reported values
  if (setValues.length > 0 && reportedValues.length > 0) {
    const avgSet = setValues.reduce((sum, d) => sum + d.value, 0) / setValues.length;
    const avgReported = reportedValues.reduce((sum, d) => sum + d.value, 0) / reportedValues.length;
    
    console.log("");
    console.log("📊 STATISTICAL SUMMARY:");
    console.log(`Average SET value: ${avgSet.toFixed(6)}`);
    console.log(`Average REPORTED value: ${avgReported.toFixed(6)}`);
    console.log(`Difference: ${Math.abs(avgSet - avgReported).toFixed(6)}`);
  }
  
  console.log("=".repeat(80));
  
  // Also return the raw data for external plotting tools
  return {
    data: zoomTimeSeriesData,
    setValues,
    reportedValues,
    oscillations,
    maxDeviation,
    timeSpan: totalTimeSpan
  };
}

// --- SVG-based instruction rendering ---
function setInstructions(texta, textb) {
  var element = document.getElementById("circletext");
  element.innerHTML = "";
  var instructions = SVG('circletext');
  instructions.size(1070,1070).center(540,540);
  var defs = instructions.defs();

  // Arc paths for text placement
  var topArcPath = "   M 1040, 540   a 500,500  0 1 0   -1000,0 ";
  var bottomArcPath = "M   40, 540   a 500,500  0 1 0    1000,0 ";
  var leftArcPath  = " M  540, 40    a 500,500  0 1 0    0,1000 ";
  var rightArcPath = " M  540, 1040  a 500,500  0 1 0    0,-1000 ";

  // Place text on arcs
  var topGroup = instructions.group();
  topGroup.path(topArcPath).fill("none");
  var topText = topGroup.text(texta).fill("#0f0");
  topText.path(topArcPath);

  var leftGroup = instructions.group();
  leftGroup.path(leftArcPath).fill("none");
  var leftText = leftGroup.text(textb).fill("#ff0");
  leftText.path(leftArcPath);

  var bottomGroup = instructions.group();
  bottomGroup.path(bottomArcPath).fill('none');
  var bottomText = bottomGroup.text(texta).fill("#0f0");
  bottomText.path(bottomArcPath);

  var rightGroup = instructions.group();
  rightGroup.path(rightArcPath).fill('none');
  var rightText = rightGroup.text(textb).fill("#ff0");
  rightText.path(rightArcPath);
}

// --- Hotspot card management ---
var openCards = {};

/**
 * Show a hotspot card (cedula) for a given feature and sequence number.
 */
function openCedula(featureKey, sequenceNumber) {
  if (openCards[featureKey] && openCards[featureKey].indexOf(String(sequenceNumber)) > -1) return;
  var imgDiv = document.getElementById(featureKey);
  imgDiv.style.display = "block";
  for (var img = 0; img <  imgDiv.childNodes.length; img++) {
    if (0 === imgDiv.childNodes[img].nodeName.localeCompare("img", 'en', {'sensitivity': 'base'})) {
      if (imgDiv.childNodes[img].hasAttribute("sequencenumber")){
        if (imgDiv.childNodes[img].getAttribute("sequencenumber") == sequenceNumber)
        {
          // Open this image
          if (openCards[featureKey]) 
            openCards[featureKey].push(String(sequenceNumber));
          else
            openCards[featureKey] = [String(sequenceNumber)];
          imgDiv.childNodes[img].classList.add('imageOn');
        } else {
          // Close other images
          if (openCards[featureKey]) 
          {
            var index = openCards[featureKey].indexOf(imgDiv.childNodes[img].getAttribute("sequencenumber"));
            if (index > -1) {
              openCards[featureKey].splice(index, 1);
              imgDiv.childNodes[img].classList.remove('imageOn');
            }
          }
        }
      }
    }
  }
}

/**
 * Hide all open hotspot cards.
 */
function closeCedulas() {
  for (featureKey in openCards) {
    var imgDiv= document.getElementById(featureKey);
    imgDiv.style.display = "none";
    for (var img = 0; img <  imgDiv.childNodes.length; img++) {
      if (0 === imgDiv.childNodes[img].nodeName.localeCompare("img", 'en', {'sensitivity': 'base'})) {
        var index = openCards[featureKey].indexOf(imgDiv.childNodes[img].getAttribute("sequencenumber"));
        if (index > -1) {
          openCards[featureKey].splice(index, 1);
          if (openCards[featureKey].length == 0) delete openCards[featureKey];
          imgDiv.childNodes[img].classList.remove('imageOn');
        }
      }
    }
  }
}

/**
 * Handles zoom layer transitions, loading/unloading features and cards.
 * @param {number} newLayer - The new zoom layer index.
 */
function doZoom(newLayer) {
  if (newLayer === lastZoom) return;
  if (newLayer < 0) newLayer = 0;
  if (newLayer >= Object.keys(zoomLayers).length) newLayer = Object.keys(zoomLayers).length - 1;
  if (!zoomLayers[newLayer]) {
    console.warn("zoomLayers[" + newLayer + "] is undefined");
    return;
  }
  currentZoom = newLayer;
  console.log("leaving layer " + lastZoom + " at " + map.getCenter());
  if (lastZoom === -1) {
    // Initial load
    nextFeatureSet = zoomLayers[newLayer];
    setInstructions(zoomLayers[newLayer]['spinInstruction'],zoomLayers[newLayer]['tiltInstruction']);
    for (featureKey in nextFeatureSet) {
      if ( ignoreKeys.indexOf(featureKey) > -1 ) continue;
      if (  nextFeatureSet[featureKey] === true) {
        // Open hotspot card and pan to location
        map.panTo(hotspot[featureKey]);
        if (currentFeatureSet.hasOwnProperty('imageSequenceLayer')) 
          openCedula(featureKey, nextFeatureSet['imageSequenceLayer']);
      } else {
        // Load/enable shapefile or marker
        if ( typeof(nextFeatureSet[featureKey]) === "string" ) {
          if (hotspot[nextFeatureSet[featureKey]]) {
            if (nextFeatureSet.hasOwnProperty('showLabels'))
              hotspot[nextFeatureSet[featureKey]].setLabel(featureKey);
            else
              hotspot[nextFeatureSet[featureKey]].setLabel(null);
            hotspot[nextFeatureSet[featureKey]].setMap(map);
          }
        } else {
          if (features[featureKey]) {
            features[featureKey]['mapdata'].setMap(map);
            features[featureKey]['mapdata'].setStyle(features[featureKey]['style']);
          }
        }
      }
    }
    window.lastZoomFromOurCode = Date.now();
    map.setZoom(Math.min(maxZoom,Math.max(minZoom,zoomLayers[newLayer]['mapZoom'])));
    lastZoom = newLayer;
    console.log("entered layer " + newLayer + " at " + map.getCenter());
    paintTarget();
    return;
  } else { 
    // Transition between layers
    currentFeatureSet = zoomLayers[lastZoom];
    nextFeatureSet = zoomLayers[newLayer];
    for (featureKey in currentFeatureSet) {
      if ( ignoreKeys.indexOf(featureKey) > -1) continue;
      if ( nextFeatureSet.hasOwnProperty('showLabels') === 
       currentFeatureSet.hasOwnProperty('showLabels') &&
       (currentFeatureSet[featureKey] === nextFeatureSet[featureKey]))
         continue;
      if ( currentFeatureSet[featureKey] === true) {
        closeCedula(featureKey)
      } else {
        // Unload marker or region
        if ( typeof(currentFeatureSet[featureKey]) === "string" ) {
          if (hotspot[currentFeatureSet[featureKey] ]) {
            hotspot[currentFeatureSet[featureKey]].setLabel(null);
            hotspot[currentFeatureSet[featureKey] ].setMap(null);
          }
        } else {
          if (features[featureKey]) {              
              features[featureKey]['mapdata'].setMap(null);
          }
        }
      }
    }
    nextFeatureSet = zoomLayers[newLayer];
    setInstructions(zoomLayers[newLayer]['spinInstruction'],zoomLayers[newLayer]['tiltInstruction']);
    for (featureKey in nextFeatureSet) {
      if ( ignoreKeys.indexOf(featureKey) > -1) continue;
      if ( nextFeatureSet.hasOwnProperty('showLabels') === 
       currentFeatureSet.hasOwnProperty('showLabels') &&
       (currentFeatureSet[featureKey] === nextFeatureSet[featureKey]))  continue;
      if (  nextFeatureSet[featureKey] === true) {
        map.panTo(hotspot[featureKey].position);
        openCedula(featureKey,nextFeatureSet['imageSequenceLayer']);
      } else {
        if ( typeof(nextFeatureSet[featureKey]) == "string" ) {
          if (hotspot[nextFeatureSet[featureKey]]) {
            if (nextFeatureSet.hasOwnProperty('showLabels'))
              hotspot[nextFeatureSet[featureKey]].setLabel(makeLabel(featureKey));
            else
              hotspot[nextFeatureSet[featureKey]].setLabel(null);
            hotspot[nextFeatureSet[featureKey]].setMap(map);
          }
        } else {
          if (features[featureKey]) {
            features[featureKey]['mapdata'].setMap(map);
            features[featureKey]['mapdata'].setStyle(features[featureKey]['style']);
          }
        }
      }
    }
    window.lastZoomFromOurCode = Date.now();
    map.setZoom(Math.min(maxZoom,Math.max(minZoom,zoomLayers[newLayer]['mapZoom'])));
    lastZoom = newLayer;
  }
  console.log("entered layer " + newLayer + " at " + map.getCenter());
  paintTarget();
} 

// --- Idle timer for auto-reload ---
function startIdleTimer() {
  idleTimer = setTimeout(function(){
    window.location.reload(1);
  }, 10 * 60 * 1000);
}

function restartIdleTimer() {
  clearTimeout(idleTimer);
  startIdleTimer();
}

// --- GeoJson shape loading ---
function shapeloaded(newfeatures) {
  for (feature in newfeatures) {
    if (!features.hasOwnProperty(newfeatures[feature].f.NOMGEO)) {
      data1 = new google.maps.Data();
      data1.add(newfeatures[feature]);
      features[newfeatures[feature].f.NOMGEO] = { 
        'style' : { fillColor: 'magenta', strokeWeight: 1 },
        'mapdata': data1,
      }
    } 
  }          
}

// --- Marker label creation ---
function makeLabel(siteName) {
  var markerLabel = Object.assign({}, defaultMarkerLabel)
  markerLabel.text = siteName;
  return markerLabel;
}

/**
 * Initializes the Google Map, markers, features, and the OptimizedSatelliteDetector.
 * Also sets up event listeners for zoom/pan and WebRTC data.
 */
function initializemap(WebRTConnection) {
  if (map == null) {
    var mapCanvas = document.getElementById('map-canvas');
    var mapOptions = {
      center: myLatLng,
      zoom : minZoom,
      disableDefaultUI: true,
      backgroundColor: '#000000',
      mapTypeId: google.maps.MapTypeId.HYBRID,
      mapId: '742e3d713d326414c8d039bd',
      isFractionalZoomEnabled: ENABLE_FRACTIONAL_ZOOM,
    };
    map = new google.maps.Map(mapCanvas, mapOptions);
    map.data.setStyle({
      fillColor: 'yellow',
      strokeWeight: 1
    });
    featuresets = {} ;
    /* window.detector = new OptimizedSatelliteDetector(map, {
      debounceDelay: 500,
      integerZoomOnly: true,
      panThreshold: 0.001,
      maxCallsPerSecond: 3
    }); */
    
    
    // Create main marker and all hotspot markers
     // Example for creating a marker with the new API:
    const { AdvancedMarkerElement } = google.maps.marker;

    // Replace this:
    // var marker = new google.maps.Marker({
    //   position: myLatLng,
    //   map: map,
    //   title: 'Click to zoom',
    //   icon: logoimage,
    // });

    // With this:
    // Example for main marker
    var img = document.createElement('img');
    img.src = logoimage.url; // logoimage should be a URL string
    img.alt = 'Marker';
    img.style.width = '32px'; // or your preferred size

    var marker = new AdvancedMarkerElement({
      map: map,
      position: myLatLng,
      title: 'Click to zoom',
      content: img // If logoimage is an HTMLElement, otherwise use icon property
    });

    // For hotspot markers, update similarly:
    for (hotspotkey in hotspots) {
      var hotspotDiv = document.getElementById(hotspotkey);
      if (hotspotDiv === null) continue;
      var iconImage;
      if (hotspotDiv.hasAttribute("icon")) {
        iconImage = hotspotDiv.getAttribute("icon"); // This should be a URL string
      }
      var loc = new google.maps.LatLng(hotspots[hotspotkey][0], hotspots[hotspotkey][1]);
      var contentNode;
      if (iconImage) {
        contentNode = document.createElement('img');
        contentNode.src = iconImage;
        contentNode.alt = hotspotkey;
        contentNode.style.width = '32px';
      }
      hotspot[hotspotkey] = new AdvancedMarkerElement({
        map: map,
        position: loc,
        title: hotspotkey,
        content: contentNode // Only pass if contentNode is defined
      });
    }

    // Listen for features added to map data
    map.data.addListener('addfeature', function(e) {
      var name = e.feature.getProperty("NOMGEO");
      if (! name ) {
        name = e.feature.getProperty("NAME_FAO");
        if (! name ) name = "idunno";
      }
      featuresets[name] = e.feature;
    });

    map.addListener('zoom_changed', function() {
      const timestamp = new Date().toISOString();
      const currentMapZoom = map.getZoom();
      
      console.log(`[${timestamp}] 🗺️  MAPS API ZOOM_CHANGED EVENT: ${currentMapZoom}`);
      
      // Add to time series data collection
      addZoomToTimeSeries(currentMapZoom, 'reported', 'zoom_changed_event');
      
      // Add to zoom history for derivative analysis - this catches ALL zoom changes
      addZoomToHistory(currentMapZoom, 0, false); // delta=0 since we don't know the source
      
      // Check if this zoom change was NOT from our own zoom gesture handling
      const timeSinceLastOurZoom = Date.now() - (window.lastZoomFromOurCode || 0);
      if (timeSinceLastOurZoom > 100) { // If it's been >100ms since we set zoom
        console.warn(`[${timestamp}] ⚠️  EXTERNAL ZOOM CHANGE! Map zoom changed to ${currentMapZoom} from unknown source (${timeSinceLastOurZoom}ms since our last zoom)`);
        console.warn(`[${timestamp}] ⚠️  This could be: user gesture, API call, bounds change, or other Google Maps behavior`);
        
        // TRIP WIRE: Unexpected zoom change from unknown source
        if (lastZoomLevel !== null) {
          const zoomDiff = Math.abs(currentMapZoom - lastZoomLevel);
          if (zoomDiff > 0.001) { // Any meaningful zoom change
            console.error(`[${timestamp}] 🚨 TRIP WIRE: UNEXPECTED EXTERNAL ZOOM CHANGE!`);
            console.error(`[${timestamp}] 🚨 Zoom changed by ${zoomDiff.toFixed(6)} levels from external source`);
            console.error(`[${timestamp}] 🚨 Previous: ${lastZoomLevel}, New: ${currentMapZoom}`);
            console.error(`[${timestamp}] 🚨 Time since our last zoom: ${timeSinceLastOurZoom}ms`);
          }
        }
      } else {
        console.log(`[${timestamp}] ✅ Expected zoom change from our code (${timeSinceLastOurZoom}ms ago)`);
      }
    });

    // Load GeoJson features
    for ( feature in features) {
      data1 = new google.maps.Data();
      data1.loadGeoJson(features[feature]['geojson'], null, shapeloaded);
      features[feature]['mapdata'] = data1;
    }
    
    map.data.addListener('mouseover', function(event) {
      map.data.revertStyle();
      map.data.overrideStyle(event.feature, {strokeWeight: 8});
    });

    marker.addListener('gmp-click', function() {
      window.lastZoomFromOurCode = Date.now();
      map.setZoom(8);
      map.setCenter(marker.getPosition());
    });  

    // Initialize MaxZoomService if available and enabled
    if (ENABLE_MAX_ZOOM_SERVICE && typeof google !== 'undefined' && google.maps && google.maps.MaxZoomService) {
      maxZoomService = new google.maps.MaxZoomService();
      console.log(`[${new Date().toISOString()}] MaxZoomService initialized successfully (ENABLED)`);
    } else if (!ENABLE_MAX_ZOOM_SERVICE) {
      console.log(`[${new Date().toISOString()}] MaxZoomService DISABLED by configuration flag`);
    } else {
      console.warn(`[${new Date().toISOString()}] MaxZoomService not available, using default maxTicksAtLocation: ${maxTicksAtLocation}`);
    }

    targetRectangle =  new google.maps.Rectangle();
    doZoom(0);

    // Initialize trip wire tracking
    lastZoomLevel = map.getZoom();
    console.log(`[${new Date().toISOString()}] Trip wire initialized: lastZoomLevel = ${lastZoomLevel}`);
    
    // Initialize zoom history for derivative analysis
    addZoomToHistory(lastZoomLevel, 0, false);
    console.log(`[${new Date().toISOString()}] Zoom derivative tracking initialized`);

    // --- Run pan analysis as soon as the map is loaded ---
    triggerPanAnalysisIfNeeded(map.getCenter());

  
   /*  map.addListener('satellite_data_limit', (event) => {
      console.log('High resolution satellite data no longer available');
      allowZoomIn = false;
      // Optionally show a warning to the user
    });

    // Re-enable zoom-in if data is available again
    map.addListener('tilesloaded', async () => {
      const quality = await detector.sampleImageQuality();
      if (quality >= detector.qualityThreshold) {
        allowZoomIn = true;
      }
    });*/
  } 

  // Subscribe to WebRTC messages
  try {
    WebRTConnection.subscribe(m => handleWebSocketMessage(m));
  } catch(e) {
    console.log("failed to attach local web socket: " + e);
  } 
}

// --- Target rectangle painting for current view ---
function paintTarget() {
  if (currentZoom < 1) return;
  currView = map.getBounds();
  if (currView == undefined) return;
  currLeft = currView.getNorthEast().lng();
  currRight = currView.getSouthWest().lng();
  currTop = currView.getNorthEast().lat();
  currBottom = currView.getSouthWest().lat();
  currWidth = currLeft - currRight;
  currHeight = currTop - currBottom;
  currCenter = map.getCenter();
  hotBounds = new google.maps.LatLngBounds(
    {lat: currCenter.lat()-targetWidth*currHeight, lng: currCenter.lng()-targetWidth*currWidth},
    {lat: currCenter.lat()+targetWidth*currHeight, lng: currCenter.lng()+targetWidth*currWidth});

  var strokeOpacity = 0.0;
  var fillOpacity = 0.0;
  if (zoomLayers[currentZoom]['pannable']) {
    if (zoomLayers[currentZoom]['mapZoom'] > 10) {
      fillOpacity = 0.35;
    }
    strokeOpacity = 0.8;
    targetColor = '#ffaaaa';
    for (featureKey in currentFeatureSet) {
      if ( ignoreKeys.indexOf(featureKey) > -1) continue;
      if ( typeof(currentFeatureSet[featureKey]) == "string" ) {
        if (hotspot[currentFeatureSet[featureKey]]) {
          if (hotBounds.contains(hotspot[currentFeatureSet[featureKey]].position)) {
            if (currentZoom < siteCardStartLayer)
              setInstructions(spinInToSeeCards, huntForHotSpotTiltInstruction);
            else if (currentZoom > siteCardStartLayer+2)
              setInstructions(spinOutToSeeCards, huntForHotSpotTiltInstruction);
            else 
              setInstructions(spinToSeeMoreCards, spinToSeeMoreCards);
            targetColor = '#aaffaa';
            break;
          }
        }
      }
    }
  }

  targetRectangle.setOptions({
    strokeColor: targetColor,
    strokeOpacity: strokeOpacity,
    strokeWeight: 2,
    fillColor: targetColor,
    fillOpacity: fillOpacity,
    map: map,
    bounds: {
      north: currCenter.lat()+targetWidth*currHeight,
      south: currCenter.lat()-targetWidth*currHeight,
      west: currCenter.lng()-targetWidth*currWidth,
      east: currCenter.lng()+targetWidth*currWidth
    }
  });
}

// --- WebSocket connection helpers ---
function connectLocal() {
  ws = new WebSocket("ws://192.168.1.73:5678/");
  ws.onmessage = handleWebSocketMessage;
  console.log("ws://192.168.1.73:5678");
}
function connectPi() {
  ws = new WebSocket("ws://192.168.2.2:5678/");
  ws.onmessage = handleWebSocketMessage;
  console.log("ws://192.168.2.2:5678");
}
function disconnectWS() {
  ws.close();
}

// --- Zoom controls (UI and controller) ---
function zoomIn() {
  console.log(`[${new Date().toISOString()}] MANUAL ZOOM IN triggered`);
  if (!allowZoomIn) {
    console.log("Zoom in blocked: no valid image data.");
    return;
  }
  var dummyEvent = { 'data' : '{"gesture":"zoom", "vector" : { "delta" : 20 }}'};
  console.log(`[${new Date().toISOString()}] Sending manual zoom in event:`, dummyEvent);
  handleWebSocketMessage(dummyEvent);
}
function zoomOut() {
  console.log(`[${new Date().toISOString()}] MANUAL ZOOM OUT triggered`);
  var dummyEvent = { 'data' : '{"gesture":"zoom", "vector" : { "delta" : -20 }}'};
  console.log(`[${new Date().toISOString()}] Sending manual zoom out event:`, dummyEvent);
  handleWebSocketMessage(dummyEvent);
}

function updateMaxTicksAtLocation(latLng) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] updateMaxTicksAtLocation called:`, {
    latLng: {lat: latLng.lat(), lng: latLng.lng()},
    maxZoomServicePending,
    timeSinceLastCall: Date.now() - maxZoomServiceLastCall,
    maxZoomThrottleMs,
    maxZoomServiceAvailable: maxZoomService !== null,
    maxZoomServiceEnabled: ENABLE_MAX_ZOOM_SERVICE
  });
  
  // Check if MaxZoomService is enabled and available
  if (!ENABLE_MAX_ZOOM_SERVICE) {
    console.log(`[${timestamp}] MaxZoomService disabled by configuration, keeping current maxTicksAtLocation: ${maxTicksAtLocation}`);
    return;
  }
  
  if (!maxZoomService) {
    console.log(`[${timestamp}] MaxZoomService not available, keeping current maxTicksAtLocation: ${maxTicksAtLocation}`);
    return;
  }
  
  // Don't call if another request is pending or if throttle timer hasn't expired
  if (maxZoomServicePending || 
      (Date.now() - maxZoomServiceLastCall) < maxZoomThrottleMs) {
    console.log(`[${timestamp}] MaxZoomService call throttled`);
    return;
  }

  maxZoomServicePending = true;
  console.log(`[${timestamp}] Making MaxZoomService request...`);
  maxZoomService.getMaxZoomAtLatLng(latLng, function(response) {
    const responseTimestamp = new Date().toISOString();
    maxZoomServicePending = false;
    maxZoomServiceLastCall = Date.now();

    console.log(`[${responseTimestamp}] MaxZoomService response:`, {
      status: response.status,
      zoom: response.zoom,
      latLng: {lat: latLng.lat(), lng: latLng.lng()}
    });

    if (response.status === google.maps.MaxZoomStatus.OK) {
      let maxAvailableZoom = response.zoom;
      let zoomRange = maxZoom - minZoom;
      if (maxAvailableZoom > maxZoom) maxAvailableZoom = maxZoom;
      let oldMaxTicks = maxTicksAtLocation;
      maxTicksAtLocation = Math.round(((maxAvailableZoom - minZoom) / zoomRange) * maxClicks); // Use maxClicks
      
      // TRIP WIRE: Check for large changes in maxTicksAtLocation
      const maxTicksChange = Math.abs(maxTicksAtLocation - oldMaxTicks);
      if (oldMaxTicks > 0 && maxTicksChange > (maxClicks * 0.2)) { // Alert if change is > 20% of maxClicks
        console.error(`[${responseTimestamp}] 🚨 TRIP WIRE: LARGE maxTicksAtLocation CHANGE!`);
        console.error(`[${responseTimestamp}] 🚨 maxTicksAtLocation changed by ${maxTicksChange} ticks`);
        console.error(`[${responseTimestamp}] 🚨 Old: ${oldMaxTicks}, New: ${maxTicksAtLocation}`);
        console.error(`[${responseTimestamp}] 🚨 This could cause zoom jumps! Current cumulativeTicks: ${cumulativeTicks}`);
        console.error(`[${responseTimestamp}] 🚨 MaxAvailableZoom: ${maxAvailableZoom}, Location:`, {lat: latLng.lat(), lng: latLng.lng()});
        
        // If current ticks are now out of bounds due to the change, that's a major red flag
        if (cumulativeTicks > maxTicksAtLocation) {
          console.error(`[${responseTimestamp}] 🚨 CRITICAL: cumulativeTicks (${cumulativeTicks}) now exceeds new maxTicksAtLocation (${maxTicksAtLocation})!`);
        }
      }
      
      console.log(`[${responseTimestamp}] MaxZoomService SUCCESS:`, {
        maxAvailableZoom,
        oldMaxTicksAtLocation: oldMaxTicks,
        newMaxTicksAtLocation: maxTicksAtLocation,
        currentCumulativeTicks: cumulativeTicks,
        ticksNowOutOfBounds: cumulativeTicks > maxTicksAtLocation,
        maxTicksChangeAmount: maxTicksChange
      });
    } else if (response.status === google.maps.MaxZoomStatus.ERROR) {
      console.warn(`[${responseTimestamp}] MaxZoomService known error (ERROR): Could not get max zoom at location.`, response);
    } else if (response.status === google.maps.MaxZoomStatus.UNKNOWN_ERROR) {
      console.warn(`[${responseTimestamp}] MaxZoomService unknown error (UNKNOWN_ERROR): Could not get max zoom at location.`, response);
    } else {
      console.warn(`[${responseTimestamp}] MaxZoomService unexpected status:`, response.status, response);
    }
  });
}
// --- Debounced pan analysis trigger ---
let panAnalysisTimer = null;
const panAnalysisDelay = 400; // ms to wait after last pan before analyzing
let lastPanCenter = null;

// --- Zoom derivative analysis for detecting drift during panning ---
function addZoomToHistory(zoomLevel, delta, isPan) {
  const timestamp = Date.now();
  zoomHistory.push({
    timestamp,
    zoomLevel,
    delta: delta || 0,
    isPan
  });
  
  // Keep only recent history
  if (zoomHistory.length > ZOOM_HISTORY_SIZE) {
    zoomHistory.shift();
  }
  
  // Analyze derivatives if we have enough data
  if (zoomHistory.length >= 3) {
    analyzeZoomDerivatives();
  }
}

function analyzeZoomDerivatives() {
  const recent = zoomHistory.slice(-3); // Last 3 events
  const timestamp = new Date().toISOString();
  
  if (recent.length < 3) return;
  
  // Calculate velocity (zoom change per second)
  const timeDiff1 = (recent[1].timestamp - recent[0].timestamp) / 1000; // seconds
  const timeDiff2 = (recent[2].timestamp - recent[1].timestamp) / 1000; // seconds
  
  if (timeDiff1 <= 0 || timeDiff2 <= 0) return;
  
  const zoomDiff1 = recent[1].zoomLevel - recent[0].zoomLevel;
  const zoomDiff2 = recent[2].zoomLevel - recent[1].zoomLevel;
  
  const velocity1 = zoomDiff1 / timeDiff1; // zoom levels per second
  const velocity2 = zoomDiff2 / timeDiff2; // zoom levels per second
  
  // Calculate acceleration (velocity change per second)
  const acceleration = (velocity2 - velocity1) / timeDiff2;
  
  // Check for sustained zoom drift during panning
  const hasRecentPan = zoomHistory.some(entry => 
    entry.isPan && (Date.now() - entry.timestamp) < PAN_ZOOM_CORRELATION_WINDOW
  );
  
  // Check if recent events are intentional zoom gestures vs pan-related
  const recentZoomGestures = recent.filter(entry => !entry.isPan && entry.delta !== 0);
  const recentPanEvents = recent.filter(entry => entry.isPan);
  const hasIntentionalZoom = recentZoomGestures.length > 0;
  
  console.log(`[${timestamp}] Zoom derivatives:`, {
    velocity1: velocity1.toFixed(6),
    velocity2: velocity2.toFixed(6),
    acceleration: acceleration.toFixed(6),
    hasRecentPan,
    hasIntentionalZoom,
    recentZoomGestures: recentZoomGestures.length,
    recentPanEvents: recentPanEvents.length,
    recentEvents: recent.map(r => ({
      delta: r.delta,
      zoomLevel: r.zoomLevel.toFixed(6),
      isPan: r.isPan,
      ageMs: Date.now() - r.timestamp
    }))
  });
  
  // TRIP WIRE: High zoom velocity - BUT ONLY if it's NOT from intentional zoom gestures
  if (Math.abs(velocity2) > ZOOM_VELOCITY_THRESHOLD && !hasIntentionalZoom) {
    console.error(`[${timestamp}] 🚨 TRIP WIRE: HIGH ZOOM VELOCITY WITHOUT ZOOM GESTURES!`);
    console.error(`[${timestamp}] 🚨 Zoom velocity: ${velocity2.toFixed(6)} levels/sec (threshold: ${ZOOM_VELOCITY_THRESHOLD})`);
    console.error(`[${timestamp}] 🚨 Recent pan activity: ${hasRecentPan}`);
    console.error(`[${timestamp}] 🚨 No intentional zoom gestures detected - this suggests unwanted zoom drift!`);
    console.error(`[${timestamp}] 🚨 Recent zoom history:`, recent);
  }
  
  // TRIP WIRE: High zoom acceleration - focus on unexpected changes in zoom behavior
  if (Math.abs(acceleration) > ZOOM_ACCELERATION_THRESHOLD && !hasIntentionalZoom) {
    console.error(`[${timestamp}] 🚨 TRIP WIRE: HIGH ZOOM ACCELERATION WITHOUT ZOOM GESTURES!`);
    console.error(`[${timestamp}] 🚨 Zoom acceleration: ${acceleration.toFixed(6)} levels/sec² (threshold: ${ZOOM_ACCELERATION_THRESHOLD})`);
    console.error(`[${timestamp}] 🚨 Recent pan activity: ${hasRecentPan}`);
    console.error(`[${timestamp}] 🚨 Velocity change: ${velocity1.toFixed(6)} → ${velocity2.toFixed(6)} levels/sec`);
    console.error(`[${timestamp}] 🚨 This suggests something is unexpectedly changing zoom behavior!`);
  }
  
  // TRIP WIRE: Sustained zoom drift during panning - ONLY when no zoom gestures present
  if (hasRecentPan && Math.abs(velocity2) > (ZOOM_VELOCITY_THRESHOLD * 0.5) && !hasIntentionalZoom) {
    console.error(`[${timestamp}] 🚨 TRIP WIRE: ZOOM DRIFT DURING PANNING!`);
    console.error(`[${timestamp}] 🚨 Zoom velocity during panning: ${velocity2.toFixed(6)} levels/sec`);
    console.error(`[${timestamp}] 🚨 This suggests pan gestures are affecting zoom calculations!`);
    console.error(`[${timestamp}] 🚨 Pan-zoom correlation detected within ${PAN_ZOOM_CORRELATION_WINDOW}ms window`);
    console.error(`[${timestamp}] 🚨 Recent pan events: ${recentPanEvents.length}, Recent zoom gestures: ${recentZoomGestures.length}`);
  }
  
  // INFORMATIONAL: Log intentional sustained zoom activity (expected behavior)
  if (hasIntentionalZoom && Math.abs(velocity2) > ZOOM_VELOCITY_THRESHOLD) {
    console.log(`[${timestamp}] ℹ️  INTENTIONAL SUSTAINED ZOOM: velocity ${velocity2.toFixed(6)} levels/sec from ${recentZoomGestures.length} zoom gesture(s) - this is expected behavior`);
  }
}

function triggerPanAnalysisIfNeeded(nextPosition) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] triggerPanAnalysisIfNeeded called:`, {
    nextPosition: {lat: nextPosition.lat(), lng: nextPosition.lng()},
    lastPanCenter: lastPanCenter ? {lat: lastPanCenter.lat(), lng: lastPanCenter.lng()} : null,
    panAnalysisTimerActive: panAnalysisTimer !== null
  });
  
  if (panAnalysisTimer) {
    console.log(`[${timestamp}] Clearing existing pan analysis timer`);
    clearTimeout(panAnalysisTimer);
  }
  
  panAnalysisTimer = setTimeout(() => {
    const analysisTimestamp = new Date().toISOString();
    if (!lastPanCenter) {
      console.log(`[${analysisTimestamp}] No lastPanCenter, setting to current position`);
      lastPanCenter = nextPosition;
    }
    
    const dLat = Math.abs(nextPosition.lat() - lastPanCenter.lat());
    const dLng = Math.abs(nextPosition.lng() - lastPanCenter.lng());
    const bounds = map.getBounds();
    const visibleLat = Math.abs(bounds.getNorthEast().lat() - bounds.getSouthWest().lat());
    const visibleLng = Math.abs(bounds.getNorthEast().lng() - bounds.getSouthWest().lng());
    
    console.log(`[${analysisTimestamp}] Pan analysis calculations:`, {
      dLat,
      dLng,
      visibleLat,
      visibleLng,
      dLatExceedsVisible: dLat > visibleLat,
      dLngExceedsVisible: dLng > visibleLng,
      dLatExceedsThreshold: dLat > 1.0,
      dLngExceedsThreshold: dLng > 1.0
    });
    
    if (dLat > visibleLat || dLng > visibleLng || dLat > 1.0 || dLng > 1.0) {
      console.log(`[${analysisTimestamp}] TRIGGERING MaxZoom update due to significant pan`);
      updateMaxTicksAtLocation(nextPosition);
      lastPanCenter = nextPosition;
    } else {
      console.log(`[${analysisTimestamp}] Pan analysis: No significant movement, skipping MaxZoom update`);
    }
  }, panAnalysisDelay);
}

// --- Main handler for incoming WebRTC/controller messages ---
var handleWebSocketMessage = function (event) {
  // Add timestamp for debugging
  const timestamp = new Date().toISOString();
  
  if (! map) return;
  currView = map.getBounds();
  if (currView === undefined) return;
  if (!currentFeatureSet) return;
  
  currRight = currView.getNorthEast().lng();
  currLeft = currView.getSouthWest().lng();
  currTop = currView.getNorthEast().lat();
  currBottom = currView.getSouthWest().lat();
  currWidth = Math.abs(currLeft - currRight);
  currHeight = Math.abs(currTop - currBottom);
  currCenter = map.getCenter();

let raw = (event && event.data) ? event.data : event;
if (typeof raw === "string") {
  jsonData = JSON.parse(raw);
} else {
  jsonData = raw;
}

  // Log all incoming messages with type/gesture identification
  console.log(`[${timestamp}] Raw message:`, raw);
  console.log(`[${timestamp}] Parsed data:`, jsonData);
  console.log(`[${timestamp}] Message type: ${jsonData.type || 'undefined'}, gesture: ${jsonData.gesture || 'undefined'}`);
  
  // TRIP WIRE: Check for suspicious message patterns
  if (jsonData.gesture === 'zoom' && jsonData.vector && !jsonData.vector.hasOwnProperty('delta')) {
    console.error(`[${timestamp}] 🚨 TRIP WIRE: ZOOM gesture missing delta property!`, jsonData);
  }
  if (jsonData.gesture === 'pan' && jsonData.vector && jsonData.vector.hasOwnProperty('delta')) {
    console.error(`[${timestamp}] 🚨 TRIP WIRE: PAN gesture has unexpected delta property!`, jsonData);
  }
  
  // Track current state before processing
  const currentMapZoom = map.getZoom();
  console.log(`[${timestamp}] Current state - MapZoom: ${currentMapZoom}, CumulativeTicks: ${cumulativeTicks}, MaxTicksAtLocation: ${maxTicksAtLocation}`);
  // Handle encoder (spin) data
  if (jsonData.type === 'spin') {
    console.log(`[${timestamp}] SPIN DATA:`, {
      sensorID: jsonData.packet.sensorID,
      encoderIndex: jsonData.packet.encoderIndex,
      encoderDelta: jsonData.packet.encoderDelta,
      encoderElapsedTime: jsonData.packet.encoderElapsedTime,
      encoderPosition: jsonData.packet.encoderPosition
    });
    document.getElementById('EncoderID').innerHTML = jsonData.packet.sensorID;
    document.getElementById('EncoderIndex').innerHTML = jsonData.packet.encoderIndex;
    document.getElementById('EncoderDelta').innerHTML = jsonData.packet.encoderDelta;
    document.getElementById('EncoderElapsedTime').innerHTML = jsonData.packet.encoderElapsedTime;
    document.getElementById('EncoderPosition').innerHTML = jsonData.packet.encoderPosition;
  } 
  // Handle tilt sensor data
  else if (jsonData.type == 'tilt') {
    console.log(`[${timestamp}] TILT DATA:`, {
      sensorID: jsonData.packet.sensorID,
      tiltX: jsonData.packet.tiltX,
      tiltY: jsonData.packet.tiltY,
      tiltMagnitude: jsonData.packet.tiltMagnitude
    });
    document.getElementById('TiltsensorID').innerHTML = jsonData.packet.sensorID;
    document.getElementById('TiltX').innerHTML = jsonData.packet.tiltX;
    document.getElementById('TiltY').innerHTML = jsonData.packet.tiltY;
    document.getElementById('TiltMagnitude').innerHTML = jsonData.packet.tiltMagnitude;
  } 
  // Handle pan gesture
  else if (jsonData.gesture === 'pan') {
    console.log(`[${timestamp}] PAN GESTURE:`, {
      vectorX: jsonData.vector.x,
      vectorY: jsonData.vector.y,
      currentZoom: currentZoom,
      pannable: zoomLayers[currentZoom]['pannable']
    });
    
    // Record current zoom level before pan for derivative analysis
    const zoomBeforePan = map.getZoom();
    addZoomToHistory(zoomBeforePan, 0, true); // Mark as pan event
    
    var deltaX = 0;
    var deltaY = 0;
    if (jsonData.vector.x == 0.0 && jsonData.vector.y == 0.0) {
      console.log(`[${timestamp}] Pan gesture ignored: zero vector`);
      return;
    }
    
    var zoomFudge = (minZoom + 7) +
      ((minZoom + 7) - (maxZoom-3 ))/(minZoom-maxZoom) *
      (map.getZoom()-minZoom);
    var percentChangeInY = panScaler * jsonData.vector.y *zoomFudge/maxZoom;
    deltaY = currHeight * percentChangeInY;
    percentChangeInX = panScaler * jsonData.vector.x *zoomFudge/maxZoom;
    deltaX = currWidth * percentChangeInX;
    var newLat = currCenter.lat()+deltaY;
    var nextPosition = new google.maps.LatLng(
      Math.min(Math.max(newLat, -89 + currHeight/2),89-currHeight/2),
      currCenter.lng() + deltaX);
      
    console.log(`[${timestamp}] Pan calculations:`, {
      zoomFudge,
      percentChangeInY,
      percentChangeInX,
      deltaY,
      deltaX,
      currentCenter: {lat: currCenter.lat(), lng: currCenter.lng()},
      nextPosition: {lat: nextPosition.lat(), lng: nextPosition.lng()}
    });
    
    if (zoomLayers[currentZoom]['pannable']) {
      map.setCenter(nextPosition);
      restartIdleTimer();
      console.log(`[${timestamp}] Pan applied successfully`);
      
      // Check for zoom changes after pan operation
      setTimeout(() => {
        const zoomAfterPan = map.getZoom();
        if (Math.abs(zoomAfterPan - zoomBeforePan) > 0.001) {
          console.warn(`[${new Date().toISOString()}] ⚠️  ZOOM CHANGED DURING PAN! Before: ${zoomBeforePan.toFixed(6)}, After: ${zoomAfterPan.toFixed(6)}, Diff: ${(zoomAfterPan - zoomBeforePan).toFixed(6)}`);
          addZoomToHistory(zoomAfterPan, 0, true); // Record post-pan zoom
        }
      }, 50); // Small delay to let map operations complete
      
    // --- Trigger analysis if pan traverses more than visible area ---
     triggerPanAnalysisIfNeeded(nextPosition);

     } else {
      console.log(`[${timestamp}] Pan ignored: layer not pannable`);
     }
    paintTarget();
  } 
  // Handle zoom gesture (spin)
  else if (jsonData.gesture === 'zoom') {
   console.log(`[${timestamp}] ZOOM GESTURE RECEIVED:`, {
     delta: jsonData.vector.delta,
     currentCumulativeTicks: cumulativeTicks,
     maxTicksAtLocation: maxTicksAtLocation,
     currentMapZoom: map.getZoom()
   });
   
   // TRIP WIRE: Check for unexpectedly large deltas
   if (Math.abs(jsonData.vector.delta) > MAX_EXPECTED_DELTA) {
     console.error(`[${timestamp}] 🚨 TRIP WIRE: UNEXPECTED LARGE DELTA! Delta=${jsonData.vector.delta}, expected max=${MAX_EXPECTED_DELTA}`);
     console.error(`[${timestamp}] 🚨 Raw message that caused large delta:`, raw);
     console.error(`[${timestamp}] 🚨 Full parsed data:`, jsonData);
     console.trace(`[${timestamp}] 🚨 Stack trace for large delta`);
   }
   
   // Update cumulativeTicks, but clamp to [0, maxClicks]
    let newTicks = cumulativeTicks + jsonData.vector.delta;
    console.log(`[${timestamp}] Zoom calculation:`, {
      oldTicks: cumulativeTicks,
      delta: jsonData.vector.delta,
      newTicks: newTicks,
      maxTicksAtLocation: maxTicksAtLocation,
      wouldBeOutOfBounds: (newTicks < 0 || newTicks > maxTicksAtLocation)
    });
    
    if (newTicks < 0 || newTicks > maxTicksAtLocation) {
        console.log(`[${timestamp}] ZOOM IGNORED: Out-of-bounds ticks ${newTicks} not in [0, ${maxTicksAtLocation}]`);
        return;
    }
    cumulativeTicks = newTicks;

    // Map cumulativeTicks to zoom level using continuous fractional calculation
    // 0 ticks => minZoom, maxTicksAtLocation => maxZoom
    let zoomRange = maxZoom - minZoom;
    let zoomLevel = minZoom + (cumulativeTicks / maxTicksAtLocation) * zoomRange;
    
    console.log(`[${timestamp}] Zoom level calculation:`, {
      cumulativeTicks,
      maxTicksAtLocation,
      minZoom,
      maxZoom,
      zoomRange,
      calculatedZoomLevel: zoomLevel,
      previousMapZoom: map.getZoom()
    });

    // TRIP WIRE: Check for unexpectedly large zoom level changes
    if (lastZoomLevel !== null) {
      const zoomLevelChange = Math.abs(zoomLevel - lastZoomLevel);
      if (zoomLevelChange > ZOOM_JUMP_THRESHOLD) {
        console.error(`[${timestamp}] 🚨 TRIP WIRE: LARGE ZOOM LEVEL JUMP!`);
        console.error(`[${timestamp}] 🚨 Zoom level changed by ${zoomLevelChange} (threshold: ${ZOOM_JUMP_THRESHOLD})`);
        console.error(`[${timestamp}] 🚨 Previous zoom level: ${lastZoomLevel}, New zoom level: ${zoomLevel}`);
        console.error(`[${timestamp}] 🚨 Delta that caused jump: ${jsonData.vector.delta}`);
        console.error(`[${timestamp}] 🚨 Cumulative ticks: ${cumulativeTicks}, Max ticks: ${maxTicksAtLocation}`);
        console.error(`[${timestamp}] 🚨 Raw message:`, raw);
        console.trace(`[${timestamp}] 🚨 Stack trace for zoom jump`);
        
        // Additional diagnostic info
        console.error(`[${timestamp}] 🚨 Diagnostic info:`, {
          currentMapZoomBeforeChange: map.getZoom(),
          calculatedZoomRange: zoomRange,
          ticksToZoomRatio: zoomRange / maxTicksAtLocation,
          maxTicksAtLocationWhenJumpOccurred: maxTicksAtLocation,
          actualThresholdUsed: ZOOM_JUMP_THRESHOLD
        });
      }
    }

    // Set the map zoom
    if (typeof map.setZoom === "function") {
        // Track that we're about to set zoom from our code
        window.lastZoomFromOurCode = Date.now();
        map.setZoom(zoomLevel);
        console.log(`[${timestamp}] ZOOM APPLIED: Set map zoom to ${zoomLevel}`);
        lastZoomLevel = zoomLevel; // Update for next comparison
        
        // Add to zoom history for derivative analysis
        addZoomToHistory(zoomLevel, jsonData.vector.delta, false); // Not a pan event
    } else {
        console.error(`[${timestamp}] ZOOM FAILED: map.setZoom is not a function`);
    }

  }
  // Combo gesture (future use)
  else if (jsonData.gesture == 'combo') {
    console.log(`[${timestamp}] COMBO GESTURE: Not implemented`, jsonData);
    // needs to use above
  } 
  // Handle unknown messages
  else { 
    console.log(`[${timestamp}] UNKNOWN MESSAGE TYPE:`, {
      type: jsonData.type,
      gesture: jsonData.gesture,
      fullData: jsonData
    });
    messages = document.getElementsByTagName('ul')[0];
    var message = document.createElement('li');
    var content = document.createTextNode(event.data);
    message.appendChild(content);
    messages.appendChild(message);
  }

  // Hotspot detection for current view
  hotBounds = new google.maps.LatLngBounds(
    {lat: currCenter.lat()-targetWidth*currHeight, 
      lng: currCenter.lng()-targetWidth*currWidth},
      {lat: currCenter.lat()+targetWidth*currHeight, 
        lng: currCenter.lng()+targetWidth*currWidth});
  var hotspotFound = false;
  for (featureKey in currentFeatureSet) {
    if ( ignoreKeys.indexOf(featureKey) > -1) continue;
    if ( typeof(currentFeatureSet[featureKey]) == "string" ) {
      if (currentFeatureSet.hasOwnProperty('imageSequenceLayer') && 
       hotspot[currentFeatureSet[featureKey]]) {
        if (hotBounds.contains(hotspot[currentFeatureSet[featureKey]].position)) {
          if ( ! hotspotFound ) {
            console.log("zoomed in on " + currentFeatureSet[featureKey] + " in " + hotBounds );
            openCedula(currentFeatureSet[featureKey],currentFeatureSet['imageSequenceLayer']);
            hotspotFound = true;
          } else {
            console.log("would like to have zoomed in on " + ']'[featureKey] + " in " + hotBounds );
          }
        }
      }
    }
  }
  if ( ! hotspotFound ) {
    closeCedulas();
  }
}

function handleWebRTCError(err) {
  if (err && err.message && err.message.includes("conn is not defined")) {
    showTestCirclesWithAnnotation("Phidget server is not available");
  } else {
    alert("WebRTC connection failed: " + (err && err.message ? err.message : err));
  }
}

// Start idle timer on load
startIdleTimer();

