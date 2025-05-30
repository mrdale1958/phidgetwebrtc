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
    };
    map = new google.maps.Map(mapCanvas, mapOptions);
    map.data.setStyle({
      fillColor: 'yellow',
      strokeWeight: 1
    });
    featuresets = {} ;
    window.detector = new OptimizedSatelliteDetector(map, {
      debounceDelay: 500,
      integerZoomOnly: true,
      panThreshold: 0.001,
      maxCallsPerSecond: 3
    });
    
    
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
      console.log("got new zoom", map.getZoom(), zoomLayers[currentZoom]);
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
      map.setZoom(8);
      map.setCenter(marker.getPosition());
    });  

    targetRectangle =  new google.maps.Rectangle();
    doZoom(0);

  
    map.addListener('satellite_data_limit', (event) => {
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
    });
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
  if (!allowZoomIn) {
    console.log("Zoom in blocked: no valid image data.");
    return;
  }
  var dummyEvent = { 'data' : '{"gesture":"zoom", "vector" : { "delta" : 20 }}'};
  handleWebSocketMessage(dummyEvent);
}
function zoomOut() {
  var dummyEvent = { 'data' : '{"gesture":"zoom", "vector" : { "delta" : -20 }}'};
  handleWebSocketMessage(dummyEvent);
}

// --- Main handler for incoming WebRTC/controller messages ---
var handleWebSocketMessage = function (event) {
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

  jsonData = JSON.parse(event);

  // Handle encoder (spin) data
  if (jsonData.type == 'spin') {
    document.getElementById('EncoderID').innerHTML(jsonData.packet.sensorID);
    document.getElementById('EncoderIndex').innerHTML(jsonData.packet.encoderIndex);
    document.getElementById('EncoderDelta').innerHTML(jsonData.packet.encoderDelta);
    document.getElementById('EncoderElapsedTime').innerHTML(jsonData.packet.encoderElapsedTime);
    document.getElementById('EncoderPosition').innerHTML(jsonData.packet.encoderPosition);
  } 
  // Handle tilt sensor data
  else if (jsonData.type == 'tilt') {
    document.getElementById('TiltsensorID').innerHTML(jsonData.packet.sensorID);
    document.getElementById('TiltX').innerHTML(jsonData.packet.tiltX);
    document.getElementById('TiltY').innerHTML(jsonData.packet.tiltY);
    document.getElementById('TiltMagnitude').innerHTML(jsonData.packet.tiltMagnitude);
  } 
  // Handle pan gesture
  else if (jsonData.gesture == 'pan') {
    var deltaX = 0;
    var deltaY = 0;
    if (jsonData.vector.x == 0.0 && jsonData.vector.y == 0.0) return;  
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
    if (zoomLayers[currentZoom]['pannable']) {
      map.setCenter(nextPosition);
      restartIdleTimer();
    }
    paintTarget();
  } 
  // Handle zoom gesture (spin)
  else if (jsonData.gesture == 'zoom') {
    if (jsonData.vector.delta > 0 && !allowZoomIn) {
      console.log("Zoom in gesture ignored: no valid image data.");
      return;
    }
    currentSpinPosition += jsonData.vector.delta;
    if (currentSpinPosition < 0) currentSpinPosition = 0;
    var proposedZoom =  Math.floor(currentSpinPosition/clicksPerZoomLevel);
    restartIdleTimer();
    if (proposedZoom != currentZoom) {
      doZoom(Math.min(Object.keys(zoomLayers).length - 1, Math.max(0,proposedZoom))); 
    }
  }
  // Combo gesture (future use)
  else if (jsonData.gesture == 'combo') {
    // needs to use above
  } 
  // Handle unknown messages
  else { 
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

// Start idle timer on load
startIdleTimer();

